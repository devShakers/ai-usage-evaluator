'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/*
 * Persistent CLI config file (skill-code-certification, endpoint-config task).
 *
 * So a Talent doesn't have to `export AI_FOOTPRINT_INGEST_ENDPOINT` every
 * session, the ingest endpoint can also live in a persisted file next to
 * consent.json / the reports:
 *   ~/.config/ai-footprint/config.json   e.g. { "ingestEndpoint": "https://…" }
 *
 * Resolution PRECEDENCE (getIngestEndpoint): the env var wins (the raw,
 * outside-the-code developer override), then the config file, then nothing —
 * there is STILL no compiled-in production default (ADR-002/ADR-007: none is
 * deployed yet, and hardcoding one in a public repo would make it
 * unrotatable). The email-verification/* URLs keep deriving as siblings of
 * whatever ingest resolves to — that derivation is unchanged.
 *
 * `AI_FOOTPRINT_CONFIG_DIR` overrides the directory (test seam), mirroring
 * src/share.js's own lazy `configDir()` — resolved lazily (never cached) so a
 * throwaway dir set per-test is honoured. Kept independent here rather than
 * importing share.js: share.js already requires this module, so importing it
 * back would be circular.
 */
function configDir(env = process.env) {
  return env.AI_FOOTPRINT_CONFIG_DIR || path.join(os.homedir(), '.config', 'ai-footprint');
}

function configFilePath(env = process.env) {
  return path.join(configDir(env), 'config.json');
}

// Never throws: a missing or malformed config file resolves to `{}` (same
// resilience invariant as loadConsentState) so a corrupt file never breaks a
// local run — it just falls back to "no config file".
function loadConfigFile(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFilePath(env), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveConfigFile(config, env = process.env) {
  const dir = configDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFilePath(env), JSON.stringify(config, null, 2));
  try { fs.chmodSync(configFilePath(env), 0o600); } catch { /* e.g. Windows */ }
}

/*
 * Endpoint safety (skill-code-certification, endpoint-config task) — BOUNDED.
 *
 * The ingest endpoint decides WHERE the sampled code (`ai-certify`) and the
 * derived signals (`ai-footprint`) are sent, so a persisted endpoint must not
 * silently egress over plaintext to a remote host: if the host is NOT
 * localhost/127.0.0.1 (loopback), the URL MUST be https. `http://` to a
 * non-local host is rejected with an actionable reason. Scope is deliberately
 * limited to this one rule — NO domain allowlist (yet).
 *
 * Enforced HARD at the setter (--set-endpoint refuses to write an insecure
 * remote URL) and defensively when READING the config file (a hand-edited
 * insecure value is ignored, treated like "no endpoint"). The env var is NOT
 * validated here: it's the raw developer override (an explicit `export`), the
 * documented escape hatch for local/other setups.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function validateEndpoint(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, reason: 'empty' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'bad-protocol' };
  }
  // WHATWG URL keeps the brackets on an IPv6 literal (`hostname === '[::1]'`),
  // but LOCAL_HOSTS stores the bare address (`::1`) — strip the brackets so an
  // IPv6 loopback endpoint (http://[::1]:PORT/...) is correctly treated as local.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const isLocal = LOCAL_HOSTS.has(host);
  if (!isLocal && u.protocol !== 'https:') {
    return { ok: false, reason: 'insecure-remote' };
  }
  return { ok: true, value: raw, host, isLocal };
}

// Persists the ingest endpoint into config.json after validating it. Returns
// { ok:true, value, path } or { ok:false, reason } — the caller (bin) turns
// the reason into a localized, actionable message and never writes on failure.
function setIngestEndpoint(value, env = process.env) {
  const v = validateEndpoint(value);
  if (!v.ok) return { ok: false, reason: v.reason };
  const config = loadConfigFile(env);
  config.ingestEndpoint = v.value;
  saveConfigFile(config, env);
  return { ok: true, value: v.value, path: configFilePath(env) };
}

// Resolves the effective ingest endpoint AND its source, for `--show-endpoint`.
// Same precedence as getIngestEndpoint; surfaces a config file whose stored
// value is insecure/invalid as `config-file-invalid` so the Talent understands
// why it isn't being used.
function resolveIngestEndpoint(env = process.env) {
  const fromEnv = env.AI_FOOTPRINT_INGEST_ENDPOINT;
  if (fromEnv && fromEnv.trim()) {
    return { endpoint: fromEnv.trim(), source: 'env' };
  }
  const fromFile = loadConfigFile(env).ingestEndpoint;
  if (fromFile && String(fromFile).trim()) {
    const v = validateEndpoint(String(fromFile).trim());
    if (v.ok) return { endpoint: v.value, source: 'config-file', path: configFilePath(env) };
    return { endpoint: null, source: 'config-file-invalid', path: configFilePath(env), reason: v.reason };
  }
  return { endpoint: null, source: 'none' };
}

/*
 * Sending destination configuration (talents-ai-score, ADR-007).
 *
 * The public repo contains NO endpoint or secret (same invariant the
 * retired enrollment model already upheld, HANDOFF §2.5): the destination
 * URL is supplied from OUTSIDE the code, via the AI_FOOTPRINT_INGEST_ENDPOINT
 * environment variable. There is no compiled-in default:
 *   - This is still a PoC (ADR-002): no server is deployed at Shakers that
 *     this CLI could point to by default.
 *   - Even once a real backend is live (shakers-hub-backend, specs.md),
 *     hardcoding its URL in a PUBLIC repo would make the ingestion endpoint
 *     impossible to rotate without a code change/redeploy of every
 *     already-installed CLI.
 *
 * Without this variable set, sending is a silent no-op
 * (`no-endpoint-configured` in src/share.js#autoShare): never breaks the
 * local report, same resilience invariant as every other skip reason.
 *
 * `env` is injectable (defaults to process.env) purely for tests.
 */
