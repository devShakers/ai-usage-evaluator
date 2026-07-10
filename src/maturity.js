'use strict';

const { computeTierResult, AGENTIC_IDS } = require('./tier-engine');

/*
 * AI usage maturity classification.
 *
 * talents-ai-score, issue 019 (ADR-014): the 0-4 BAND is now RECALIBRATED
 * to derive from the T0-T7 tier engine (src/tier-engine.js) — single
 * source of truth, level-model.md. `classify()` used to compute its own
 * independent ad-hoc level rules (breadth/mcp/custom thresholds); those
 * are RETIRED in favor of `computeTierResult()`'s ladder ("el tier más alto
 * cuyos criterios cumples TODOS"). This DOES change the band for some
 * setups that previously reached a level without also satisfying the
 * ladder's lower-tier requirements — most notably breadth-only setups
 * (several tools installed, none configured) that used to hit level 3 via
 * `breadth >= 3` alone: the tier ladder requires T2's context (>=1
 * instructions/config/rules) before anything past T1, so those setups now
 * land at band 1 instead. This is the intended, documented consequence of
 * the recalibration (level-model.md's "Documenta el cambio de banda para
 * setups afectados"), not a regression.
 *
 * BREADTH and the 0-100 `score` (visual meter) are UNCHANGED — they still
 * combine breadth with depth totals exactly as before; only the discrete
 * 0-4 `level`/`key`/`name`/`emoji` classification is now tier-derived.
 * `AGENTIC_IDS` (now including `amazon-q-developer`, ADR-014 closed
 * decision #4) moved to tier-engine.js, which owns the tier ladder that
 * consumes it — re-exported here unchanged for existing callers.
 */

const LEVELS = [
  { level: 0, key: 'none', name: 'Sin rastro de IA', emoji: '○' },
  { level: 1, key: 'exploring', name: 'Explorando', emoji: '◔' },
  { level: 2, key: 'integrated', name: 'Integrado', emoji: '◑' },
  { level: 3, key: 'power', name: 'Power user', emoji: '◕' },
  { level: 4, key: 'orchestrator', name: 'Orquestador', emoji: '●' },
];

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

  // Band 0-4 derived from the tier engine (issue 019, single source of
  // truth) — replaces the old ad-hoc level rules entirely.
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
    // Tier (T0-T7, issue 019): the fine-grained axis the band is derived
    // from. Exposed for the roadmap (issue 020) and for the persistence
    // payload (share.js), not just an internal computation detail.
    tier: tierResult.tier,
    tierKey: tierResult.tierKey,
    tierName: tierResult.tierName,
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
