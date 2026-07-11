'use strict';

const { getCatalog, categoryLabel } = require('./i18n');
const { buildAgentCardTree } = require('./render-html');
const { getRoadmapEntry } = require('./roadmap-content');
const { analyzeTier } = require('./tier-analysis');
const { mergeRoadmapPersonalization } = require('./roadmap-personalization');

/*
 * talents-ai-score: terminal parity with the HTML report. The HTML report
 * (src/render-html.js) picked up several sections over the level-up
 * framework build-out (technologies, agents, the tier roadmap) that never
 * made it into this terminal renderer — a talent running the plain-text
 * CLI (no --html) was missing that information entirely. This file adds
 * the SAME three sections, terminal-appropriate (plain text + ANSI color,
 * no markup):
 *   - agents: reuses render-html.js's buildAgentCardTree (same merged
 *     structural + synthesis tree, not a second implementation) rendered
 *     as an indented list instead of a card grid.
 *   - technologies: the same canonical framework/library names
 *     (src/tech-detector.js), not a raw dependency dump.
 *   - roadmap: the SAME current-tier -> next-tier entry as the HTML
 *     (src/roadmap-content.js's getRoadmapEntry, ONLY the current jump,
 *     never the whole T0-T7 ladder), replacing the old band-keyed generic
 *     "next step" text with the richer, tier-specific one — same
 *     rationale as render-html.js's roadmapSection (this is strictly
 *     richer for the same slot, not a duplicate). Falls back to the old
 *     generic band next-step text only if `maturity.tierKey` is absent or
 *     unrecognized (an older report shape, pre-issue-019) so a next step
 *     is still always shown, never silently dropped.
 */

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

