'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const readline = require('readline');

/*
 * Capa de compartición OPT-IN.
 *
 * Principios:
 *  - El código público NO contiene ningún endpoint ni secreto. La URL a la que
 *    se envía llega DENTRO de la credencial que se obtiene al enrolarse.
 *  - Solo se envía un payload DERIVADO y mínimo (booleanos, conteos, nivel).
 *    Nunca contenido de ficheros, rutas ni credenciales del talento.
 *  - Antes de enviar nada se muestra el payload EXACTO y se pide confirmación.
 */

const CONFIG_DIR = path.join(os.homedir(), '.config', 'ai-footprint');
const CRED_PATH = path.join(CONFIG_DIR, 'credentials.json');

/* ---------- utilidad HTTP mínima (sin dependencias) ---------- */

function requestJson(method, url, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error(`URL inválida: ${url}`));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { Accept: 'application/json' };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = lib.request(
      u,
      { method, headers, timeout: 15000 },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* respuesta no-JSON */ }
          resolve({ status: res.statusCode, json, raw });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* ---------- credenciales ---------- */

function loadCredentials() {
  try {
    return JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveCredentials(cred) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CRED_PATH, JSON.stringify(cred, null, 2));
  try { fs.chmodSync(CRED_PATH, 0o600); } catch { /* p.ej. Windows */ }
}

/* ---------- enrolamiento ---------- */

// La cadena de enrolamiento es base64url de {enrollUrl, code}. La genera el
// panel de la plataforma, personalizada por talento, con un código de un solo uso.
function decodeEnrollString(str) {
  let obj;
  try {
    obj = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Código de enrolamiento no válido o corrupto.');
  }
  if (!obj.enrollUrl || !obj.code) {
    throw new Error('El código de enrolamiento no contiene enrollUrl y code.');
  }
  return obj;
}

async function enroll(enrollString) {
  const { enrollUrl, code } = decodeEnrollString(enrollString.trim());
  const res = await requestJson('POST', enrollUrl, { body: { code } });

  if (res.status === 200 && res.json && res.json.token && res.json.endpoint) {
    const cred = {
      endpoint: res.json.endpoint,
      token: res.json.token,
      talentId: res.json.talentId || null,
      enrolledAt: new Date().toISOString(),
      expiresAt: res.json.expiresAt || null,
    };
    saveCredentials(cred);
    return { ok: true, cred };
  }
  if (res.status === 409) return { ok: false, reason: 'Este código ya se ha usado.' };
  if (res.status === 404 || res.status === 400)
    return { ok: false, reason: 'Código no reconocido o caducado.' };
  return { ok: false, reason: `El servidor respondió ${res.status}.` };
}

/* ---------- payload derivado (whitelist estricta) ---------- */

// Solo estos campos salen del equipo. Aunque el objeto reporte crezca en el
// futuro, aquí se elige explícitamente qué se comparte.
//
// DECISIÓN PENDIENTE (talents-ai-score, ampliación de señales — dejar al
// humano, "default conservador" según el encargo): el escaneo local (scanner.js)
// ahora produce más campos por herramienta (version, footprint, recency) y a
// nivel de informe (environment: platform/arch/nodeVersion/editorsInstalled).
// NINGUNO se ha añadido aquí todavía. Propuesta, campo por campo:
//
//   - tool.version                     -> NO incluir por defecto. Aumenta la
//     capacidad de re-identificar/correlacionar el equipo entre envíos (huella
//     más fina que anonId) sin un valor de producto claro a cambio.
//   - tool.footprint (bytes/ficheros)  -> Riesgo bajo, sensibilidad similar a
//     los conteos de depth ya compartidos. Candidato razonable a incluir, pero
//     se deja a criterio humano: agrega tamaño real del equipo del talento, no
//     es tan "puro" como un booleano/nivel.
//   - tool.recency (mtime/días/bucket) -> NO incluir. Es la señal más sensible
//     de las nuevas: aunque es una fecha derivada (ADR-003), enviarla convierte
//     "huella de setup" en "monitorización de actividad" sobre cómo trabaja el
//     talento — el riesgo que ADR-003 dejó explícitamente gated. Requiere
//     revisión legal/RGPD antes de plantearlo siquiera.
//   - environment.arch / .nodeVersion  -> Riesgo bajo, útil para entender el
//     parque de máquinas del pool de talento. Candidato razonable.
//   - environment.editorsInstalled     -> Riesgo bajo-medio (añade otra
//     dimensión de fingerprint combinada con anonId). Fuera por defecto.
//
// Nada de lo anterior se activa solo: para incluir un campo, añadirlo aquí de
// forma explícita tras decisión humana (y documentarlo en decisions.md si es
// una decisión cross-role, ADR).
function derivePayload(report, maturity) {
  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    anonId: report.anonId,
    platform: report.platform,
    level: maturity.level,
    levelName: maturity.name,
    score: maturity.score,
    totalDetected: report.summary.totalDetected,
    categories: report.summary.categories,
    tools: report.tools.map((t) => ({
      id: t.id,
      detected: t.detected,
      depth: t.depth || {},
    })),
  };
}

/* ---------- consentimiento ---------- */

function askYesNo(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(false); // sin terminal: no enviar
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(/^s(i|í)?$/i.test(ans.trim()));
    });
  });
}

/* ---------- envío ---------- */

async function share(report, maturity, { assumeYes = false } = {}) {
  const cred = loadCredentials();
  if (!cred) {
    return {
      ok: false,
      reason:
        'No estás enrolado. Pide tu enlace en tu panel de Shakers y ejecuta:\n' +
        '  ai-footprint --enroll=TU_CODIGO',
    };
  }
  if (cred.expiresAt && new Date(cred.expiresAt) < new Date()) {
    return { ok: false, reason: 'Tu credencial ha caducado. Vuelve a enrolarte.' };
  }

  const payload = derivePayload(report, maturity);

  // Mostrar SIEMPRE el payload exacto antes de enviar.
  process.stdout.write('\n  Esto es exactamente lo que se enviaría a la plataforma:\n\n');
  process.stdout.write(
    JSON.stringify(payload, null, 2).split('\n').map((l) => '    ' + l).join('\n') + '\n\n',
  );
  process.stdout.write(`  Destino: ${cred.endpoint}\n`);
  if (cred.talentId) process.stdout.write(`  Como talento: ${cred.talentId}\n`);
  process.stdout.write('  No se incluye ningún contenido de ficheros, ruta ni credencial.\n\n');

  const go = assumeYes || (await askYesNo('  ¿Enviar este informe? [s/N] '));
  if (!go) return { ok: false, reason: 'Envío cancelado. No se ha enviado nada.' };

  const res = await requestJson('POST', cred.endpoint, { token: cred.token, body: payload });
  if (res.status >= 200 && res.status < 300) return { ok: true, response: res.json };
  if (res.status === 401) return { ok: false, reason: 'Credencial rechazada (401). Vuelve a enrolarte.' };
  if (res.status === 429) return { ok: false, reason: 'Demasiados envíos (429). Prueba más tarde.' };
  return { ok: false, reason: `El servidor respondió ${res.status}.` };
}

module.exports = {
  enroll,
  share,
  derivePayload,
  loadCredentials,
  CRED_PATH,
};
