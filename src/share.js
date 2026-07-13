'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const { getIngestEndpoint } = require('./config');
const { scrubSecrets } = require('./agent-synthesis');

/*
 * Sharing (= PERSISTENCE) layer.
 *
 * talents-ai-score / ADR-007 pivots the sending model away from token-based
 * enrollment to PER-RUN OPT-IN CONSENT + self-affirmed EMAIL IDENTITY
 * (supersedes ADR-005/006, which this file used to implement — see git
 * history for the retired `enroll()`/`decodeEnrollString()`/token model).
 *
 * talents-ai-score / ADR-011 (revises the gating half of ADR-007/008, keeps
 * the rest): the LOCAL REPORT is now ALWAYS computed and shown, unconditionally
 * — this module has nothing to do with that anymore. What this module still
 * governs is exactly one thing: whether the report gets PERSISTED (saved) in
 * Shakers. There is NO kill switch anymore (ADR-011 retires
 * `AI_FOOTPRINT_INGEST_ENABLED` client-side awareness of it): consent is the
 * only control.
 *
 * Principles (ADR-007, gating parts revised by ADR-011):
 *  - No decision persisted -> a SHORT consent-to-persist question is asked
 *    once (src/consent-flow.js drives that interaction; this module only
 *    PERSISTS the resulting decision and SENDS). It is asked AFTER the local
 *    report has already been shown, never as a wall blocking it.
 *  - ACCEPT -> ask for an email, send `{email, payload}`, persist
 *    `consent=granted` + the email. Every following run resends silently
 *    (same `autoShare` code path, first grant included).
 *  - DECLINE -> persist `consent=denied`. Local report only, never asks
 *    again (only an explicit revoke/re-consent command can change this).
 *  - Only a DERIVED payload is sent (booleans, counts, level, technologies,
 *    the agent-synthesis RESULT — never raw descriptions) — never file
 *    contents, paths, or credentials. The email travels OUTSIDE the
 *    whitelisted payload, in the request body's `email` field.
 *  - The public code contains NO endpoint or secret: the destination URL
 *    comes from outside the code (src/config.js), never hardcoded.
 *  - There is no `Authorization` header anymore: the ingestion endpoint is
 *    public, with no per-identity auth (the CLI itself is a public repo, so
 *    any embedded secret would stop being one). Identity travels in the
 *    body, not a header.
 */

// `configDir`/`consentPath` are resolved LAZILY (not cached at module load)
// so tests can point them at a throwaway directory via
// AI_FOOTPRINT_CONFIG_DIR without needing a fresh module instance (same
// override pattern install.sh already uses for AI_FOOTPRINT_HOME/BIN).
function configDir() {
  return process.env.AI_FOOTPRINT_CONFIG_DIR || path.join(os.homedir(), '.config', 'ai-footprint');
}

function consentPath() {
  return path.join(configDir(), 'consent.json');
}

// Client-side throttle: don't retry a submission if the last one was less
// than 1h ago. Independent of the server's rate limit (that's enforced by
// the backend, per correo normalizado + IP per specs.md).
const SEND_THROTTLE_MS = 60 * 60 * 1000;

// skill-code-certification, issue 005: a SEPARATE client-side throttle for
// certification persistence, so re-persisting the (expensive) certify result
// doesn't spam the backend — kept independent of the footprint send throttle
// (its own `lastCertifySentAt` field) so neither clobbers the other.
const CERTIFY_SEND_THROTTLE_MS = 60 * 60 * 1000;
const CERT_SCHEMA_VERSION = 1;

/* ---------- minimal HTTP utility (no dependencies) ---------- */

