'use strict';

const { getCatalog, categoryLabel } = require('./i18n');
const { sanitizeRenderText } = require('./sanitize-network-text');
const { DEFAULT_REPORT_GATE } = require('./report-gating');
const { c, bar, sep, wrap } = require('./terminal-format');
const { detectedTools } = require('./detected-tools');
const { printAgents, printActivity } = require('./terminal-agents');
const {
  printMcpServices,
  printTierAnalysis,
  printLadder,
  printRoadmap,
} = require('./terminal-sections');

// talents-ai-score: terminal parity with the HTML report.

// `lang` ('es'|'en', see src/i18n.js) decides the text catalog.
function renderTerminal(report, maturity, lang, opts = {}) {
  const t = getCatalog(lang);
  const lines = [];
  const p = (s = '') => lines.push(s);

  // issue 123 / ADR-044: the ONE identity gate.
  const gate = opts.gate || DEFAULT_REPORT_GATE;

  // ADR-016: Setup Level (S1-S3 / Not certified) replaces the 0-4 band label.
  const setupKey = (maturity.setupLevel && maturity.setupLevel.key) || 'none';
  const setupLabel = (t.setupLevels && t.setupLevels[setupKey] && t.setupLevels[setupKey].label) || setupKey;

  // A compact brand header in BOTH modes for orientation.
  p();
  p(`${c.bold}${c.primary}  SHAKERS${c.reset}${c.muted}  ·  ${t.terminal.brandSub}${c.reset}`);
  p(`${c.muted}  ${new Date(report.generatedAt).toLocaleString()}  ·  ${t.terminal.toolsDetected(detectedTools(report.tools).length, report.tools.length)}${c.reset}`);

  // `--roadmap` (opts.showRoadmap): render ONLY the next-steps/roadmap section (header + steps + the copyable implementation prompt) — NOT the rest of the report.
  if (opts.showRoadmap) {
    sep(p);
    if (gate.showRoadmap) {
      printRoadmap(report, maturity, t, lang, p);
    }
    return lines.join('\n');
  }

  // Default report: score -> why -> tools -> technologies -> agents, then a dim hint pointing at --roadmap (so the next-steps section is discoverable).

  sep(p);
  const tierName = (maturity.tierKey && t.tierNames[maturity.tierKey]) || maturity.tierName || '';
  const tierBit = maturity.tierKey ? t.terminal.tierInline(maturity.tierKey, tierName) : '';
  // This report's ONE headline (dueño, 2026-08-11): the Setup Level IS the evaluation's main result, so it gets `accent` (lime) — and nothing else on this screen does.
  const setupColor = setupKey === 'none' ? c.white : c.accent;
  p(`  ${c.bold}${setupColor}${t.terminal.setupLevel(setupLabel)}${c.reset}${c.muted}${tierBit}${c.reset}`);
  p(`  ${c.primary}${bar(maturity.score)}${c.reset} ${c.dim}${maturity.score}/100${c.reset}`);

  // 2. WHY that score/tier — the rationale, right after the number.
  sep(p);
  printTierAnalysis(report, t, p);

  // 2b. Progression ladder — what each level 0-4 and tier T0-T7 means, and the
  // ✓/●/○ progression with unlock criteria (report req 1, full in terminal).
  sep(p);
  printLadder(report, t, p);

  // 3. Detected tools — omitted entirely if none detected.
  const detected = detectedTools(report.tools);
  if (detected.length) {
    sep(p);
    p(`  ${c.bold}${t.terminal.detectedHeading}${c.reset}`);
    for (const tool of detected) {
      const depthBits = Object.entries(tool.depth)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      const extra = depthBits ? `${c.dim} — ${depthBits}${c.reset}` : '';
      const version = tool.version ? `${c.dim} v${sanitizeRenderText(tool.version)}${c.reset}` : '';
      p(`  ${c.success}●${c.reset} ${sanitizeRenderText(tool.name)}${version} ${c.muted}(${categoryLabel(lang, tool.category)})${c.reset}${extra}`);
    }
  }

  // 4b. MCP services (issue 110) — ALWAYS printed, empty state included, because
  // its absence is a tier criterion the talent needs to know about.
  sep(p);
  printMcpServices(report, t, p);

  // 5. Agents — one line per agent (+ summarized description, ↓ nesting,
  // compact score + usage). Omitted entirely when there are no agents at all.
  const hasAgents = Array.isArray(report.agents) && report.agents.length > 0;
  if (hasAgents) {
    sep(p);
    printAgents(report, t, p, gate);
  }

  const activityLines = [];
  if (printActivity(report, t, (s = '') => activityLines.push(s))) {
    sep(p);
    for (const line of activityLines) p(line);
  }

  // Where the roadmap pointer went.
  if (gate.showRoadmap) {
    p(`  ${c.dim}${t.terminal.roadmapHint}${c.reset}`);
  }
  p();

  return lines.join('\n');
}

// `wrap` is re-exported for its own unit test (issue 087): it is the one piece of the formatting with edge cases worth pinning directly.
module.exports = { renderTerminal, wrap, printAgents };