function getIngestEndpoint(env = process.env) {
  const value = env.AI_FOOTPRINT_INGEST_ENDPOINT;
  if (value && value.trim()) return value.trim();
  // Fallback to the persisted config file (env var takes precedence above).
  const fromFile = loadConfigFile(env).ingestEndpoint;
  if (fromFile && String(fromFile).trim()) {
    // Defensive: the setter validates before writing, but a hand-edited file
    // could carry an insecure remote endpoint — refuse to USE it (silent,
    // treated like unset) rather than egress over http to a remote host.
    const v = validateEndpoint(String(fromFile).trim());
    return v.ok ? v.value : null;
  }
  return null;
}

/*
 * Agent-synthesis endpoint (talents-ai-score, ADR-010/ADR-011): same
 * no-hardcode invariant as the ingestion endpoint above — supplied via
 * `AI_FOOTPRINT_SYNTHESIS_ENDPOINT`, no compiled-in default, no secret (the
 * synthesis call carries no per-identity auth either). ADR-011 explicitly
 * retires the kill-switch model (`AI_FOOTPRINT_SYNTHESIS_ENABLED` never
 * existed here, and never will): unset means "nothing to call" — the caller
 * (src/agent-synthesis.js / bin/report.js) treats that as a normal fallback
 * to the deterministic org chart (ADR-009), not an error.
 */
function getSynthesisEndpoint(env = process.env) {
  const value = env.AI_FOOTPRINT_SYNTHESIS_ENDPOINT;
  return value && value.trim() ? value.trim() : null;
}

/*
 * Roadmap personalization endpoint (talents-ai-score, ADR-015): same
 * no-hardcode, no-default, no-secret pattern as the two endpoints above —
 * supplied via `AI_FOOTPRINT_ROADMAP_ENDPOINT`, unset means "nothing to
 * call". The caller (src/roadmap-personalization.js / bin/report.js)
 * treats an unset endpoint as a normal fallback to the curated roadmap
 * content verbatim (src/roadmap-content.js), never an error.
 */
function getRoadmapEndpoint(env = process.env) {
  const value = env.AI_FOOTPRINT_ROADMAP_ENDPOINT;
  return value && value.trim() ? value.trim() : null;
}

