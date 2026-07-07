#!/usr/bin/env node
'use strict';

/*
 * SERVIDOR DE REFERENCIA (STUB) — NO USAR EN PRODUCCIÓN TAL CUAL.
 *
 * Ejemplo mínimo, sin dependencias, del contrato y del CONTROL DE TOKENS.
 * Simplificaciones deliberadas (a sustituir en real):
 *   - Almacenes EN MEMORIA (se pierden al reiniciar) -> usar base de datos.
 *   - Rate limiting en memoria -> usar Redis o equivalente.
 *   - Sin TLS aquí -> lo aporta tu pasarela/balanceador.
 * Lo que SÍ ilustra bien:
 *   - Los tokens se guardan HASHEADOS (nunca en claro).
 *   - Ciclo de vida completo: emitir código -> canjear -> usar -> revocar/caducar.
 *   - Superficie de administración para controlar los tokens.
 *
 * Rutas de talento:
 *   GET  /health
 *   POST /enroll   {code}     -> canjea código de un solo uso por un token
 *   POST /reports  (Bearer)   -> ingesta, atribuida al talento del token
 *
 * Rutas de administración (requieren cabecera X-Admin-Key):
 *   POST /admin/enroll-codes  {talentId, ttlHours?}  -> crea código + cadena --enroll
 *   GET  /admin/tokens                                -> lista tokens (sin el secreto)
 *   POST /admin/revoke        {id}                    -> revoca un token por su id
 *
 * Arranque:  ADMIN_KEY=miclave node reference-server/server.js
 */

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8787;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const TOKEN_TTL_DAYS = 180;
// Clave de admin: si no se pasa por entorno, se genera una y se muestra al arrancar.
const ADMIN_KEY = process.env.ADMIN_KEY || 'adm_' + crypto.randomBytes(16).toString('hex');

/* ---------- almacenes en memoria (reemplazar por BD real) ---------- */
const enrollCodes = new Map(); // code -> { talentId, expiresAt, used }
const tokens = new Map();      // tokenHash -> { id, talentId, issuedAt, lastUsedAt, expiresAt, revoked }
const rate = new Map();        // tokenHash -> { count, windowStart }
const reports = [];

/* ---------- utilidades ---------- */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve(null); } });
  });
}
const bearer = (req) => {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};
const isAdmin = (req) => (req.headers['x-admin-key'] || '') === ADMIN_KEY;

function enrollStringFor(code) {
  return Buffer.from(JSON.stringify({ enrollUrl: `${PUBLIC_URL}/enroll`, code }))
    .toString('base64url');
}
function makeEnrollCode(talentId, ttlHours = 72) {
  const code = 'enr_' + crypto.randomBytes(9).toString('hex');
  enrollCodes.set(code, {
    talentId,
    expiresAt: new Date(Date.now() + ttlHours * 3600e3).toISOString(),
    used: false,
  });
  return code;
}
function checkRate(hash) {
  const now = Date.now();
  const r = rate.get(hash);
  if (!r || now - r.windowStart > RATE_WINDOW_MS) {
    rate.set(hash, { count: 1, windowStart: now });
    return true;
  }
  if (r.count >= RATE_LIMIT) return false;
  r.count += 1;
  return true;
}

