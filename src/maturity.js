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
// (LEVELS, HANDOFF §4) have NOT been touched. New depth probes WERE added in
// scanner.js (windsurf.mcpServers, gemini-cli.mcpServers) that automatically
// feed `mcp` here, because depthTotals already sums `d.mcpServers` from ANY
// tool by key name. Kept as is because it makes the score more faithful to
// the existing definition, not a redefinition of it.
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

/*
 * Score model 0-100 for the visual meter — RECALIBRATED (ADR-008,
 * skill-code-certification).
 *
 * WHY the old formula was replaced: it was a saturating weighted sum
 * (`breadth*8 + instructions*6 + min(mcp,8)*5 + min(custom,12)*3 + hooks*4 +
 * agentic`, clamped to 100). Breadth alone pinned it: 13 detected tools ×
 * 8 = 104 → 100, so a setup with a dozen tools and ZERO configured depth
 * scored a perfect 100. The meter never discriminated in the high band and
 * 100 was trivial to reach.
 *
 * THE NEW MODEL — normalization over a theoretical maximum, with a per-
 * dimension cap. Each dimension contributes `weight × min(value/full, 1)`;
 * the weights sum to exactly 100, so 100 is only reached when EVERY
 * dimension is at (or beyond) its `full` target — a genuinely maximized
 * setup. Capping each dimension is what kills the old saturation: piling up
 * one cheap signal (more tools) can never carry the score on its own.
 *
 * Resolution in the high band comes from WHERE the weight sits. The four
 * "breadth/depth" dimensions (breadth+context+mcp+custom = 66 pts) top out
 * at 66 — a well-configured but non-agentic setup (≈ tier T4) caps there.
 * The remaining 34 pts are the "hard" signals that define the top tiers:
 * agentic (8), multi-agent (12) and hooks (14). So the 66→100 band maps
 * onto the T5→T6→T7 progression, and moving from a good setup to an
 * excellent one keeps moving the number. Illustrative scale:
 *   - ~0-20  : tools only, nothing configured (T0-T1)
 *   - ~20-66 : building depth — context, MCP, own tooling (T2-T4)
 *   - ~66-86 : agentic operation & multi-agent (T5-T6)
 *   - ~86-100: fully orchestrated workshop (T7); 100 = every dimension maxed
 *
 * DETERMINISTIC & REPRODUCIBLE: every input is a deterministic scan signal
 * (no LLM, no clock, no randomness) → same report always yields the same
 * integer score. `agentCount` reads report.agentCounts.agents (0 if absent).
 */
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

  const score = computeScore({
    breadth,
    context: d.instructions, // depthTotals already folds `config` into instructions
    mcp: d.mcp,
    custom: d.custom,
    agentic: hasAgentic ? 1 : 0,
    hooks: d.hooks,
    multiAgent: agentCount,
  });

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
