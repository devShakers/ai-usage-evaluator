'use strict';

// The three ephemeral model-call orchestrators of the `ai-usage` flow, extracted from bin/ai-usage.js (structure refactor, issue 020).

const { parseAgentDescriptions, parseAgentDefinitionsForRoots } = require('./agent-org-chart');
const {
  buildSynthesisRequest,
  requestAgentSynthesis,
  buildAgentEvaluationRequest,
  requestAgentEvaluation,
  buildRoadmapPersonalizationRequest,
  requestRoadmapPersonalization,
} = require('./ai');
const { MODEL_CALL, REASON, skipped, failedLocally, attachModelCall } = require('./model-call-record');
const {
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getAgentEvaluationEndpoint,
} = require('./config');
const { hasTraceContentConsent } = require('./share');
const { getRoadmapEntry } = require('./roadmap-content');
const { computeTierResult } = require('./tier-engine');

// Agent-synthesis call (talents-ai-score, ADR-010/ADR-011, "ephemeral" — not persisted; ADR-051 amends WHEN it runs, not that).
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

// Ephemeral agent-evaluation call (ADR-016): scores each agent's DEFINITION quality server-side (gemini-2.5-flash — see src/agent-evaluation.js).
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
    // ADR-026: pass the report language so the rationale + the one-line description come back translated (a Spanish-authored definition still yields report-language prose).
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

async function maybePersonalizeRoadmap(report, maturity, lang) {
  const KEY = MODEL_CALL.ROADMAP;
  const tierKey = maturity && maturity.tierKey;
  if (!tierKey) {
    attachModelCall(report, KEY, skipped(REASON.NOT_APPLICABLE));
    return null;
  }
  const entry = getRoadmapEntry(tierKey, lang);
  if (!entry) {
    attachModelCall(report, KEY, skipped(REASON.NOT_APPLICABLE));
    return null;
  }
  if (entry.maxTier) {
    attachModelCall(report, KEY, skipped(REASON.MAX_TIER));
    return null;
  }

  const endpoint = getRoadmapEndpoint();
  if (!endpoint) {
    attachModelCall(report, KEY, skipped(REASON.NO_ENDPOINT));
    return null;
  }

  try {
    const tierResult = computeTierResult(report);
    // ADR-026: pass the report language so the personalized prose is localized.
    // ADR-028: fresh consent read, see maybeSynthesizeAgents above.
    const requestBody = buildRoadmapPersonalizationRequest(entry, tierResult, report, lang, hasTraceContentConsent());
    return await requestRoadmapPersonalization(requestBody, {
      endpoint,
      onOutcome: (rec) => attachModelCall(report, KEY, rec),
    });
  } catch {
    attachModelCall(report, KEY, failedLocally());
    return null; // never breaks the local report — falls back to the curated content
  }
}

module.exports = { maybeSynthesizeAgents, maybeEvaluateAgents, maybePersonalizeRoadmap };
