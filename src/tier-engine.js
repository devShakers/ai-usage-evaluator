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
//
// LEGACY (talents-ai-score, ADR-016): the 0-4 band is RETIRED from every
// DISPLAY surface in favour of the 3-value Setup Level below. It is kept here
// (and threaded through maturity.js#classify -> share.js#derivePayload) SOLELY
// so the persisted/sent payload contract is byte-for-byte unchanged until the
// backend reconciles it (issue 023). Nothing rendered to the talent reads it
// any more — `setupLevelForTier` is the shown rollup.
const BAND_BY_TIER = [0, 1, 2, 3, 3, 4, 4, 4];

// Setup Level (Talent Certification Framework, ADR-016): the 3-value rollup
// that REPLACES the retired 0-4 band on every display surface. Derived from
// the deterministic tier — the tier stays the single source of truth, no LLM
// computes or alters it. T0 has no AI setup at all, so it is "Not certified"
// (not a Setup Level); T1-T7 map onto S1/S2/S3 by decision power:
//   (T0)   -> not certified (no AI setup)
//   T1-T2  -> S1 Assisted
//   T3-T4  -> S2 Extended
//   T5-T7  -> S3 Orchestrated
// `code` is the framework's stable id (null for "not certified"); `rank` (0-3)
// orders the four states for the meter/pips; `emoji` is the hero glyph. The
// human-facing LABEL is localized via i18n's `setupLevels` catalog keyed by
// `key` — never rendered from here (same isolation rule as tier names).
const SETUP_LEVELS = [
  { key: 'none', code: null, rank: 0, emoji: '○' },
  { key: 'S1', code: 'S1', rank: 1, emoji: '◔' },
  { key: 'S2', code: 'S2', rank: 2, emoji: '◑' },
  { key: 'S3', code: 'S3', rank: 3, emoji: '●' },
];

// tier -> setup-level key. Indexed by tier for a branch-free, deterministic
// map kept in lockstep with the ladder (same pattern as BAND_BY_TIER). If the
// ladder changes, this table is the single place to re-anchor the rollup.
const SETUP_LEVEL_BY_TIER = ['none', 'S1', 'S1', 'S2', 'S2', 'S3', 'S3', 'S3'];

function setupLevelForTier(tier) {
  const key = SETUP_LEVEL_BY_TIER[tier] ?? 'none';
  return SETUP_LEVELS.find((s) => s.key === key) || SETUP_LEVELS[0];
}

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
    // Setup Level (ADR-016) — the shown rollup. `{key, code, rank, emoji}`;
    // the label is resolved from i18n by `key` at the render layer.
    setupLevel: setupLevelForTier(tier),
    signals,
  };
}

module.exports = {
  computeTierResult,
  computeTier,
  aggregateTierSignals,
  bandForTier,
  setupLevelForTier,
  SETUP_LEVELS,
  SETUP_LEVEL_BY_TIER,
  AGENTIC_IDS,
  TIERS,
};
