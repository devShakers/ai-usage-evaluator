'use strict';

const http = require('http');
const https = require('https');

/*
 * Skill-certification client — RESOLVE phase (skill-code-certification,
 * issue 004 / ADR-001).
 *
 * Phase 1 of the two-phase server-side flow: the CLI sends ONLY the NAMES of
 * the technologies it detected locally (never code — code egress is the
 * separate certify phase, issue 005) to
 * `POST <AI_FOOTPRINT_CERTIFY_ENDPOINT>` and the Hub answers which map to a
 * certifiable Skill (a Skill in the catalog that the Talent has also
 * declared). Request `{email, technologies: string[]}`; response
 * `{certifiable: [{skillId, skillName, technology}], nonCertifiable:
 * [{technology, reason}]}` (nonCertifiable is optional — the caller also
 * derives it from detected-minus-certifiable, so an older/leaner server that
 * omits it still renders correctly).
 *
 * RESILIENCE CONTRACT differs from src/agent-synthesis.js on purpose. There,
 * any failure resolves to `null` and the report SILENTLY falls back to the
 * deterministic org chart, because that feature only enriches an
 * always-local report. Here there is NO local product and NO deterministic
 * fallback (ADR-001: you cannot certify a Skill offline). So instead of
 * swallowing failures, this returns a DISCRIMINATED result the caller
 * (bin/certify.js) turns into an actionable, human-readable message and a
 * non-zero exit — it must INFORM, never hang, never invent a result:
 *   { ok: true,  result: {certifiable, nonCertifiable} }
 *   { ok: false, reason: 'no-endpoint' | 'network-error' | 'timeout'
 *                        | 'http-<status>' | 'invalid-json' | 'invalid-shape',
 *     detail? }
 */

const DEFAULT_TIMEOUT_MS = 20000;

// Builds the resolve request body. `technologies` is defensively coerced to
// an array of the framework/library NAMES (src/tech-detector.js output). The
// email is expected already validated/normalized by the caller (share.js's
// isValidEmail/normalizeEmail) — this module doesn't re-validate identity,
// only shapes the wire body.
function buildResolveRequest(email, technologies) {
  return {
    email,
    technologies: Array.isArray(technologies) ? technologies.filter((t) => typeof t === 'string' && t) : [],
  };
}

function postJsonWithTimeout(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(Object.assign(e, { kind: 'invalid-url' }));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(body));
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, raw }));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('certify: resolve timed out'), { kind: 'timeout' })));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Validates the minimal expected resolve shape: `certifiable` must be an
// array; `nonCertifiable` defaults to [] when absent/invalid. Every element
// is rebuilt field-by-field (never spread) so an unexpected key from the
// server never propagates into the rendered/consumed result.
function normalizeResolveResponse(parsed) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.certifiable)) return null;
  return {
    certifiable: parsed.certifiable.map((c) => ({
      skillId: c && c.skillId != null ? c.skillId : null,
      skillName: c && typeof c.skillName === 'string' ? c.skillName : null,
      technology: c && typeof c.technology === 'string' ? c.technology : null,
    })),
    nonCertifiable: Array.isArray(parsed.nonCertifiable)
      ? parsed.nonCertifiable.map((n) => ({
          technology: n && typeof n.technology === 'string' ? n.technology : null,
          reason: n && typeof n.reason === 'string' ? n.reason : null,
        }))
      : [],
  };
}

async function requestResolve(requestBody, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, requestBody, timeoutMs);
  } catch (e) {
    if (e && e.kind === 'timeout') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network-error', detail: e && e.message };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: `http-${res.status}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(res.raw);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }

  const normalized = normalizeResolveResponse(parsed);
  if (!normalized) return { ok: false, reason: 'invalid-shape' };

  return { ok: true, result: normalized };
}

module.exports = { buildResolveRequest, requestResolve, normalizeResolveResponse, DEFAULT_TIMEOUT_MS };
