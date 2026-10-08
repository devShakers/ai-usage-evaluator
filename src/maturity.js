'use strict';

const { computeTierResult, AGENTIC_IDS } = require('./tier-engine');

// AI usage maturity classification.

const LEVELS = [
  { level: 0, key: 'none', name: 'Sin rastro de IA', emoji: '○' },
  { level: 1, key: 'exploring', name: 'Explorando', emoji: '◔' },
  { level: 2, key: 'integrated', name: 'Integrado', emoji: '◑' },
  { level: 3, key: 'power', name: 'Power user', emoji: '◕' },
  { level: 4, key: 'orchestrator', name: 'Orquestador', emoji: '●' },
];

// DECISION (talents-ai-score, signal expansion): the level definitions (LEVELS, HANDOFF §4) have NOT been touched.
function depthTotals(tools) {
  let instructions = 0; // project instructions/rules files
  let mcp = 0; // configured MCP servers
  let custom = 0; // own skills + commands + rules
  let hooks = 0;

  for (const t of tools) {
    if (!t.detected) continue;
    const d = t.depth || {};
    instructions += (d.instructions || 0) + (d.config || 0);
    mcp += d.mcpServers || 0;
    custom += (d.skills || 0) + (d.commands || 0) + (d.rules || 0);
    hooks += d.hooks || 0;
  }
  return { instructions, mcp, custom, hooks };
}

// Score model 0-100 for the visual meter — RECALIBRATED (ADR-008, skill-code-certification).
const SCORE_MODEL = [
  { key: 'breadth', weight: 12, full: 3 }, // number of AI tools detected
  { key: 'context', weight: 16, full: 2 }, // instructions + config files
  { key: 'mcp', weight: 18, full: 2 }, // configured MCP servers
  { key: 'custom', weight: 20, full: 4 }, // own skills + commands + rules
  { key: 'agentic', weight: 8, full: 1 }, // has an agentic CLI (0/1)
  { key: 'hooks', weight: 14, full: 1 }, // hook-based automation
  { key: 'multiAgent', weight: 12, full: 2 }, // agent definitions (>=2 = top)
];

function computeScore({ breadth, context, mcp, custom, agentic, hooks, multiAgent }) {
  const values = { breadth, context, mcp, custom, agentic, hooks, multiAgent };
  let total = 0;
  for (const dim of SCORE_MODEL) {
    const v = values[dim.key] || 0;
    total += dim.weight * Math.min(v / dim.full, 1);
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

function classify(report) {
  const detected = report.tools.filter((t) => t.detected);
  const breadth = detected.length;
  const d = depthTotals(detected);
  const hasAgentic = detected.some((t) => AGENTIC_IDS.includes(t.id));
  const agentCount =
    report && report.agentCounts && typeof report.agentCounts.agents === 'number'
      ? report.agentCounts.agents
      : 0;

  // Score scope reverted to PROJECT ∪ HOME (skill-code-certification / ADR-010, which reverts ADR-009).
  const score = computeScore({
    breadth,
    context: d.instructions, // depthTotals already folds `config` into instructions
    mcp: d.mcp,
    custom: d.custom,
    agentic: hasAgentic ? 1 : 0,
    hooks: d.hooks,
    multiAgent: agentCount,
  });

  // Band 0-4 derived from the tier engine (issue 019, single source of truth).
  const tierResult = computeTierResult(report);
  const level = tierResult.band;
  const meta = LEVELS[level];

  return {
    level: meta.level,
    key: meta.key,
    name: meta.name,
    emoji: meta.emoji,
    score,
    breadth,
    depth: d,
    hasAgentic,
    next: nextStep(level, { breadth, ...d, hasAgentic }),
    // Tier (T0-T7, issue 019): the fine-grained axis the band is derived from.
    tier: tierResult.tier,
    tierKey: tierResult.tierKey,
    tierName: tierResult.tierName,
    // Setup Level (ADR-016): the 3-value rollup shown to the talent, derived
    // from the tier. `{key, code, rank, emoji}`; label localized via i18n.
    setupLevel: tierResult.setupLevel,
  };
}

function nextStep(level) {
  const steps = {
    0: 'Instala una herramienta de IA (Claude Code, Cursor o Copilot) y pruébala en un proyecto real.',
    1: 'Añade un fichero de instrucciones al proyecto (CLAUDE.md, .cursorrules o copilot-instructions.md) para dar contexto persistente.',
    2: 'Conecta un servidor MCP o crea reglas/comandos propios para que la IA acceda a tus datos y flujos.',
    3: 'Combina una CLI agéntica con MCP y skills/comandos propios; automatiza una tarea recurrente de principio a fin.',
    4: 'Ya operas a nivel de orquestación: documenta tu setup y encadena agentes o ejecución en background.',
  };
  return steps[level];
}

module.exports = { classify, LEVELS, AGENTIC_IDS };
