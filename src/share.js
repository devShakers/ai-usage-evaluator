'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

/*
 * Capa de compartición.
 *
 * Principios:
 *  - El código público NO contiene ningún endpoint ni secreto. La URL a la que
 *    se envía llega DENTRO de la credencial que se obtiene al enrolarse.
 *  - Solo se envía un payload DERIVADO y mínimo (booleanos, conteos, nivel).
 *    Nunca contenido de ficheros, rutas ni credenciales del talento.
 *  - talents-ai-score / ADR-005: se retira el preview + confirmación
 *    interactiva. El envío es AUTOMÁTICO al final de un run normal si hay
 *    credencial vigente y el flag de consentimiento (persistido en la propia
 *    credencial) está ON. "Construir el mecanismo no es activarlo": el flag
 *    sigue existiendo justamente para poder apagar el envío sin tocar código
 *    (además del kill switch de servidor — doble interruptor, ADR-005).
 */

const CONFIG_DIR = path.join(os.homedir(), '.config', 'ai-footprint');
const CRED_PATH = path.join(CONFIG_DIR, 'credentials.json');

// Throttle cliente: no reintentar un envío si el último fue hace menos de 1h.
// Independiente del rate-limit del servidor (eso lo aplica el backend).
const SEND_THROTTLE_MS = 60 * 60 * 1000;

// DEFAULT del flag de consentimiento persistido en la credencial.
//
// ADR-006 (active-work/talents-ai-score/decisions.md) revisa explícitamente
// el default OFF de ADR-005 a ON: "el usuario decide que el envío se haga
// desde el arranque, sin defaults en OFF". El mecanismo de apagado (este flag
// + el kill switch de servidor) se mantiene intacto — solo cambia el valor
// por defecto. Por su propia salvedad, ADR-006 ES el punto de no retorno de
// ADR-005: sigue requiriendo visto bueno legal/laboral ANTES de desplegar el
// backend y distribuir el CLI (ese despliegue, no este código, es lo que
// arranca el flujo real de datos sobre talentos reales).
const DEFAULT_CONSENT = true;

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

/* ---------- consentimiento ----------
 *
 * El flag vive en la credencial local, no como argumento por-run (specs.md
 * #cli-changes-ai-usage-evaluator). Default ON (ADR-006). `setConsent` es el
 * mecanismo para apagarlo/encenderlo sin re-enrolar ni tocar código —
 * necesario para poder revertir a OFF (o a opt-in restaurando el bloque de
 * confirmación en código) si el gate legal de ADR-005/006 lo exige.
 */

function hasConsent(cred) {
  if (!cred) return false;
  return cred.consent === undefined ? DEFAULT_CONSENT : !!cred.consent;
}

function setConsent(enabled) {
  const cred = loadCredentials();
  if (!cred) {
    return {
      ok: false,
      reason: 'No estás enrolado. Enrólate primero con: ai-footprint --enroll=TU_CODIGO',
    };
  }
  cred.consent = !!enabled;
  saveCredentials(cred);
  return { ok: true, cred };
}

/* ---------- throttle cliente ---------- */

function isThrottled(cred, now = Date.now()) {
  if (!cred || !cred.lastSentAt) return false;
  const last = new Date(cred.lastSentAt).getTime();
  if (Number.isNaN(last)) return false;
  return now - last < SEND_THROTTLE_MS;
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
      consent: DEFAULT_CONSENT,
      lastSentAt: null,
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

/* ---------- envío automático ---------- */

// Envío silencioso: sin preview ni confirmación (ADR-005). Se invoca al final
// de un run normal. Nunca lanza — cualquier motivo para no enviar o cualquier
// fallo de envío resuelve con { ok:false, ... }, nunca rompe el informe local.
async function autoShare(report, maturity) {
  const cred = loadCredentials();
  if (!cred) return { ok: false, skipped: true, reason: 'not-enrolled' };
  if (cred.expiresAt && new Date(cred.expiresAt) < new Date()) {
    return { ok: false, skipped: true, reason: 'expired' };
  }
  if (!hasConsent(cred)) return { ok: false, skipped: true, reason: 'consent-off' };
  if (isThrottled(cred)) return { ok: false, skipped: true, reason: 'throttled' };

  const payload = derivePayload(report, maturity);

  let res;
  try {
    res = await requestJson('POST', cred.endpoint, { token: cred.token, body: payload });
  } catch (e) {
    // Fallo de red: no rompe el informe local.
    return { ok: false, skipped: false, reason: 'network-error', error: e.message };
  }

  if (res.status >= 200 && res.status < 300) {
    cred.lastSentAt = new Date().toISOString();
    saveCredentials(cred);
    return { ok: true, response: res.json };
  }
  if (res.status === 401) {
    return {
      ok: false,
      skipped: false,
      reason: 'unauthorized',
      notice: 'Tu credencial ya no es válida. Vuelve a enrolarte: ai-footprint --enroll=TU_CODIGO',
    };
  }
  if (res.status === 429) {
    return { ok: false, skipped: false, reason: 'rate-limited' };
  }
  return { ok: false, skipped: false, reason: `http-${res.status}` };
}

module.exports = {
  enroll,
  autoShare,
  setConsent,
  hasConsent,
  isThrottled,
  derivePayload,
  loadCredentials,
  CRED_PATH,
  SEND_THROTTLE_MS,
  DEFAULT_CONSENT,
};
