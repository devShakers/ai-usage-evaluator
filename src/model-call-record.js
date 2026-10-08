'use strict';

// What happened with each model call, written down (talents-ai-score, issue 109).

// The three keys.
const MODEL_CALL = Object.freeze({
  SYNTHESIS: 'agentSynthesis',
  EVALUATION: 'agentEvaluation',
  ROADMAP: 'roadmapPersonalization',
});

const REASON = Object.freeze({
  // ok:true
  OK: 'ok',
  // ok:true AND INCOMPLETE (2026-08-03, from a real incident).
  OK_PARTIAL: 'ok-partial',
  // ok:null — never attempted, and NOT a failure
  NO_AGENTS: 'no-agents',
  NO_ENDPOINT: 'no-endpoint-configured',
  MAX_TIER: 'max-tier',
  NOT_APPLICABLE: 'not-applicable',
  NO_CONSENT: 'no-consent',
  // ok:false — attempted, and something was lost
  TIMEOUT: 'timeout',
  NETWORK: 'network-error',
  INVALID_URL: 'invalid-endpoint-url',
  HTTP: 'http-error',
  MALFORMED_JSON: 'malformed-json',
  UNEXPECTED_SHAPE: 'unexpected-shape',
  LOCAL_ERROR: 'local-error',
});

// The reasons that mean the call produced usable data (`ok: true`).
const SUCCESS_REASONS = new Set([REASON.OK, REASON.OK_PARTIAL]);

// "Didn't apply" — the reasons that produce `ok: null`.
const SKIP_REASONS = new Set([
  REASON.NO_AGENTS,
  REASON.NO_ENDPOINT,
  REASON.MAX_TIER,
  REASON.NOT_APPLICABLE,
  REASON.NO_CONSENT,
]);

const FAILURE_REASONS = new Set([
  REASON.TIMEOUT,
  REASON.NETWORK,
  REASON.INVALID_URL,
  REASON.HTTP,
  REASON.MALFORMED_JSON,
  REASON.UNEXPECTED_SHAPE,
  REASON.LOCAL_ERROR,
]);

// The rejection `.kind` tags `src/backend-request.js` attaches, mapped onto this vocabulary.
function classifyChainError(e) {
  const kind = e && e.kind;
  if (kind === 'timeout') return REASON.TIMEOUT;
  if (kind === 'network-error') return REASON.NETWORK;
  if (kind === 'invalid-url') return REASON.INVALID_URL;
  if (kind === 'no-endpoint') return REASON.NO_ENDPOINT;
  return REASON.LOCAL_ERROR;
}

// The canonical record.
function record({ attemptedAt, ok, reason, status = null, backend = null, elapsedMs = null, timeoutMs = null, hops = [], omitted = [] }) {
  return {
    attemptedAt: attemptedAt || null,
    ok,
    reason,
    status: typeof status === 'number' ? status : null,
    backend: backend || null,
    elapsedMs: typeof elapsedMs === 'number' ? elapsedMs : null,
    timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : null,
    hops: Array.isArray(hops) ? hops : [],
    // What the call did NOT cover, by name.
    omitted: Array.isArray(omitted) ? omitted.filter((n) => typeof n === 'string' && n) : [],
  };
}

// A call that never went out.
function skipped(reason) {
  return record({ attemptedAt: null, ok: null, reason: reason || REASON.NOT_APPLICABLE });
}

// A failure that happened BEFORE the wire (building the request threw: a file that can't be read, a parse that blew up).
function failedLocally(reason = REASON.LOCAL_ERROR) {
  return record({ attemptedAt: new Date().toISOString(), ok: false, reason });
}

// The one-shot reporter each client module uses.
function reporterFor(onOutcome, { timeoutMs = null } = {}) {
  const attemptedAt = new Date().toISOString();
  const startedHr = process.hrtime.bigint();
  const hops = [];
  let settled = false;

  const emit = (built) => {
    if (settled) return null;
    settled = true;
    if (typeof onOutcome === 'function') onOutcome(built);
    return built;
  };
  const elapsed = () => Number((process.hrtime.bigint() - startedHr) / 1000000n);

  return {
    // Handed to `requestBackend` as `trace`.
    hops,
    skip(reason) {
      return emit(skipped(reason));
    },
    fail(reason, { status = null, backend = null } = {}) {
      return emit(record({ attemptedAt, ok: false, reason, status, backend, elapsedMs: elapsed(), timeoutMs, hops }));
    },
    failFromError(e) {
      return this.fail(classifyChainError(e));
    },
    // `omitted` non-empty flips the reason to `ok-partial` and NOT `ok` — the one decision that stops a partial answer from being recorded as a clean run.
    succeed({ status = null, backend = null, omitted = [] } = {}) {
      const left = Array.isArray(omitted) ? omitted.filter((n) => typeof n === 'string' && n) : [];
      return emit(record({
        attemptedAt,
        ok: true,
        reason: left.length ? REASON.OK_PARTIAL : REASON.OK,
        status,
        backend,
        elapsedMs: elapsed(),
        timeoutMs,
        hops,
        omitted: left,
      }));
    },
  };
}

// Attaches a record to the report under its call key.
function attachModelCall(report, key, built) {
  if (!report || typeof report !== 'object' || !key) return built;
  if (!report.modelCalls || typeof report.modelCalls !== 'object') report.modelCalls = {};
  report.modelCalls[key] = built;
  return built;
}

function modelCall(report, key) {
  const calls = report && report.modelCalls;
  return calls && typeof calls === 'object' ? calls[key] || null : null;
}

// The two predicates the render layer is allowed to ask.
function callFailed(report, key) {
  const c = modelCall(report, key);
  return !!c && c.ok === false;
}

function callSucceeded(report, key) {
  const c = modelCall(report, key);
  return !!c && c.ok === true;
}

// The call worked AND left something out.
function callPartial(report, key) {
  const c = modelCall(report, key);
  return !!c && c.ok === true && Array.isArray(c.omitted) && c.omitted.length > 0;
}

// THE CALL LOST TIME TO A DEADLINE — and this is NOT `reason === TIMEOUT` (issue 116, found by measuring, not by reading).
function callTimedOut(report, key) {
  const c = modelCall(report, key);
  if (!c || c.ok !== false) return false;
  if (c.reason === REASON.TIMEOUT) return true;
  return Array.isArray(c.hops) && c.hops.some((h) => h && h.kind === REASON.TIMEOUT);
}

// The names the call left out, for the surface that names them. `[]` when the run
// was complete, so a caller never has to null-check before iterating.
function omittedByCall(report, key) {
  const c = modelCall(report, key);
  return c && Array.isArray(c.omitted) ? c.omitted : [];
}

module.exports = {
  MODEL_CALL,
  REASON,
  SKIP_REASONS,
  FAILURE_REASONS,
  SUCCESS_REASONS,
  classifyChainError,
  skipped,
  failedLocally,
  reporterFor,
  attachModelCall,
  modelCall,
  callFailed,
  callSucceeded,
  callPartial,
  callTimedOut,
  omittedByCall,
};
