'use strict';

const { scrubSecrets } = require('./agent-synthesis');
const { requestBackend } = require('./backend-request');
const { reporterFor, REASON } = require('./model-call-record');

// Agent definition-quality evaluation client (ADR-016, agent evaluation).

// HOW LONG TO WAIT FOR THE AGENT EVALUATION, and why it keeps growing.
const DEFAULT_TIMEOUT_MS = 150000;
const PROMPT_VERSION = 'agent-eval-v1';

// Cap each agent definition to a prefix before sending.
const MAX_DEFINITION_CHARS = 2000;

// Builds the frozen-contract body from the deterministic org chart (structure) + the per-agent definition text, scrubbing each definition.
function buildAgentEvaluationRequest(structuralAgents, definitionsByName, locale = null, consentGranted = false) {
  const defMap = new Map(
    (definitionsByName || []).map((d) => [d.name, d.definition != null ? d.definition : d.description]),
  );
  return {
    agents: (structuralAgents || []).map((a) => ({
      name: a.name,
      // Scrub first, THEN cap to the prefix — so a secret straddling the cut is
      // already redacted and can't leak a half-matched fragment.
      definition: scrubSecrets(defMap.get(a.name) || '').slice(0, MAX_DEFINITION_CHARS),
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || null,
      parent: a.parent || null,
    })),
    promptVersion: PROMPT_VERSION,
    // ADR-026: detected report language for the rationale + description prose.
    ...(locale === 'es' || locale === 'en' ? { locale } : {}),
    ...(consentGranted === true ? { traceContentConsent: true } : {}),
  };
}

function isValidEvaluationResponse(parsed) {
  return !!parsed && typeof parsed === 'object' && Array.isArray(parsed.evaluations);
}

// The three classification methods the server may report; anything else is
// coerced to 'unclassified' (never trust an unexpected value).
const CLASSIFICATION_METHODS = new Set(['deterministic', 'llm', 'unclassified']);
const UNCLASSIFIED = Object.freeze({
  catalogId: null,
  category: null,
  role: null,
  level: null,
  method: 'unclassified',
});

function normalizeClassification(c) {
  if (!c || typeof c !== 'object') return { ...UNCLASSIFIED };
  const catalogId = typeof c.catalogId === 'string' && c.catalogId ? c.catalogId : null;
  if (!catalogId) return { ...UNCLASSIFIED };
  const method = CLASSIFICATION_METHODS.has(c.method) ? c.method : 'unclassified';
  return {
    catalogId,
    category: typeof c.category === 'string' && c.category ? c.category : null,
    role: typeof c.role === 'string' && c.role ? c.role : null,
    level: typeof c.level === 'string' && c.level ? c.level : null,
    // A real id but method 'unclassified' would be contradictory — treat an id
    // that arrived without a usable method as LLM-inferred (the conservative read).
    method: method === 'unclassified' ? 'llm' : method,
  };
}

// Bounds the improvements to a clean string[] (max 3, trimmed, non-empty).
function normalizeImprovements(list) {
  return (Array.isArray(list) ? list : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim())
    .slice(0, 3);
}

// WHICH AGENTS THE CALL LEFT OUT (`omittedAgentNames`, server contract 2026-08-03).
function normalizeOmittedAgentNames(parsed, requestBody, evaluations) {
  const requested = new Set(
    (requestBody && Array.isArray(requestBody.agents) ? requestBody.agents : [])
      .map((a) => (a && typeof a.name === 'string' ? a.name : null))
      .filter(Boolean),
  );
  const answered = new Set((evaluations || []).map((e) => e.name));

  const declared = (parsed && Array.isArray(parsed.omittedAgentNames) ? parsed.omittedAgentNames : [])
    .filter((n) => typeof n === 'string' && n.trim())
    .map((n) => n.trim())
    .filter((n) => requested.has(n));

  const derived = [...requested].filter((n) => !answered.has(n));

  // Deduped, and in the order the agents were REQUESTED so the list reads the same
  // way the report lists them (never in the order a server happened to emit).
  const union = new Set([...declared, ...derived]);
  return [...requested].filter((n) => union.has(n));
}

// Normalizes each evaluation.
function normalizeEvaluations(list) {
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e.name === 'string')
    .map((e) => ({
      name: e.name,
      rationale: typeof e.rationale === 'string' ? e.rationale : '',
      // ADR-026: target-language one-line description; null when the server
      // omitted it — the caller falls back to the verbatim phrase.
      description: typeof e.description === 'string' && e.description ? e.description : null,
      // v4 (agent classification): closest catalog agent + how it was matched.
      classification: normalizeClassification(e.classification),
      // v4: 2-3 concrete improvement tips (target language).
      improvements: normalizeImprovements(e.improvements),
    }));
}

// Requests the agent-evaluation endpoint.
async function requestAgentEvaluation(requestBody, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS, onOutcome = null } = {}) {
  const outcome = reporterFor(onOutcome, { timeoutMs });
  if (!endpoint) {
    outcome.skip(REASON.NO_ENDPOINT);
    return null;
  }

  const promptVersion = (requestBody && requestBody.promptVersion) || PROMPT_VERSION;
  const locale = requestBody && (requestBody.locale === 'es' || requestBody.locale === 'en')
    ? requestBody.locale
    : null;
  const traceContentConsent = requestBody && requestBody.traceContentConsent === true;
  const safeBody = {
    promptVersion,
    agents: Array.isArray(requestBody && requestBody.agents)
      ? requestBody.agents.map((a) => ({ ...a, definition: scrubSecrets(a.definition) }))
      : [],
    ...(locale ? { locale } : {}),
    ...(traceContentConsent ? { traceContentConsent: true } : {}),
  };

  let res;
  try {
    res = await requestBackend({ endpoint, body: safeBody, timeoutMs, trace: outcome.hops });
  } catch (e) {
    outcome.failFromError(e);
    return null; // network error or timeout on every hop: never breaks the local report
  }

  if (res.status < 200 || res.status >= 300) {
    outcome.fail(REASON.HTTP, { status: res.status, backend: res.backend });
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.raw);
  } catch {
    outcome.fail(REASON.MALFORMED_JSON, { status: res.status, backend: res.backend });
    return null; // malformed (non-JSON) body
  }

  if (!isValidEvaluationResponse(parsed)) {
    outcome.fail(REASON.UNEXPECTED_SHAPE, { status: res.status, backend: res.backend });
    return null;
  }

  const evaluations = normalizeEvaluations(parsed.evaluations);
  const omittedAgentNames = normalizeOmittedAgentNames(parsed, safeBody, evaluations);
  // A PARTIAL ANSWER IS NOT A FAILURE, and it is not a plain success either.
  outcome.succeed({ status: res.status, backend: res.backend, omitted: omittedAgentNames });
  return { evaluations, promptVersion, omittedAgentNames };
}

module.exports = {
  normalizeOmittedAgentNames,
  PROMPT_VERSION,
  MAX_DEFINITION_CHARS,
  buildAgentEvaluationRequest,
  requestAgentEvaluation,
};