/*
 * Skill-certification endpoint (skill-code-certification, ADR-001): the
 * destination for the new `ai-certify` binary's server-side, two-phase
 * (resolve/certify) flow — supplied via `AI_FOOTPRINT_CERTIFY_ENDPOINT`, no
 * compiled-in default, no secret, exactly like the three endpoints above.
 *
 * CRUCIAL DIFFERENCE in how the CALLER treats "unset", though: the ingest/
 * synthesis/roadmap endpoints degrade GRACEFULLY when unset (silent no-op /
 * deterministic fallback), because those features enrich an always-local
 * report. `ai-certify` has NO local-only product — certifying a Skill is
 * INHERENTLY a server-side act (the Hub owns the Skill catalog, the
 * Talent-match gate and the LLM). So an unset endpoint here is an ACTIONABLE
 * ERROR the caller (bin/certify.js) surfaces and exits on — never a silent
 * degrade, never a deterministic fallback (ADR-001: there is no offline way
 * to "judge code"). This helper stays a pure getter; the caller decides what
 * a null means for its own flow.
 *
 * RESOLUTION (unified with ingest, endpoint-config task): the certify route
 * lives in the SAME Hub `ai-footprint` module, next to `reports`
 * (`.../works/ai-footprint/skill-certification`), so it is DERIVED as a
 * sibling of the resolved ingest endpoint — exactly like the OTP routes. That
 * means a single configured `ingestEndpoint` (env var OR config.json, incl.
 * the installer's baked default) makes footprint + OTP + certify all resolve
 * to the same base, no separate config needed. `AI_FOOTPRINT_CERTIFY_ENDPOINT`
 * is kept ONLY as an explicit override (highest precedence) for the rare case
 * of a certify service mounted somewhere else; unset, it derives from ingest.
 */
function getCertifyEndpoint(env = process.env) {
  const explicit = env.AI_FOOTPRINT_CERTIFY_ENDPOINT;
  if (explicit && explicit.trim()) return explicit.trim();
  // Fall back to a sibling of the resolved ingest endpoint (env > config.json).
  return deriveFromIngest(env, 'skill-certification');
}

/*
 * Email-verification endpoints (skill-code-certification, ADR-006): the OTP
 * "prove you own this email" step that gates PERSISTENCE. Unlike the four
 * endpoints above, these introduce NO new env var (deliberate — nothing to
 * configure so a Talent can test immediately). They are DERIVED as siblings
 * of the ingestion endpoint, because email verification gates persistence and
 * persistence targets `AI_FOOTPRINT_INGEST_ENDPOINT`; in the Hub these two
 * routes live in the same `ai-footprint` module, mounted next to the ingest
 * route (`.../works/ai-footprint/reports`).
 *
 *   ingest = https://hub/works/ai-footprint/reports
 *     -> https://hub/works/ai-footprint/email-verification/request
 *     -> https://hub/works/ai-footprint/email-verification/verify
 *
 * Derivation uses `new URL(relative, base)` sibling resolution: with no
 * leading slash, the base URL's LAST path segment (`reports`) is replaced.
 * Trailing slashes on the ingest URL are stripped first so `reports` stays
 * the segment being replaced (otherwise `reports/` would be treated as a
 * directory and the derived path would nest under it).
 *
 * Unset ingest endpoint -> null here too: with no persistence destination
 * there is nothing to verify FOR, so the caller (consent-flow.js) skips
 * verification, still shows the report, and simply persists nothing.
 */
// Sibling-of-ingest resolution shared by the OTP and certify endpoints: the
// resolved ingest endpoint's LAST path segment (`reports`) is replaced by
// `relativePath` via `new URL(relative, base)`. Trailing slashes are stripped
// first so `reports` stays the segment being replaced. `getIngestEndpoint`
// already honours the env var > config.json precedence, so anything derived
// here follows the same single source of truth. Unset ingest -> null.
function deriveFromIngest(env, relativePath) {
  const ingest = getIngestEndpoint(env);
  if (!ingest) return null;
  const base = ingest.replace(/\/+$/, '');
  try {
    return new URL(relativePath, base).href;
  } catch {
    return null;
  }
}

function deriveEmailVerificationUrl(env, segment) {
  return deriveFromIngest(env, `email-verification/${segment}`);
}

/*
 * Agent-evaluation endpoint (footprint agent cards — RESTORED). Ingest-sibling
 * derivation like the others; `AI_FOOTPRINT_AGENT_EVAL_ENDPOINT` is an optional
 * override. Unset is NOT an error: the caller treats a null endpoint as a
 * graceful "no card enrichment this run" (the footprint report is always shown).
 * NOTE: the footprint cards no longer show a numeric score — the endpoint now
 * returns classification + improvements + rationale + description only.
 */
function getAgentEvaluationEndpoint(env = process.env) {
  const explicit = env.AI_FOOTPRINT_AGENT_EVAL_ENDPOINT;
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, 'agent-evaluation');
}

