'use strict';

/*
 * Deterministic tier engine (talents-ai-score, issue 019 / ADR-014): the
 * T0-T7 ladder ("banco de trabajo"), computed as "the highest tier whose
 * criteria ALL hold, checked strictly bottom-up" (level-model.md). Every
 * criterion is anchored to an EXISTING deterministic signal already
 * produced by scanner.js/agent-org-chart.js — no new signal is invented
 * here, this module only aggregates and applies the ladder rule.
 *
 * | Tier | Criterion                                    |
 * |------|-----------------------------------------------|
 * | T0   | totalDetected == 0                             |
 * | T1   | totalDetected >= 1                             |
 * | T2   | T1 and context (instructions+config+rules) >= 1|
 * | T3   | T2 and mcpServers >= 1                          |
 * | T4   | T3 and custom (skills+commands+rules) >= 1     |
 * | T5   | hasAgentic and mcp >= 1 and custom >= 1 (= T4 + agentic) |
 * | T6   | T5 and agentCounts.agents >= 2                 |
 * | T7   | T6 and hooks >= 1                              |
 *
 * `mtime`/recency is explicitly INFORMATIVE ONLY (ADR-003, level-model.md
 * closed decision #3) — it never gates any tier here, by construction
 * (aggregateTierSignals below never reads a `recency`/`mtime` field at all).
 * Orchestration multi-level is deferred (no deterministic `parent` field in
 * Claude Code's own format) — not a criterion here, on purpose.
 */

const TIERS = [
  { tier: 0, key: 'T0', name: 'Banco vacío' },
  { tier: 1, key: 'T1', name: 'Primera herramienta' },
  { tier: 2, key: 'T2', name: 'Banco con notas' },
  { tier: 3, key: 'T3', name: 'Banco conectado' },
  { tier: 4, key: 'T4', name: 'Herramienta propia' },
  { tier: 5, key: 'T5', name: 'Operador agéntico' },
  { tier: 6, key: 'T6', name: 'Multi-agente' },
  { tier: 7, key: 'T7', name: 'Taller orquestado' },
];

// talents-ai-score, ADR-014 closed decision #4: amazon-q-developer counts
// as agentic for T5 (was previously left out pending explicit review — see
// git history / maturity.js for the retired "OPEN DECISION" comment).
const AGENTIC_IDS = ['claude-code', 'aider', 'gemini-cli', 'codex-cli', 'amazon-q-developer'];

// Band 0-4 derived from tier (level-model.md, single source of truth):
// index = tier -> band.
const BAND_BY_TIER = [0, 1, 2, 3, 3, 4, 4, 4];

// Aggregates the raw signals the ladder needs, straight from the report's
// existing fields — not a new detector, only a sum over what scanner.js
// already produces. Never throws on a missing/malformed report.
function aggregateTierSignals(report) {
  const tools = report && Array.isArray(report.tools) ? report.tools : [];
  const detected = tools.filter((t) => t && t.detected);

  let context = 0; // instructions + config + rules (T2)
  let mcp = 0; // configured MCP servers (T3)
  let custom = 0; // skills + commands + rules, own assets (T4)
  let hooks = 0; // hook-based automation (T7)

  for (const t of detected) {
    const d = t.depth || {};
    context += (d.instructions || 0) + (d.config || 0) + (d.rules || 0);
    mcp += d.mcpServers || 0;
    custom += (d.skills || 0) + (d.commands || 0) + (d.rules || 0);
    hooks += d.hooks || 0;
  }

  const hasAgentic = detected.some((t) => AGENTIC_IDS.includes(t.id));
  const agentCount =
    report && report.agentCounts && typeof report.agentCounts.agents === 'number'
      ? report.agentCounts.agents
      : 0;

  return { totalDetected: detected.length, context, mcp, custom, hooks, hasAgentic, agentCount };
}

// Ladder rule: "el tier más alto cuyos criterios cumples TODOS", checked
// strictly bottom-up — each step gates on having reached the PREVIOUS tier
// exactly, so a raw signal for a higher tier (e.g. hooks>=1) never lets you
// skip a lower tier whose own criterion isn't met (e.g. no context at all).
function computeTier(signals) {
  let tier = 0;
  if (signals.totalDetected >= 1) tier = 1;
  if (tier === 1 && signals.context >= 1) tier = 2;
  if (tier === 2 && signals.mcp >= 1) tier = 3;
  if (tier === 3 && signals.custom >= 1) tier = 4;
  if (tier === 4 && signals.hasAgentic && signals.mcp >= 1 && signals.custom >= 1) tier = 5;
  if (tier === 5 && signals.agentCount >= 2) tier = 6;
  if (tier === 6 && signals.hooks >= 1) tier = 7;
  return tier;
}

function bandForTier(tier) {
  return BAND_BY_TIER[tier] ?? 0;
}

// Computes the full tier result for a report: {tier, tierKey, tierName,
// band, signals}. `signals` is exposed for transparency (and for the
// roadmap, issue 020, to explain "why you're at this tier").
function computeTierResult(report) {
  const signals = aggregateTierSignals(report || {});
  const tier = computeTier(signals);
  const meta = TIERS[tier];
  return {
    tier: meta.tier,
    tierKey: meta.key,
    tierName: meta.name,
    band: bandForTier(tier),
    signals,
  };
}

module.exports = {
  computeTierResult,
  computeTier,
  aggregateTierSignals,
  bandForTier,
  AGENTIC_IDS,
  TIERS,
};
