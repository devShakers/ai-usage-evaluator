'use strict';

const http = require('http');
const https = require('https');

const { scrubSecrets } = require('./agent-synthesis');

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
// The certify phase runs one gemini-2.5-pro call PER Skill server-side, SEQUENTIALLY
// (specs.md AI/LLM). On a REAL repo each call can take ~50s+ (large sampled input:
// ~150k est-tokens → ~250k model tokens; the backend allows up to 5min PER call).
// So a fixed whole-request timeout is wrong: N Skills ≈ N × per-call latency. This
// floor covers a single Skill; multi-Skill runs scale via `certifyTimeoutForItems`
// below (a 2-Skill run is ~106s, which the old flat 90s aborted mid-run even
// though the backend completed both calls). Zero client retries in V1 (specs.md).
const DEFAULT_CERTIFY_TIMEOUT_MS = 90000;
// Per-Skill HTTP budget the CLI waits for each sequential server-side call.
// Generous over the observed ~53s (≈3x) yet under the backend's 5min per-call
// ceiling, so the CLI stops waiting only well after the model realistically
// would have answered.
const PER_SKILL_CERTIFY_TIMEOUT_MS = 150000;

/**
 * HTTP timeout for a CERTIFY request covering `itemCount` Skills — the server
 * processes them SEQUENTIALLY (one gemini-2.5-pro call each), so the client must
 * wait roughly `itemCount × per-call`. Floored at `DEFAULT_CERTIFY_TIMEOUT_MS`
 * for a single Skill. Pure/deterministic (unit-testable).
 */
function certifyTimeoutForItems(itemCount) {
  const n = Number.isFinite(itemCount) && itemCount > 0 ? Math.floor(itemCount) : 1;
  return Math.max(DEFAULT_CERTIFY_TIMEOUT_MS, n * PER_SKILL_CERTIFY_TIMEOUT_MS);
}
const SCORE_MIN = 0;
const SCORE_MAX = 100;

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
    // ADR-023: the authorized authoring set for a TEST identity, or null for a
    // real identity. Server-gated — the CLI only ever widens the authorship
    // gate when the SERVER returns a set here (real identities get null).
    authorizedAuthoring: normalizeAuthorizedAuthoring(parsed.authorizedAuthoring),
  };
}

// Field-by-field, defensive: a malformed set degrades to null (strict match).
function normalizeAuthorizedAuthoring(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const domain = typeof raw.domain === 'string' && raw.domain ? raw.domain : null;
  const extraEmails = Array.isArray(raw.extraEmails)
    ? raw.extraEmails.filter((e) => typeof e === 'string' && e)
    : [];
  if (!domain && extraEmails.length === 0) return null;
  return { domain, extraEmails };
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

/* ============================ CERTIFY phase ============================ */

/*
 * Phase 2 (skill-code-certification, issue 005 / ADR-001): send the SAMPLED,
 * SCRUBBED code for the Skills the Talent chose, and get an LLM assessment
 * per Skill. Request `{email, items:[{skillId, technology, files:[{path,
 * content}]}]}`; response `{results:[{skillId, skillName, score, rationale,
 * improvements[]}]}`.
 *
 * scrubSecrets is applied to EVERY file content HERE, at the request builder —
 * the mandatory ADR-001 mitigation must hold even if the caller forgot (same
 * defense-in-depth as agent-synthesis.js re-scrubbing at the boundary). The
 * caller (bin/certify.js) also scrubs while sampling; this is the last guard.
 */
function buildCertifyRequest(email, sampledSkills, locale = null) {
  const items = (Array.isArray(sampledSkills) ? sampledSkills : [])
    .filter((s) => s && Array.isArray(s.files) && s.files.length > 0)
    .map((s) => ({
      skillId: s.skillId,
      technology: s.technology,
      files: s.files.map((f) => ({
        path: typeof f.path === 'string' ? f.path : '',
        content: scrubSecrets(typeof f.content === 'string' ? f.content : ''),
      })),
    }));
  // ADR-026: detected report language for the model prose (rationale/improvements).
  return { email, items, ...(locale === 'es' || locale === 'en' ? { locale } : {}) };
}

function clampScore(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, value));
}

