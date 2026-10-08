'use strict';

const { requestBackend } = require('./backend-request');
const { reporterFor, REASON } = require('./model-call-record');

// Roadmap personalization client (talents-ai-score, ADR-015).

const DEFAULT_TIMEOUT_MS = 8000;

/* ---------- signals (derived only, never raw content) ---------- */

// Builds the `signals` block from data this report ALREADY computes elsewhere (nothing new is read from disk here).
function buildRoadmapSignals(report, tierSignals) {
  const r = report || {};
  const ts = tierSignals || {};
  return {
    frameworks: Array.isArray(r.technologies) ? r.technologies : [],
    toolCategories: r.summary && Array.isArray(r.summary.categories) ? r.summary.categories : [],
    mcpCategories: (r.mcp && r.mcp.countsByCategory) || { data: 0, comms: 0, dev: 0, browser: 0, other: 0 },
    // Agent NAMES only — never descriptions/prompts (same whitelist
    // src/agent-org-chart.js's parseAgentOrgChart already enforces).
    agents: Array.isArray(r.agents) ? r.agents.map((a) => a.name) : [],
    agentCounts: r.agentCounts || { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    hooks: typeof ts.hooks === 'number' ? ts.hooks : 0,
    automations: r.automations || null,
  };
}

// Builds the exact wire request: `{tier, tierKey, curated, signals}`.
function buildRoadmapPersonalizationRequest(curatedEntry, tierResult, report, locale = null, consentGranted = false) {
  return {
    tier: tierResult.tier,
    tierKey: tierResult.tierKey,
    curated: {
      whatUnlocks: curatedEntry.unlocks,
      steps: curatedEntry.steps,
      tips: curatedEntry.tips,
      mistakes: curatedEntry.commonMistakes,
    },
    signals: buildRoadmapSignals(report, tierResult.signals),
    // ADR-026: detected report language for the personalized prose.
    ...(locale === 'es' || locale === 'en' ? { locale } : {}),
    ...(consentGranted === true ? { traceContentConsent: true } : {}),
  };
}

/* ---------- validation: all-or-nothing against the curated counts ---------- */

function isValidPersonalizedRoadmap(parsed, curated) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (typeof parsed.whatUnlocks !== 'string' || !parsed.whatUnlocks.trim()) return false;

  if (!Array.isArray(parsed.steps) || parsed.steps.length !== curated.steps.length) return false;
  if (!parsed.steps.every((s) => s && typeof s.text === 'string' && s.text.trim())) return false;

  if (!Array.isArray(parsed.tips) || parsed.tips.length !== curated.tips.length) return false;
  if (!parsed.tips.every((tip) => typeof tip === 'string' && tip.trim())) return false;

  if (!Array.isArray(parsed.mistakes) || parsed.mistakes.length !== curated.mistakes.length) return false;
  if (!parsed.mistakes.every((m) => typeof m === 'string' && m.trim())) return false;

  return true;
}

/* ---------- network (via the shared PRIMARY -> FALLBACK chain) ---------- */

// Requests the roadmap personalization endpoint.
async function requestRoadmapPersonalization(requestBody, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS, onOutcome = null } = {}) {
  // Issue 109 — see agent-synthesis.js#requestAgentSynthesis for the contract.
  const outcome = reporterFor(onOutcome, { timeoutMs });
  if (!endpoint) {
    outcome.skip(REASON.NO_ENDPOINT);
    return null;
  }

  let res;
  try {
    res = await requestBackend({ endpoint, body: requestBody, timeoutMs, trace: outcome.hops });
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
    return null; // malformed (non-JSON) response body
  }

  if (!isValidPersonalizedRoadmap(parsed, requestBody.curated)) {
    outcome.fail(REASON.UNEXPECTED_SHAPE, { status: res.status, backend: res.backend });
    return null;
  }

  outcome.succeed({ status: res.status, backend: res.backend });
  return {
    whatUnlocks: parsed.whatUnlocks,
    steps: parsed.steps,
    tips: parsed.tips,
    mistakes: parsed.mistakes,
  };
}

/* ---------- merge: only the 4 prose gaps ever change ---------- */

function mergeRoadmapPersonalization(curatedEntry, personalized) {
  if (curatedEntry.maxTier || !personalized) return curatedEntry;
  const curatedForValidation = { steps: curatedEntry.steps, tips: curatedEntry.tips, mistakes: curatedEntry.commonMistakes };
  if (!isValidPersonalizedRoadmap(personalized, curatedForValidation)) return curatedEntry;
  return {
    ...curatedEntry,
    unlocks: personalized.whatUnlocks,
    steps: personalized.steps,
    tips: personalized.tips,
    commonMistakes: personalized.mistakes,
  };
}

module.exports = {
  buildRoadmapSignals,
  buildRoadmapPersonalizationRequest,
  isValidPersonalizedRoadmap,
  requestRoadmapPersonalization,
  mergeRoadmapPersonalization,
};
