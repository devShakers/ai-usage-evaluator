'use strict';

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
  return value && value.trim() ? value.trim() : null;
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
 */
function getCertifyEndpoint(env = process.env) {
  const value = env.AI_FOOTPRINT_CERTIFY_ENDPOINT;
  return value && value.trim() ? value.trim() : null;
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
function deriveEmailVerificationUrl(env, segment) {
  const ingest = getIngestEndpoint(env);
  if (!ingest) return null;
  const base = ingest.replace(/\/+$/, '');
  try {
    return new URL(`email-verification/${segment}`, base).href;
  } catch {
    return null;
  }
}

function getEmailVerificationRequestUrl(env = process.env) {
  return deriveEmailVerificationUrl(env, 'request');
}

function getEmailVerificationVerifyUrl(env = process.env) {
  return deriveEmailVerificationUrl(env, 'verify');
}

module.exports = {
  getIngestEndpoint,
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getCertifyEndpoint,
  getEmailVerificationRequestUrl,
  getEmailVerificationVerifyUrl,
};