// Defensive, field-by-field reconstruction (never spread): the server fixes
// skillId/skillName, score is clamped to range, improvements coerced to a
// string array. An item missing `results[]` -> invalid shape. `perFileBreakdown`
// (ADR-017) is carried through when present and well-shaped, else null — it is
// observability-additive, never a reason to reject the response.
function normalizeCertifyResponse(parsed) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results)) return null;
  return {
    results: parsed.results.map((r) => ({
      skillId: r && r.skillId != null ? r.skillId : null,
      skillName: r && typeof r.skillName === 'string' ? r.skillName : null,
      score: clampScore(r && r.score),
      rationale: r && typeof r.rationale === 'string' ? r.rationale : '',
      improvements:
        r && Array.isArray(r.improvements)
          ? r.improvements.filter((i) => typeof i === 'string' && i)
          : [],
      // ADR-024: anchored 0-4 dimensions that produced the deterministic score.
      dimensions: normalizeDimensions(r && r.dimensions),
      perFileBreakdown: normalizePerFileBreakdown(r && r.perFileBreakdown),
    })),
  };
}

// Per-file scores from the certify response (ADR-017). Each entry is rebuilt
// field-by-field; a non-numeric score or non-string path drops that entry.
// Returns null (not []) when nothing usable survives — the caller treats a null
// breakdown as "aggregate-only", so a legacy server that omits `perFileBreakdown`
// keeps working unchanged.
function normalizePerFileBreakdown(raw) {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .filter((f) => f && typeof f.path === 'string' && f.path && typeof f.score === 'number')
    .map((f) => ({
      path: f.path,
      score: clampScore(f.score),
      note: typeof f.note === 'string' && f.note ? f.note : null,
    }));
  return out.length > 0 ? out : null;
}

// The fixed rubric dimensions (ADR-024). Each value is an int 0-4 or null (N/A).
const RUBRIC_DIMENSION_KEYS = ['idiomatic', 'correctness', 'depth', 'structure', 'testing'];

// Rebuilds the dimensions object key-by-key: each key becomes an int 0-4 or
// null. Returns null when the response has no usable dimensions object (a
// legacy/aggregate-only server) — the caller then renders score-only.
function normalizeDimensions(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  let any = false;
  for (const key of RUBRIC_DIMENSION_KEYS) {
    const v = raw[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4) {
      out[key] = v;
      any = true;
    } else {
      out[key] = null;
    }
  }
  return any ? out : null;
}

async function requestCertify(requestBody, { endpoint, timeoutMs = DEFAULT_CERTIFY_TIMEOUT_MS } = {}) {
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

  const normalized = normalizeCertifyResponse(parsed);
  if (!normalized) return { ok: false, reason: 'invalid-shape' };

  return { ok: true, result: normalized };
}

/*
 * Classifies a resolve/certify failure reason (from requestResolve /
 * requestCertify) into a UX category, so the CLI shows the RIGHT message
 * instead of collapsing every non-2xx into the generic connection error
 * (skill-code-certification, issue 014):
 *   - 'gate'      -> HTTP 403: the email isn't a registered ACTIVE Talent.
 *                   An EXPECTED outcome of the gate, NOT a technical error —
 *                   calm/informative message, clean exit, no retry hint.
 *   - 'too-large' -> HTTP 413: the sampled payload is too big. A specific,
 *                   actionable message (reduce scope), not "check your
 *                   connection".
 *   - 'technical' -> everything else (no-endpoint, network-error, timeout,
 *                   invalid-json/shape, 5xx and any other non-2xx): a real
 *                   error, generic retry hint is appropriate.
 * Pure/deterministic — unit-testable without the network.
 */
function classifyCertifyFailure(reason) {
  if (reason === 'http-403') return 'gate';
  if (reason === 'http-413') return 'too-large';
  return 'technical';
}

module.exports = {
  buildResolveRequest,
  requestResolve,
  normalizeResolveResponse,
  classifyCertifyFailure,
  buildCertifyRequest,
  requestCertify,
  normalizeCertifyResponse,
  certifyTimeoutForItems,
  RUBRIC_DIMENSION_KEYS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CERTIFY_TIMEOUT_MS,
  PER_SKILL_CERTIFY_TIMEOUT_MS,
};