function bar(score, width = 24) {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/* ---------- project technologies (parity with render-html.js) ---------- */

function printTechnologies(report, t, p) {
  const technologies = Array.isArray(report.technologies) ? report.technologies : [];
  p(`  ${c.bold}${t.html.technologiesHeading}${c.reset}`);
  if (!technologies.length) {
    p(`  ${c.gray}  ${t.html.technologiesEmpty}${c.reset}`);
  } else {
    p(`  ${c.cyan}${technologies.join(`${c.reset}${c.gray} · ${c.reset}${c.cyan}`)}${c.reset}`);
  }
  p();
}

/* ---------- agents (parity with render-html.js's card tree) ----------
 * Same tree (buildAgentCardTree, shared with the HTML renderer), rendered
 * as an indented list with a rail-like connector instead of nested cards
 * — the terminal equivalent of the HTML tree's visual nesting. Guards
 * against a malformed `parent` cycle the same defensive way agentNodeHtml
 * does (a `visited` set), never an infinite loop on bad input.
 */

function agentLine(card, depth, t) {
  const indent = '  '.repeat(depth);
  const connector = depth === 0 ? c.green + '●' + c.reset : c.gray + '└─' + c.reset;
  const hasSymbolicName = !!card.symbolicName;
  const title = hasSymbolicName
    ? `${card.symbolicName} ${c.gray}(${card.name})${c.reset}`
    : card.name;
  const modelBit = card.model ? ` ${c.dim}[${card.model}]${c.reset}` : '';
  const toolsBit = card.tools.length ? ` ${c.gray}· ${card.tools.join(', ')}${c.reset}` : '';
  const lines = [`  ${indent}${connector} ${c.bold}${c.white}${title}${c.reset}${modelBit}${toolsBit}`];
  if (card.whatItDoes) lines.push(`  ${indent}   ${c.dim}${card.whatItDoes}${c.reset}`);
  return lines;
}

function printAgents(report, t, p) {
  const { childrenByParent, roots } = buildAgentCardTree(report);
  p(`  ${c.bold}${t.html.diagramHeading}${c.reset}`);
  if (!roots.length) {
    p(`  ${c.gray}  ${t.html.agentsEmpty}${c.reset}`);
    p();
    return;
  }
  p(`  ${c.gray}${t.html.orchestratorLabel}${c.reset}`);
  const visited = new Set();
  const walk = (card, depth) => {
    if (visited.has(card.name)) return;
    visited.add(card.name);
    for (const line of agentLine(card, depth, t)) p(line);
    const children = childrenByParent.get(card.name) || [];
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  p();
}

/* ---------- tier analysis: why this tier (parity with render-html.js) ----------
 * Same deterministic source (src/tier-analysis.js) as the HTML report —
 * defends the already-computed tier with the criteria met + the exact
 * blocking criterion, both backed by the actual signal values. Never LLM
 * content, formula-driven, so it's rendered identically (same text) in
 * both outputs.
 */

function printTierAnalysis(report, t, p) {
  const analysis = analyzeTier(report, t.tierAnalysis);
  const tt = t.tierAnalysis;

  p(`  ${c.bold}${tt.heading}${c.reset}`);
  p(`  ${c.gray}${tt.intro(analysis.tierKey, analysis.tierName)}${c.reset}`);
  if (analysis.metCriteria.length) {
    p(`  ${c.dim}${tt.metHeading}${c.reset}`);
    for (const criterion of analysis.metCriteria) {
      p(`    ${c.green}✓${c.reset} ${criterion.text}`);
    }
  }
  if (analysis.blockingCriterion) {
    p(`  ${c.bold}${c.yellow}${tt.blockingLabel}${c.reset}`);
    p(`  ${c.white}${analysis.blockingCriterion}${c.reset}`);
  } else {
    p(`  ${c.white}${tt.maxTierNote}${c.reset}`);
  }
  p();
}

/* ---------- tier roadmap: current -> next (parity with render-html.js) ----------
 * Same source (src/roadmap-content.js's getRoadmapEntry) and the same
 * "only the current jump, never the whole ladder" scope rule as the HTML
 * renderer — a lighter, terminal-appropriate rendering (title + upgrade
 * condition + what it unlocks + steps), not the full snippet/tips/mistakes
 * detail (that lives in the HTML report and, once built, in
 * --build-next-level's own output). Falls back to the OLD generic
 * band-keyed next-step text when `maturity.tierKey` is missing/unrecognized
 * (an older report shape, pre-issue-019) so a next step is always shown.
 */

// talents-ai-score, ADR-015: `report.roadmapPersonalization` (set by
// bin/report.js after an ephemeral, already-validated call — see
// src/roadmap-personalization.js) merges in the SAME way render-html.js's
// roadmapSection does, via the SAME shared mergeRoadmapPersonalization —
// one merge implementation, not two. Absent/null renders the curated
// content untouched, exactly as before ADR-015.
function printRoadmap(report, maturity, t, lang, p) {
  const tierKey = maturity && maturity.tierKey;
  const curatedEntry = tierKey ? getRoadmapEntry(tierKey, lang) : null;

  if (!curatedEntry) {
    const nextStep = t.nextSteps[maturity.level] || maturity.next;
    p(`  ${c.bold}${c.yellow}${t.terminal.nextStep}${c.reset}`);
    p(`  ${c.white}${nextStep}${c.reset}`);
    p();
    return;
  }

  const personalization = report && report.roadmapPersonalization;
  const entry = mergeRoadmapPersonalization(curatedEntry, personalization);
  const wasPersonalized = !curatedEntry.maxTier && !!personalization;

  p(`  ${c.bold}${c.yellow}${t.html.roadmapHeading}${c.reset}`);
  p(`  ${c.white}${c.bold}${entry.title}${c.reset}`);

  if (entry.maxTier) {
    p(`  ${c.gray}${entry.whatRemains}${c.reset}`);
  } else {
    p(`  ${c.dim}${t.html.roadmapUpgradeWhenLabel}${c.reset} ${entry.upgradeWhen}`);
    p(`  ${c.white}${entry.unlocks}${c.reset}`);
    if (Array.isArray(entry.steps) && entry.steps.length) {
      p(`  ${c.dim}${t.html.roadmapStepsLabel}:${c.reset}`);
      entry.steps.forEach((s, i) => p(`    ${i + 1}. ${s.text} ${c.dim}(${s.estimate})${c.reset}`));
    }
  }
  if (entry.pendingTranslation) p(`  ${c.dim}${t.html.roadmapPendingTranslation}${c.reset}`);
  if (wasPersonalized) p(`  ${c.dim}${t.html.roadmapPersonalizedNotice}${c.reset}`);

  // Announce --build-next-level (issue 021) whenever there's an actual next
  // tier to build for — never when already at the terminal T7 entry (there
  // is nothing left to build).
  if (!entry.maxTier) p(`  ${c.dim}${t.cli.buildNextLevelHint}${c.reset}`);

  p();
}

// `lang` ('es'|'en', see src/i18n.js) decides the text catalog. The report
// data (report/maturity) doesn't change with the language, only its copy.
// Level and category are translated by STABLE KEY (maturity.key/level,
// category via categoryLabel) without touching maturity.js/detectors.js —
// see the header of src/i18n.js.
function renderTerminal(report, maturity, lang) {
  const t = getCatalog(lang);
  const lines = [];
  const p = (s = '') => lines.push(s);

  const levelName = t.levelNames[maturity.key] || maturity.name;

  p();
  p(`${c.bold}${c.cyan}  AI FOOTPRINT${c.reset}${c.gray}  ·  ${t.terminal.brandSub}${c.reset}`);
  p(`${c.gray}  ${new Date(report.generatedAt).toLocaleString()}  ·  ${t.terminal.toolsDetected(report.tools.filter((x) => x.detected).length, report.tools.length)}${c.reset}`);
  p();

  // Level
  p(`  ${c.bold}${c.white}${t.terminal.level(maturity.level, levelName)}${c.reset}`);
  p(`  ${c.cyan}${bar(maturity.score)}${c.reset} ${c.dim}${maturity.score}/100${c.reset}`);
  p();

  // Detected
  p(`  ${c.bold}${t.terminal.detectedHeading}${c.reset}`);
  const detected = report.tools.filter((tool) => tool.detected);
  if (detected.length === 0) {
    p(`  ${c.gray}  ${t.terminal.none}${c.reset}`);
  }
  for (const tool of detected) {
    const depthBits = Object.entries(tool.depth)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    const extra = depthBits ? `${c.dim} — ${depthBits}${c.reset}` : '';
    const version = tool.version ? `${c.dim} v${tool.version}${c.reset}` : '';
    const footprint =
      tool.footprint && (tool.footprint.files > 0 || tool.footprint.bytes > 0)
        ? `${c.dim} · ${t.terminal.files(tool.footprint.files)}, ${formatBytes(tool.footprint.bytes)}${c.reset}`
        : '';
    const recency =
      tool.recency && tool.recency.bucket
        ? `${c.dim} · ${t.terminal.lastModified(t.recency[tool.recency.bucket] || tool.recency.bucket)}${c.reset}`
        : '';
    p(`  ${c.green}●${c.reset} ${tool.name}${version} ${c.gray}(${categoryLabel(lang, tool.category)})${c.reset}${extra}`);
    if (footprint || recency) p(`    ${footprint}${recency}`);
  }
  p();

  // talents-ai-score: the "Not detected: ..." line is intentionally
  // removed — undetected tools added noise without signal, and a relevant
  // next step is already covered by the tier roadmap section below, never
  // silently dropped, just not repeated here as a name list.

  // Environment
  if (report.environment) {
    const env = report.environment;
    const editors = env.editorsInstalled && env.editorsInstalled.length
      ? env.editorsInstalled.join(', ')
      : t.terminal.noEditorsDetected;
    p(`  ${c.bold}${t.terminal.environment}${c.reset}`);
    p(`  ${c.gray}${env.platform}/${env.arch} · Node ${env.nodeVersion} · ${t.terminal.editors}: ${editors}${c.reset}`);
    p();
  }

  // Project technologies (parity with render-html.js's technologiesSection)
  printTechnologies(report, t, p);

  // Agents (parity with render-html.js's agentCardsSection)
  printAgents(report, t, p);

  // Tier analysis: why this tier (parity with render-html.js's
  // tierAnalysisSection) — defends the already-computed tier before the
  // roadmap covers what's next.
  printTierAnalysis(report, t, p);

  // Tier roadmap: current -> next (parity with render-html.js's
  // roadmapSection), falls back to the old generic band next-step text
  // when there's no tierKey on `maturity`.
  printRoadmap(report, maturity, t, lang, p);

  return lines.join('\n');
}

module.exports = { renderTerminal };