/* ---------- rutas ---------- */
async function handle(req, res) {
  const { method, url } = req;

  if (method === 'GET' && url === '/health') {
    return send(res, 200, { ok: true, tokens: tokens.size, reportsReceived: reports.length });
  }

  /* --- administración: control de tokens --- */
  if (url.startsWith('/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'admin key requerida' });

    if (method === 'POST' && url === '/admin/enroll-codes') {
      const body = await readJson(req);
      if (!body || !body.talentId) return send(res, 400, { error: 'falta talentId' });
      const code = makeEnrollCode(body.talentId, body.ttlHours);
      return send(res, 201, {
        code,
        talentId: body.talentId,
        enrollString: enrollStringFor(code),
        // Esto es lo que mostrarías en el panel del talento:
        command: `ai-footprint --enroll=${enrollStringFor(code)}`,
      });
    }

    if (method === 'GET' && url === '/admin/tokens') {
      // Nunca se devuelve el token; solo su id público y metadatos de auditoría.
      const list = [...tokens.values()].map((t) => ({
        id: t.id, talentId: t.talentId, issuedAt: t.issuedAt,
        lastUsedAt: t.lastUsedAt, expiresAt: t.expiresAt, revoked: t.revoked,
      }));
      return send(res, 200, { tokens: list });
    }

    if (method === 'POST' && url === '/admin/revoke') {
      const body = await readJson(req);
      const target = body && body.id;
      for (const t of tokens.values()) {
        if (t.id === target) { t.revoked = true; return send(res, 200, { ok: true, id: target }); }
      }
      return send(res, 404, { error: 'token no encontrado' });
    }
    return send(res, 404, { error: 'ruta admin no encontrada' });
  }

  /* --- canje de código por token --- */
  if (method === 'POST' && url === '/enroll') {
    const body = await readJson(req);
    const code = body && body.code;
    const entry = code && enrollCodes.get(code);
    if (!entry) return send(res, 404, { error: 'código no reconocido' });
    if (entry.used) return send(res, 409, { error: 'código ya usado' });
    if (new Date(entry.expiresAt) < new Date()) return send(res, 400, { error: 'código caducado' });

    entry.used = true;
    const token = 'aft_' + crypto.randomBytes(24).toString('hex'); // se entrega UNA vez
    const hash = sha256(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 864e5).toISOString();
    tokens.set(hash, {
      id: 'tok_' + hash.slice(0, 12), // id público para auditar/revocar sin el secreto
      talentId: entry.talentId,
      issuedAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt,
      revoked: false,
    });
    return send(res, 200, { token, endpoint: `${PUBLIC_URL}/reports`, talentId: entry.talentId, expiresAt });
  }

  /* --- ingesta de informes --- */
  if (method === 'POST' && url === '/reports') {
    const token = bearer(req);
    const rec = token && tokens.get(sha256(token)); // se compara por hash
    if (!rec || rec.revoked) return send(res, 401, { error: 'token inválido o revocado' });
    if (new Date(rec.expiresAt) < new Date()) return send(res, 401, { error: 'token caducado' });
    if (!checkRate(sha256(token))) return send(res, 429, { error: 'límite de envíos superado' });

    const payload = await readJson(req);
    if (!payload || typeof payload.level !== 'number') return send(res, 400, { error: 'payload inválido' });

    rec.lastUsedAt = new Date().toISOString();
    reports.push({ talentId: rec.talentId, receivedAt: rec.lastUsedAt, report: payload });
    console.log(`[ingesta] talento=${rec.talentId} nivel=${payload.level} detectadas=${payload.totalDetected} score=${payload.score}`);
    return send(res, 201, { ok: true, talentId: rec.talentId });
  }

  send(res, 404, { error: 'no encontrado' });
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: String(e.message || e) }));
}).listen(PORT, () => {
  console.log(`\n  Servidor de referencia AI Footprint en ${PUBLIC_URL}`);
  console.log(`  (STUB en memoria — no usar en producción)\n`);
  console.log(`  ADMIN_KEY: ${ADMIN_KEY}`);
  if (!process.env.ADMIN_KEY) console.log(`  (generada al vuelo; fíjala con ADMIN_KEY=... para que persista)`);
  console.log(`\n  Emite un código para un talento:`);
  console.log(`    curl -s -X POST ${PUBLIC_URL}/admin/enroll-codes \\`);
  console.log(`      -H "X-Admin-Key: ${ADMIN_KEY}" -H "Content-Type: application/json" \\`);
  console.log(`      -d '{"talentId":"talent_123"}'\n`);
});
