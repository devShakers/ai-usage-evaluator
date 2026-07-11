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

module.exports = { getIngestEndpoint, getSynthesisEndpoint, getRoadmapEndpoint };
