'use strict';

/*
 * AI usage maturity classification.
 *
 * Combines BREADTH (how many distinct tools) with DEPTH (how much they've
 * been configured: project instructions, rules, MCP servers, skills,
 * commands, hooks). Depth weighs more than breadth: having 5 freshly
 * installed, unconfigured tools is less mature than mastering a single one
 * in depth.
 */

const LEVELS = [
  { level: 0, key: 'none', name: 'Sin rastro de IA', emoji: '○' },
  { level: 1, key: 'exploring', name: 'Explorando', emoji: '◔' },
  { level: 2, key: 'integrated', name: 'Integrado', emoji: '◑' },
  { level: 3, key: 'power', name: 'Power user', emoji: '◕' },
  { level: 4, key: 'orchestrator', name: 'Orquestador', emoji: '●' },
];

const AGENTIC_IDS = ['claude-code', 'aider', 'gemini-cli', 'codex-cli'];
// OPEN DECISION (talents-ai-score, signal expansion): 'amazon-q-developer'
// was added to the catalog (detectors.js) as an agentic CLI
// (CATEGORIES.AGENTIC_CLI), but it has NOT been added to AGENTIC_IDS — that
// would silently change what counts toward level 4 ("agentic CLI + MCP +
// own customization", HANDOFF §4). Left out by default; adding it is an
// explicit decision pending human review, not a routine tweak.

// DECISION (talents-ai-score, signal expansion): the level definitions
// (LEVELS, HANDOFF §4) and the `score` weights below have NOT been touched.
// New depth probes WERE added in scanner.js (windsurf.mcpServers,
// gemini-cli.mcpServers) that automatically feed `mcp` here, because
// depthTotals already sums `d.mcpServers` from ANY tool by key name — this
// is not a recalibration of the formula, but it DOES change the result for
// talents with those tools configured (their MCP didn't count before). Kept
// as is because it makes the score more faithful to the existing
// definition, not a redefinition of it; flagged here for transparency.
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

function classify(report) {
  const detected = report.tools.filter((t) => t.detected);
  const breadth = detected.length;
  const d = depthTotals(detected);
  const hasAgentic = detected.some((t) => AGENTIC_IDS.includes(t.id));

  // Score 0-100 for the visual meter.
  const score = Math.min(
    100,
    breadth * 8 + // breadth
      d.instructions * 6 + // project rules/instructions
      Math.min(d.mcp, 8) * 5 + // MCP (capped to avoid over-rewarding)
      Math.min(d.custom, 12) * 3 + // own skills/commands/rules
      d.hooks * 4 + // hook-based automation
      (hasAgentic ? 6 : 0),
  );

  // Level rules: the highest level whose criteria are satisfied applies.
  let level = 0;
  if (breadth >= 1) level = 1; // at least one tool
  if (d.instructions >= 1) level = 2; // project config exists
  if (d.mcp >= 1 || d.custom >= 1 || breadth >= 3) level = 3; // advanced usage
  if (hasAgentic && d.mcp >= 1 && d.custom >= 1) level = 4; // deep automation

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

module.exports = { classify, LEVELS };