// No `token`/`Authorization` anymore (ADR-007): the ingestion endpoint is
// public, identity travels in the body.
function requestJson(method, url, { body } = {}) {
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

    const req = lib.request(
      u,
      { method, headers, timeout: 15000 },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* non-JSON response */ }
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

/* ---------- consent state (~/.config/ai-footprint/consent.json) ----------
 *
 * Replaces the old `credentials.json` (token model). Shape:
 *   { consent: 'granted' | 'denied' | undefined, email, lastSentAt }
 * `consent` undefined/missing means "no decision yet" — a THIRD state,
 * distinct from `denied`. Nothing is sent in either "no decision" or
 * "denied"; only an explicit `granted` (with an email) sends.
 */

function loadConsentState() {
  try {
    return JSON.parse(fs.readFileSync(consentPath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveConsentState(state) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(consentPath(), JSON.stringify(state, null, 2));
  try { fs.chmodSync(consentPath(), 0o600); } catch { /* e.g. Windows */ }
}

// Returns 'granted' | 'denied' | null ("no decision persisted yet").
function getConsentDecision(state) {
  if (!state || state.consent === undefined || state.consent === null) return null;
  return state.consent;
}

/* ---------- email ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Basic format validation only (specs.md: "validación de formato básica").
// The email is self-affirmed and never verified in this iteration
// (ADR-007's caveat: "indicativo, no verificado").
function isValidEmail(value) {
  return typeof value === 'string' && EMAIL_RE.test(value.trim());
}

// Same normalization the backend applies (specs.md Data model): trim +
// lowercase, so client and server agree on what "the same email" means.
function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

// Persists a consent decision. `email` is required (and validated) when
// granting; optional/omitted otherwise (e.g. recording a `denied`).
// Throws on invalid input — callers (consent-flow.js, bin/report.js) are
// expected to validate interactively before calling this, this is the last
// guard against ever persisting a half-formed decision.
function recordConsent(decision, email = null) {
  if (decision !== 'granted' && decision !== 'denied') {
    throw new Error(`Decisión de consentimiento no válida: ${decision}`);
  }
  if (decision === 'granted' && !isValidEmail(email)) {
    throw new Error('No se puede conceder consentimiento sin un correo válido.');
  }
  const state = loadConsentState() || {};
  state.consent = decision;
  if (email !== null) state.email = normalizeEmail(email);
  if (state.lastSentAt === undefined) state.lastSentAt = null;
  saveConsentState(state);
  return state;
}

/* ---------- consent management (issue 007: status / revoke / change email) ----------
 *
 * One-shot actions (do not scan), same pattern the retired `--enroll` used.
 * GDPR-adjacent requirement (ADR-007): revocation must be trivial and must
 * not require re-running the disclosure or scanning anything.
 */

// Read-only snapshot for `--consent-status`. Never throws.
function getConsentStatus() {
  const state = loadConsentState();
  return {
    consent: getConsentDecision(state),
    email: state && state.email ? state.email : null,
    lastSentAt: state && state.lastSentAt ? state.lastSentAt : null,
  };
}

// Revokes consent unconditionally (works even with no prior decision, or
// after a prior `denied` — idempotent): from this point on `autoShare`
// skips with `consent-denied`. Does NOT re-scan or send a "last" report,
// and does NOT clear the persisted email (kept for context/audit; a talent
// who re-grants later doesn't have to retype it, though they still can via
// `--consent-email` or by going through the disclosure flow again).
function revokeConsent() {
  const state = recordConsent('denied');
  return { ok: true, state };
}

// Changes the persisted email WITHOUT touching the consent decision
// (specs.md: "sin tocar la decisión de consentimiento"). Works whether or
// not a decision exists yet; the next successful send (if consent is
// `granted`) uses the new email.
function setEmail(newEmail) {
  if (!isValidEmail(newEmail)) {
    return { ok: false, reason: 'invalid-email' };
  }
  const state = loadConsentState() || {};
  state.email = normalizeEmail(newEmail);
  saveConsentState(state);
  return { ok: true, state };
}

/* ---------- client-side throttle ---------- */

function isThrottled(state, now = Date.now()) {
  if (!state || !state.lastSentAt) return false;
  const last = new Date(state.lastSentAt).getTime();
  if (Number.isNaN(last)) return false;
  return now - last < SEND_THROTTLE_MS;
}

/* ---------- derived payload (strict whitelist) ---------- */

// Only these fields leave the machine. Even if the report object grows in
// the future, what's shared is chosen explicitly here. Unchanged by
// ADR-007: the email is NOT part of this whitelist — it travels outside the
// payload, in the request body (`{email, payload}`).
//
// PENDING DECISION (talents-ai-score, signal expansion — left to a human,
// "conservative default" per the brief): the local scan (scanner.js) now
// produces more per-tool fields (version, footprint, recency) and
// report-level fields (environment: platform/arch/nodeVersion/
// editorsInstalled). NONE of them have been added here yet. Proposal,
// field by field:
//
//   - tool.version                     -> Do NOT include by default.
//     Increases the ability to re-identify/correlate the machine across
//     submissions (a finer fingerprint than anonId) with no clear product
//     value in return.
//   - tool.footprint (bytes/files)     -> Low risk, similar sensitivity to
//     the depth counts already shared. Reasonable candidate to include, but
//     left to human judgment: it adds the talent's actual machine size,
//     which isn't as "pure" as a boolean/level.
//   - tool.recency (mtime/days/bucket) -> Do NOT include. It's the most
//     sensitive of the new signals: even though it's a derived date
//     (ADR-003), sending it turns "setup footprint" into "activity
//     monitoring" of how the talent works — the exact risk ADR-003
//     explicitly gated. Requires legal/GDPR review before even considering it.
//   - environment.arch / .nodeVersion  -> Low risk, useful to understand
//     the talent pool's machine landscape. Reasonable candidate.
//   - environment.editorsInstalled     -> Low-medium risk (adds another
//     fingerprinting dimension combined with anonId). Off by default.
//
// None of the above activates on its own: to include a field, add it here
// explicitly after a human decision (and document it in decisions.md if
// it's a cross-role decision, ADR).
//
// talents-ai-score, ADR-009 (matiza ADR-003): adds the deterministic (no-LLM)
// agent org chart to the whitelist — structure + names only (name, wired
// tools, model, hierarchy). EXCLUDED explicitly, by construction of
// src/agent-org-chart.js and re-applied here per-agent: descriptions/
// prompts/system-prompts, file content, paths, env vars, credentials. Every
// agent object is rebuilt field-by-field (never spread) so an unexpected
// extra key on the scanner's object (e.g. a `description` that slipped in)
// can never reach the payload.
//
// talents-ai-score, ADR-012: adds `technologies` (dependency manifest names
// only, src/tech-detector.js) — associated server-side with Shakers' Skill
// catalog only at persistence time.
//
// talents-ai-score, ADR-010/ADR-011: adds `agentSynthesis` — the STRUCTURED
// RESULT of the ephemeral agent-synthesis call (`{name, symbolicName,
// whatItDoes}` per agent), read from `report.agentSynthesis.agents` if the
// caller (bin/report.js) attached one this run. Rebuilt field-by-field
// (never spread): the raw `description` text sent to the synthesis endpoint
// is NEVER part of this whitelist — only the synthesized summary is, and
// only if it actually reached this shape. Empty when synthesis failed and
// the run fell back to the deterministic org chart (nothing to persist from
// a call that never returned a result).
//
// talents-ai-score, issue 019/022 (ADR-014): adds `tier`/`tierKey`/`band` —
// the tier engine's result (src/tier-engine.js via maturity.js#classify).
// `band` duplicates `level` numerically but under the exact name the
// level-model.md / backend issue 023 contract uses ("tier (T0-T7) + band
// (0-4)"), so the persisted shape matches verbatim what the backend expects.
//
// talents-ai-score, issue 022 (ADR-013/014): adds the level-up framework's
// new detector signals — EACH re-applied as its own explicit whitelist
// (never spread), same invariant as agents/agentSynthesis above:
//   - `mcp`: ONLY `{countsByCategory, total}` — individual MCP SERVER NAMES
//     (`report.mcp.servers`) are deliberately dropped here; they stay local
//     only (issue 015's names are for the local report, not persistence).
//   - `memory`: ONLY `{totalImports, maxDepth, layered}` — per-file details
//     (`report.memory.files`, which carries file ids/sizes) never persisted.
//   - `automations`: counts/booleans + `inspected` per scheduler
//     (src/automations-detector.js's shape already IS derived-only; still
//     rebuilt field-by-field defensively, never spread).
//   - `browserTools`: `{detected, count, via}` — `via`'s names were already
//     whitelisted upstream by tech-detector.js/mcp-detector.js.
function whitelistSchedulerProbe(probe) {
  return {
    inspected: !!(probe && probe.inspected),
    matches: probe && typeof probe.matches === 'number' ? probe.matches : 0,
  };
}

function derivePayload(report, maturity) {
  const agents = Array.isArray(report.agents) ? report.agents : [];
  const technologies = Array.isArray(report.technologies) ? report.technologies : [];
  const synthesisAgents =
    report.agentSynthesis && Array.isArray(report.agentSynthesis.agents)
      ? report.agentSynthesis.agents
      : [];

  const mcp = report.mcp || {};
  const memory = report.memory || {};
  const automations = report.automations || {};
  const automationsScripts = automations.scripts || {};
  const automationsSchedulers = automations.schedulers || {};
  const browserTools = report.browserTools || {};
  const browserToolsVia = browserTools.via || {};

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
    agents: agents.map((a) => ({
      name: a.name,
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || null,
      parent: a.parent || null,
    })),
    agentCounts: report.agentCounts || { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    technologies,
    agentSynthesis: synthesisAgents.map((a) => ({
      name: a.name,
      symbolicName: a.symbolicName || null,
      whatItDoes: a.whatItDoes || null,
    })),
    // talents-ai-score, issue 022 follow-up (CLI<->backend contract
    // reconciliation): `band` was dropped — it's redundant with `level`
    // (already the 0-4 band, now tier-derived per issue 019); the backend
    // uses `level`/`levelName` as the band. Only `tier`/`tierKey` (the
    // finer T0-T7 axis) are new here.
    tier: typeof maturity.tier === 'number' ? maturity.tier : null,
    tierKey: maturity.tierKey || null,
    mcp: {
      countsByCategory: { ...(mcp.countsByCategory || { data: 0, comms: 0, dev: 0, browser: 0, other: 0 }) },
      total: typeof mcp.total === 'number' ? mcp.total : 0,
    },
    memory: {
      totalImports: typeof memory.totalImports === 'number' ? memory.totalImports : 0,
      maxDepth: typeof memory.maxDepth === 'number' ? memory.maxDepth : 0,
      layered: !!memory.layered,
    },
    automations: {
      scripts: {
        npm: typeof automationsScripts.npm === 'number' ? automationsScripts.npm : 0,
        shell: typeof automationsScripts.shell === 'number' ? automationsScripts.shell : 0,
      },
      jsonPiping: typeof automations.jsonPiping === 'number' ? automations.jsonPiping : 0,
      schedulers: {
        cron: whitelistSchedulerProbe(automationsSchedulers.cron),
        launchd: whitelistSchedulerProbe(automationsSchedulers.launchd),
        pm2: whitelistSchedulerProbe(automationsSchedulers.pm2),
        systemd: whitelistSchedulerProbe(automationsSchedulers.systemd),
      },
    },
    // talents-ai-score, issue 022 follow-up: `via` is now ORIGIN FLAGS ONLY
    // (booleans), not the package/MCP names — same "names stay local only"
    // invariant already applied to `mcp.servers` (issue 015). The local
    // report (report.browserTools.via) keeps the actual names; only whether
    // each origin fired travels in the persistence payload.
    browserTools: {
      detected: !!browserTools.detected,
      count: typeof browserTools.count === 'number' ? browserTools.count : 0,
      via: {
        dependency: Array.isArray(browserToolsVia.dependencies) && browserToolsVia.dependencies.length > 0,
        mcp: Array.isArray(browserToolsVia.mcp) && browserToolsVia.mcp.length > 0,
      },
    },
  };
}

/* ---------- automatic sending ---------- */

// Silent sending: no preview or confirmation once `granted` is persisted
// (ADR-007 keeps this invariant from ADR-005/006 — only the gate to reach
// `granted` changes, from "default ON" to "explicit opt-in disclosure").
// Invoked at the end of a normal run, and also right after a talent grants
// consent for the first time (same code path, no special-casing "first
// send" vs "resend"). Never throws — any reason not to send, or any sending
// failure, resolves with { ok:false, ... }, never breaks the local report.
async function autoShare(report, maturity) {
  const state = loadConsentState();
  const decision = getConsentDecision(state);

  if (decision !== 'granted') {
    return { ok: false, skipped: true, reason: decision === 'denied' ? 'consent-denied' : 'no-decision' };
  }
  if (!state.email) {
    return { ok: false, skipped: true, reason: 'no-email' };
  }
  if (isThrottled(state)) {
    return { ok: false, skipped: true, reason: 'throttled' };
  }

  const endpoint = getIngestEndpoint();
  if (!endpoint) {
    return { ok: false, skipped: true, reason: 'no-endpoint-configured' };
  }

  const payload = derivePayload(report, maturity);

  let res;
  try {
    res = await requestJson('POST', endpoint, { body: { email: state.email, payload } });
  } catch (e) {
    // Network failure: doesn't break the local report.
    return { ok: false, skipped: false, reason: 'network-error', error: e.message };
  }

  if (res.status >= 200 && res.status < 300) {
    state.lastSentAt = new Date().toISOString();
    saveConsentState(state);
    return { ok: true, response: res.json };
  }
  if (res.status === 429) {
    return { ok: false, skipped: false, reason: 'rate-limited' };
  }
  if (res.status === 503) {
    // Generic "service unavailable" from the server (ADR-011 retires the
    // server-side kill switch that used to be the main 503 cause).
    return { ok: false, skipped: false, reason: 'service-unavailable' };
  }
  return { ok: false, skipped: false, reason: `http-${res.status}` };
}

/* ---------- certification persistence (skill-code-certification, issue 005) ----------
 *
 * ADR-002 "Camino 2": persist ONLY the ALREADY-ANALYZED result (score /
 * rationale / improvements per Skill) — NEVER the code. ADR-011 consent model
 * reused verbatim: shown-always-local is bin/certify.js's job; this only
 * persists, and only when consent is `granted`. Transport (O-2): re-submit
 * through the SAME /reports ingestion contract ({email, payload}) the
 * footprint uses — the backend distinguishes by `payload.kind`. Prose
 * (rationale/improvements) is SCRUBBED before leaving the machine (ADR-002:
 * the LLM might have quoted code despite the prompt's "reference, don't
 * quote" rule).
 */

// Strict whitelist: the analyzed RESULT only, rebuilt field-by-field (never
// spread). No file content, path, or raw sample ever appears here — those
// were ephemeral to the certify request and are not persisted (ADR-001).
function deriveCertificationPayload(items, { model = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const skillCodeAssessments = list
    .filter((i) => i && i.result && typeof i.result === 'object')
    .map((i) => ({
      skillId: i.skillId != null ? i.skillId : null,
      skillName: typeof i.skillName === 'string' ? i.skillName : null,
      technology: typeof i.technology === 'string' ? i.technology : null,
      score: typeof i.result.score === 'number' ? i.result.score : null,
      rationale: scrubSecrets(typeof i.result.rationale === 'string' ? i.result.rationale : ''),
      improvements: Array.isArray(i.result.improvements)
        ? i.result.improvements.filter((x) => typeof x === 'string' && x).map((x) => scrubSecrets(x))
        : [],
      sampled: !!(i.sampling && i.sampling.sampleable),
      model,
    }));
  return {
    schemaVersion: CERT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'skill-code-assessment',
    skillCodeAssessments,
  };
}

function isCertifyThrottled(state, now = Date.now()) {
  if (!state || !state.lastCertifySentAt) return false;
  const last = new Date(state.lastCertifySentAt).getTime();
  if (Number.isNaN(last)) return false;
  return now - last < CERTIFY_SEND_THROTTLE_MS;
}

// Persists the analyzed certification result if (and only if) consent is
// granted. Never throws — every skip/failure resolves with { ok:false, ... },
// so it can't break the local report (ADR-011 invariant).
async function shareCertification(items, { model = null } = {}) {
  const state = loadConsentState();
  const decision = getConsentDecision(state);

  if (decision !== 'granted') {
    return { ok: false, skipped: true, reason: decision === 'denied' ? 'consent-denied' : 'no-decision' };
  }
  if (!state.email) {
    return { ok: false, skipped: true, reason: 'no-email' };
  }
  if (isCertifyThrottled(state)) {
    return { ok: false, skipped: true, reason: 'throttled' };
  }

  const payload = deriveCertificationPayload(items, { model });
  if (payload.skillCodeAssessments.length === 0) {
    return { ok: false, skipped: true, reason: 'nothing-to-persist' };
  }

  const endpoint = getIngestEndpoint();
  if (!endpoint) {
    return { ok: false, skipped: true, reason: 'no-endpoint-configured' };
  }

  let res;
  try {
    res = await requestJson('POST', endpoint, { body: { email: state.email, payload } });
  } catch (e) {
    return { ok: false, skipped: false, reason: 'network-error', error: e.message };
  }

  if (res.status >= 200 && res.status < 300) {
    state.lastCertifySentAt = new Date().toISOString();
    saveConsentState(state);
    return { ok: true, response: res.json };
  }
  if (res.status === 429) {
    return { ok: false, skipped: false, reason: 'rate-limited' };
  }
  return { ok: false, skipped: false, reason: `http-${res.status}` };
}

module.exports = {
  autoShare,
  deriveCertificationPayload,
  shareCertification,
  isCertifyThrottled,
  CERTIFY_SEND_THROTTLE_MS,
  loadConsentState,
  saveConsentState,
  getConsentDecision,
  recordConsent,
  getConsentStatus,
  revokeConsent,
  setEmail,
  isValidEmail,
  normalizeEmail,
  isThrottled,
  derivePayload,
  requestJson,
  consentPath,
  SEND_THROTTLE_MS,
};
