#!/usr/bin/env node
'use strict';

/*
 * REFERENCE SERVER (STUB) — DO NOT USE IN PRODUCTION AS-IS.
 *
 * talents-ai-score / ADR-007: this stub illustrates the CURRENT contract —
 * a PUBLIC ingestion endpoint, no per-identity auth, identity is a
 * self-affirmed EMAIL in the request body. It supersedes the previous
 * token/enrollment stub (ADR-005/006; see git history for /enroll and the
 * Bearer-token model). The REAL server for this contract is
 * `shakers-hub-backend` (specs.md, active-work/talents-ai-score) — this
 * file is contract documentation and a local testing aid, not what's
 * deployed. It is NOT run nor deployed anywhere (ADR-002).
 *
 * talents-ai-score / ADR-011: the KILL SWITCH is RETIRED (no more
 * `AI_FOOTPRINT_INGEST_ENABLED` gate — consent, enforced client-side, is
 * the only control now; see src/consent-flow.js/src/share.js). Also adds a
 * stub `/works/ai-footprint/agent-synthesis` endpoint (ADR-010) — here it's
 * a DETERMINISTIC placeholder (no real LLM), just enough to exercise the
 * CLI's request/response contract end to end locally; the real
 * implementation lives in shakers-hub-backend with an actual model call.
 *
 * Deliberate simplifications (to replace for real, in shakers-hub-backend):
 *   - IN-MEMORY store (lost on restart) -> Postgres, upsert by email/talent_id
 *     (see specs.md Data model: PK own to the row, talent_id nullable).
 *   - In-memory rate limiting -> Redis or equivalent (per-replica ceiling
 *     otherwise, see specs.md Backend integration points).
 *   - No email <-> Talent match here (this stub has no Talent database):
 *     every report is stored as a lead, keyed by normalized email. The real
 *     match against `users`/`users_works_talents` is shakers-hub-backend's
 *     job (a cross-module port, per specs.md).
 *   - No TLS here -> your gateway/load balancer provides it.
 *   - `/agent-synthesis` here is a NAIVE placeholder (title-cases the agent
 *     name, echoes its tool list as "what it does") — NOT an LLM call. The
 *     real endpoint synthesizes from the agent's DESCRIPTION content, which
 *     this stub never even asks for beyond structure (no model to feed it).
 *
 * Routes:
 *   GET  /health
 *   POST /reports                              {email, payload} -> public, no auth. 201 / 400 / 429
 *   POST /works/ai-footprint/agent-synthesis    {agents}         -> public, no auth. 200 / 400
 *   GET  /admin/reports   (X-Admin-Key)         -> lists stored reports (audit aid)
 *
 * Startup:  ADMIN_KEY=mykey node reference-server/server.js
 */

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 8787;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
// Admin key: if not passed via environment, one is generated and shown at startup.
const ADMIN_KEY = process.env.ADMIN_KEY || 'adm_' + crypto.randomBytes(16).toString('hex');

/* ---------- in-memory stores (replace with a real DB) ---------- */
// Keyed by normalized email. No Talent match in this stub (see header):
// every row here is what specs.md calls a "lead" until a real backend
// resolves talent_id.
const reports = new Map(); // email -> { email, receivedAt, payload }
const rateByEmail = new Map(); // email -> { count, windowStart }
const rateByIp = new Map();    // ip -> { count, windowStart }

/* ---------- utilities ---------- */

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
const isAdmin = (req) => (req.headers['x-admin-key'] || '') === ADMIN_KEY;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}
function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

// Same strict whitelist the CLI applies client-side (src/share.js#derivePayload),
// re-applied server-side by NAMING each field (specs.md: the global
// ValidationPipe alone doesn't enforce a class-validator whitelist).
//
// talents-ai-score, ADR-009/012/010-011: adds `agents`/`agentCounts`
// (structure + names only, never description — re-applied per-agent here
// too), `technologies` (dependency manifest names), and `agentSynthesis`
// (the synthesis RESULT only — `description` is never accepted here even if
// a client sent it, same "descarta cualquier prosa" invariant as ADR-009).
function whitelistPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.level !== 'number' || typeof payload.schemaVersion !== 'number') return null;
  return {
    schemaVersion: payload.schemaVersion,
    generatedAt: payload.generatedAt,
    anonId: payload.anonId,
    platform: payload.platform,
    level: payload.level,
    levelName: payload.levelName,
    score: payload.score,
    totalDetected: payload.totalDetected,
    categories: payload.categories,
    tools: Array.isArray(payload.tools)
      ? payload.tools.map((t) => ({ id: t.id, detected: !!t.detected, depth: t.depth || {} }))
      : [],
    agents: Array.isArray(payload.agents)
      ? payload.agents.map((a) => ({
          name: a.name,
          tools: Array.isArray(a.tools) ? a.tools : [],
          model: a.model || null,
          parent: a.parent || null,
        }))
      : [],
    agentCounts: payload.agentCounts && typeof payload.agentCounts === 'object'
      ? {
          agents: payload.agentCounts.agents || 0,
          skills: payload.agentCounts.skills || 0,
          commands: payload.agentCounts.commands || 0,
          mcpServers: payload.agentCounts.mcpServers || 0,
          hooks: payload.agentCounts.hooks || 0,
        }
      : { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    technologies: Array.isArray(payload.technologies) ? payload.technologies : [],
    agentSynthesis: Array.isArray(payload.agentSynthesis)
      ? payload.agentSynthesis.map((a) => ({
          name: a.name,
          symbolicName: a.symbolicName || null,
          whatItDoes: a.whatItDoes || null,
        }))
      : [],
  };
}

