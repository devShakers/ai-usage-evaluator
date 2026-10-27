'use strict';

// The two ephemeral model-call orchestrators of the `ai-usage` flow, extracted from bin/ai-usage.js.

const { parseAgentDescriptions, parseAgentDefinitionsForRoots } = require('./agent-org-chart');
const {
  buildSynthesisRequest,
  requestAgentSynthesis,
  buildAgentEvaluationRequest,
  requestAgentEvaluation,
} = require('./ai');
const { MODEL_CALL, REASON, skipped, failedLocally, attachModelCall } = require('./model-call-record');
const {
  getSynthesisEndpoint,
  getAgentEvaluationEndpoint,
} = require('./config');
const { hasTraceContentConsent } = require('./share');

// Agent-synthesis call ("ephemeral" — not persisted).
async function maybeSynthesizeAgents(report, root) {
  const KEY = MODEL_CALL.SYNTHESIS;
  if (!Array.isArray(report.agents) || report.agents.length === 0) {
    attachModelCall(report, KEY, skipped(REASON.NO_AGENTS));
    return null;
  }
  const endpoint = getSynthesisEndpoint();
  if (!endpoint) {
    attachModelCall(report, KEY, skipped(REASON.NO_ENDPOINT));
    return null;
  }

  try {
    const descriptions = Array.isArray(report.agentDescriptions)
      ? report.agentDescriptions
      : parseAgentDescriptions(root);
    const requestBody = buildSynthesisRequest(report.agents, descriptions, hasTraceContentConsent());
    return await requestAgentSynthesis(requestBody, {
      endpoint,
      onOutcome: (rec) => attachModelCall(report, KEY, rec),
    });
  } catch {
    // A failure BEFORE the wire (reading/parsing the agent files threw), which
    // is a local defect and not the endpoint's fault — recorded as such.
    attachModelCall(report, KEY, failedLocally());
    return null; // never breaks the local report — falls back to the org chart
  }
}

// Ephemeral agent-evaluation call: scores each agent's DEFINITION quality server-side (gemini-2.5-flash — see src/agent-evaluation.js).
async function maybeEvaluateAgents(report, roots, lang) {
  const KEY = MODEL_CALL.EVALUATION;
  if (!Array.isArray(report.agents) || report.agents.length === 0) {
    attachModelCall(report, KEY, skipped(REASON.NO_AGENTS));
    return null;
  }
  const endpoint = getAgentEvaluationEndpoint();
  if (!endpoint) {
    attachModelCall(report, KEY, skipped(REASON.NO_ENDPOINT));
    return null;
  }

  try {
    const definitions = parseAgentDefinitionsForRoots(roots);
    // Pass the report language so the rationale + the one-line description come back translated (a Spanish-authored definition still yields report-language prose).
    const requestBody = buildAgentEvaluationRequest(report.agents, definitions, lang, hasTraceContentConsent());
    return await requestAgentEvaluation(requestBody, {
      endpoint,
      onOutcome: (rec) => attachModelCall(report, KEY, rec),
    });
  } catch {
    attachModelCall(report, KEY, failedLocally());
    return null; // never breaks the local report
  }
}

module.exports = { maybeSynthesizeAgents, maybeEvaluateAgents };
