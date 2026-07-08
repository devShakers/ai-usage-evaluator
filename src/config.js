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

module.exports = { getIngestEndpoint };