function checkRate(map, key) {
  const now = Date.now();
  const r = map.get(key);
  if (!r || now - r.windowStart > RATE_WINDOW_MS) {
    map.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (r.count >= RATE_LIMIT) return false;
  r.count += 1;
  return true;
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

/* ---------- routes ---------- */
async function handle(req, res) {
  const { method, url } = req;

  if (method === 'GET' && url === '/health') {
    return send(res, 200, { ok: true, reportsReceived: reports.size });
  }

  /* --- administration: audit only (no token control anymore, ADR-007) --- */
  if (url.startsWith('/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'admin key requerida' });

    if (method === 'GET' && url === '/admin/reports') {
      const list = [...reports.values()].map((r) => ({
        email: r.email,
        receivedAt: r.receivedAt,
        level: r.payload.level,
        score: r.payload.score,
      }));
      return send(res, 200, { reports: list });
    }
    return send(res, 404, { error: 'ruta admin no encontrada' });
  }

  /* --- report ingestion: public, no per-identity auth (ADR-007). --- */
  /* No kill switch anymore (ADR-011): consent, enforced client-side, is    */
  /* the only control over whether the CLI ever calls this at all.         */
  if (method === 'POST' && url === '/reports') {
    const body = await readJson(req);
    if (!body || !isValidEmail(body.email)) {
      return send(res, 400, { error: 'correo inválido o ausente' });
    }
    const payload = whitelistPayload(body.payload);
    if (!payload) {
      return send(res, 400, { error: 'payload inválido' });
    }

    const email = normalizeEmail(body.email);
    if (!checkRate(rateByEmail, email)) return send(res, 429, { error: 'límite de envíos superado (por correo)' });
    if (!checkRate(rateByIp, clientIp(req))) return send(res, 429, { error: 'límite de envíos superado (por IP)' });

    const receivedAt = new Date().toISOString();
    // Upsert by email — no Talent match in this stub (see header): the real
    // backend additionally tries talent_id first (specs.md Data model).
    reports.set(email, { email, receivedAt, payload });

    console.log(`[ingesta] correo=${email} nivel=${payload.level} detectadas=${payload.totalDetected} score=${payload.score}`);
    return send(res, 201, { ok: true });
  }

  /* --- agent synthesis: public, no per-identity auth, EPHEMERAL (ADR-010/ */
  /* 011) — nothing is stored here; this stub doesn't even try to run a     */
  /* real model, it's a deterministic placeholder for exercising the       */
  /* CLI's request/response contract locally. --- */
  if (method === 'POST' && url === '/works/ai-footprint/agent-synthesis') {
    const body = await readJson(req);
    if (!body || !Array.isArray(body.agents)) {
      return send(res, 400, { error: 'agents[] inválido o ausente' });
    }
    const titleCase = (s) => String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
    const agents = body.agents.map((a) => ({
      name: a.name,
      symbolicName: `The ${titleCase(a.name)}`,
      whatItDoes: Array.isArray(a.tools) && a.tools.length
        ? `Uses ${a.tools.join(', ')}`
        : 'No tools wired',
    }));
    const edges = agents.length > 1
      ? agents.slice(1).map((a) => ({ from: agents[0].name, to: a.name }))
      : [];
    return send(res, 200, { agents, edges });
  }

  send(res, 404, { error: 'no encontrado' });
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: String(e.message || e) }));
}).listen(PORT, () => {
  console.log(`\n  Servidor de referencia AI Footprint en ${PUBLIC_URL}`);
  console.log(`  (STUB en memoria — no usar en producción; el real es shakers-hub-backend)`);
  console.log(`  Sin kill switch (ADR-011): consentimiento cliente-side es el único control.\n`);
  console.log(`  ADMIN_KEY: ${ADMIN_KEY}`);
  if (!process.env.ADMIN_KEY) console.log(`  (generada al vuelo; fíjala con ADMIN_KEY=... para que persista)`);
  console.log(`\n  Auditar reportes recibidos:`);
  console.log(`    curl ${PUBLIC_URL}/admin/reports -H "X-Admin-Key: ${ADMIN_KEY}"\n`);
});