// Graph-inference (LLM enrichment) endpoint for the LOCAL report (`map`).
// Derived as a sibling of the ingest endpoint, exactly like agent-evaluation;
// override with AI_FOOTPRINT_GRAPH_INFER_ENDPOINT. Null when ingest is unset →
// `map` degrades to the deterministic graph (no enrichment).
function getGraphInferenceEndpoint(env = process.env) {
  const explicit = env.AI_FOOTPRINT_GRAPH_INFER_ENDPOINT;
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, 'graph-inference');
}

/*
 * Agent-certification endpoints (`certify agents`). Three ingest-siblings under
 * `.../works/ai-footprint/agent-certification/{categories,followups,verdict}`,
 * derived exactly like the other routes — a single configured ingest endpoint
 * makes all three resolve. Unlike footprint's optional agent-evaluation, these
 * back an interactive flow the user explicitly started: the caller treats a null
 * endpoint as an actionable error (like certify skills), not a silent no-op.
 */
function getAgentCertificationFollowupsEndpoint(env = process.env) {
  return deriveFromIngest(env, 'agent-certification/followups');
}
function getAgentCertificationVerdictEndpoint(env = process.env) {
  return deriveFromIngest(env, 'agent-certification/verdict');
}

function getEmailVerificationRequestUrl(env = process.env) {
  return deriveEmailVerificationUrl(env, 'request');
}

function getEmailVerificationVerifyUrl(env = process.env) {
  return deriveEmailVerificationUrl(env, 'verify');
}

/*
 * Superadmin TEST-identity provisioning endpoint (ADR-021, NON-PROD only) —
 * a sibling of the ingest endpoint (`.../works/ai-footprint/superadmin/provision-test-talent`),
 * derived exactly like the OTP routes, so no extra config is needed. Returns
 * `null` when no ingest endpoint is configured. The server 404s this route in
 * production regardless.
 */
function getSuperadminSessionEndpoint(env = process.env) {
  return deriveFromIngest(env, 'superadmin/session');
}

/*
 * Superadmin READ-ONLY certification inspection endpoint (ADR-025, NON-PROD
 * only) — a sibling of the ingest endpoint. `null` when no ingest endpoint is
 * configured. The server 404s this route in production.
 */
function getInspectCertificationsEndpoint(env = process.env) {
  return deriveFromIngest(env, 'superadmin/inspect-certifications');
}

/*
 * ADR-027 superadmin SESSION persistence. The `superadmin` command mints a
 * session token server-side (non-prod only) and persists it here, next to the
 * ingest endpoint config. `certify` reads it to bypass the identity/authorship
 * gates on ANY email. Stored under `superadminSession` in config.json:
 *   { email, token, expiresAt }
 * Returns `null` when absent, malformed, or EXPIRED (the CLI treats an expired
 * session as no session — the server would reject the token anyway).
 */
function loadSuperadminSession(env = process.env) {
  const config = loadConfigFile(env);
  const s = config && typeof config === 'object' ? config.superadminSession : null;
  if (!s || typeof s !== 'object' || typeof s.token !== 'string' || !s.token) return null;
  if (s.expiresAt && Date.parse(s.expiresAt) <= Date.now()) return null; // expired
  return { email: s.email || null, token: s.token, expiresAt: s.expiresAt || null };
}

function saveSuperadminSession(session, env = process.env) {
  const config = loadConfigFile(env);
  config.superadminSession = {
    email: session.email || null,
    token: session.token,
    expiresAt: session.expiresAt || null,
  };
  saveConfigFile(config, env);
}

function clearSuperadminSession(env = process.env) {
  const config = loadConfigFile(env);
  if (config && typeof config === 'object' && 'superadminSession' in config) {
    delete config.superadminSession;
    saveConfigFile(config, env);
  }
}

module.exports = {
  getIngestEndpoint,
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getCertifyEndpoint,
  getAgentEvaluationEndpoint,
  getGraphInferenceEndpoint,
  getAgentCertificationFollowupsEndpoint,
  getAgentCertificationVerdictEndpoint,
  getEmailVerificationRequestUrl,
  getEmailVerificationVerifyUrl,
  getSuperadminSessionEndpoint,
  getInspectCertificationsEndpoint,
  // ADR-027 superadmin session persistence.
  loadSuperadminSession,
  saveSuperadminSession,
  clearSuperadminSession,
  // Persistent config file + endpoint safety (endpoint-config task).
  configFilePath,
  loadConfigFile,
  saveConfigFile,
  validateEndpoint,
  setIngestEndpoint,
  resolveIngestEndpoint,
};
