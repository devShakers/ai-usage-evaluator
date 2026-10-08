'use strict';

const TIERS = [
  { tier: 0, key: 'T0', name: 'Banco vacío', means: 'No AI tools detected yet' },
  { tier: 1, key: 'T1', name: 'Primera herramienta', means: 'At least one AI tool in use' },
  { tier: 2, key: 'T2', name: 'Banco con notas', means: 'AI tools plus project context (instructions, config, rules)' },
  { tier: 3, key: 'T3', name: 'Banco conectado', means: 'Adds an MCP server integration' },
  { tier: 4, key: 'T4', name: 'Herramienta propia', means: 'Adds your own customization (skills, commands, rules)' },
  { tier: 5, key: 'T5', name: 'Operador agéntico', means: 'An agentic tool wired with MCP and customization' },
  { tier: 6, key: 'T6', name: 'Multi-agente', means: 'Two or more custom agents' },
  { tier: 7, key: 'T7', name: 'Taller orquestado', means: 'Custom agents plus automation hooks (orchestrated)' },
];

function tierLadder() {
  return TIERS.map((t) => ({ key: t.key, name: t.name, means: t.means }));
}

const AGENTIC_IDS = ['claude-code', 'aider', 'gemini-cli', 'codex-cli', 'amazon-q-developer'];

// Band 0-4 derived from tier (level-model.md, single source of truth): index = tier -> band.
const BAND_BY_TIER = [0, 1, 2, 3, 3, 4, 4, 4];

// Setup Level (Talent Certification Framework, ADR-016): the 3-value rollup that REPLACES the retired 0-4 band on every display surface.
const SETUP_LEVELS = [
  { key: 'none', code: null, rank: 0, emoji: '○' },
  { key: 'S1', code: 'S1', rank: 1, emoji: '◔' },
  { key: 'S2', code: 'S2', rank: 2, emoji: '◑' },
  { key: 'S3', code: 'S3', rank: 3, emoji: '●' },
];

// tier -> setup-level key.
const SETUP_LEVEL_BY_TIER = ['none', 'S1', 'S1', 'S2', 'S2', 'S3', 'S3', 'S3'];

function setupLevelForTier(tier) {
  const key = SETUP_LEVEL_BY_TIER[tier] ?? 'none';
  return SETUP_LEVELS.find((s) => s.key === key) || SETUP_LEVELS[0];
}

// Aggregates the raw signals the ladder needs, straight from the report's existing fields — not a new detector, only a sum over what scanner.js already produces.
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

  // THE MCP SIGNAL IS THE DEDUPED SET THE REPORT SHOWS (issue 112).
  const mcpTotal =
    report && report.mcp && typeof report.mcp.total === 'number' ? report.mcp.total : mcp;

  return { totalDetected: detected.length, context, mcp: mcpTotal, custom, hooks, hasAgentic, agentCount };
}

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

// Computes the full tier result for a report: {tier, tierKey, tierName, band, signals}.
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
  tierLadder,
  computeTier,
  aggregateTierSignals,
  bandForTier,
  setupLevelForTier,
  SETUP_LEVELS,
  SETUP_LEVEL_BY_TIER,
  AGENTIC_IDS,
  TIERS,
};
