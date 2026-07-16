'use strict';

const { getCatalog, categoryLabel } = require('./i18n');
const { buildAgentCardTree } = require('./render-html');
const { getRoadmapEntry } = require('./roadmap-content');
const { analyzeTier } = require('./tier-analysis');
const { mergeRoadmapPersonalization } = require('./roadmap-personalization');
const { buildImplementationPrompt } = require('./roadmap-prompt');

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

/*
 * Terminal-SUMMARIZE (user feedback, 2026-07-16): the earlier condense (commit
 * 465badb) over-trimmed — it left the terminal as headings + copyable prompts
 * with the prose stripped out. The user wants the terminal INFORMATIVE but
 * concise: the same sections as the HTML, but SHORTENED to scannable one-liners
 * instead of the HTML's full-length prose. `summarize` collapses whitespace and
 * trims a long string to ~max chars, cutting at a sentence boundary when there
 * is one past the halfway mark, else at a word boundary, adding an ellipsis.
 * Copyable prompts are NEVER passed through this — they stay verbatim.
 */
function summarize(text, max = 140) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastStop = slice.lastIndexOf('. ');
  if (lastStop >= max * 0.5) return slice.slice(0, lastStop + 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:.]+$/, '') + '…';
}

/* ---------- environment (summarized parity with render-html.js) ----------
 * A compact readout of the machine: platform (+ arch), Node version, and the
 * installed editors — one or two short lines, not the HTML's card grid.
 */
function printEnvironment(report, t, p) {
  const env = report.environment || {};
  const editors = Array.isArray(env.editorsInstalled) ? env.editorsInstalled : [];
  p(`  ${c.bold}${t.html.environment}${c.reset}`);
  const machineBits = [];
  if (env.platform) machineBits.push(`${t.html.platform}: ${env.platform}${env.arch ? ` (${env.arch})` : ''}`);
  if (env.nodeVersion) machineBits.push(`Node ${env.nodeVersion}`);
  if (machineBits.length) p(`  ${c.gray}${machineBits.join(' · ')}${c.reset}`);
  const editorsText = editors.length ? editors.join(', ') : t.html.noEditorsDetected;
  p(`  ${c.gray}${t.html.installedEditors}: ${editorsText}${c.reset}`);
  p();
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

/* ---------- agents (summarized terminal view) ----------
 * Same tree (buildAgentCardTree, shared with the HTML renderer), rendered
 * as an indented list with a rail-like connector to keep the hierarchy
 * scannable. Terminal-summarize (user feedback, 2026-07-16): the structure
 * (agent name (+ symbolic name when synthesized) + model) PLUS a SHORT,
 * one-line description (`whatItDoes`, truncated) — the HTML report keeps the
 * full-length description and the tools list. Guards against a malformed
 * `parent` cycle the same defensive way agentNodeHtml does (a `visited` set),
 * never an infinite loop on bad input.
 */

function agentLine(card, depth) {
  const indent = '  '.repeat(depth);
  const connector = depth === 0 ? c.green + '●' + c.reset : c.gray + '└─' + c.reset;
  const title = card.symbolicName
    ? `${card.symbolicName} ${c.gray}(${card.name})${c.reset}`
    : card.name;
  const modelBit = card.model ? ` ${c.dim}[${card.model}]${c.reset}` : '';
  return `  ${indent}${connector} ${c.bold}${c.white}${title}${c.reset}${modelBit}`;
}

function printAgents(report, t, p) {
  const { childrenByParent, roots } = buildAgentCardTree(report, t);
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
    p(agentLine(card, depth));
    // Short one-line description (summarized whatItDoes) under the agent, kept
    // in the terminal now (was HTML-only after the condense).
    if (card.whatItDoes) {
      const indent = '  '.repeat(depth);
      p(`  ${indent}   ${c.dim}${summarize(card.whatItDoes, 96)}${c.reset}`);
    }
    const children = childrenByParent.get(card.name) || [];
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  p();
}

/* ---------- tier analysis: why this tier (summarized) ----------
 * Same deterministic source (src/tier-analysis.js) as the HTML report. The
 * terminal now shows: the current tier (first sentence of the intro — the rest
 * is boilerplate about how the engine works, HTML-only), a SHORT met-criteria
 * checklist (the "criterios" the user asked to see back — each line summarized),
 * and the EXACT criterion blocking the next tier (or the "you meet every
 * criterion" note at the max tier). Never LLM content, formula-driven.
 */

function printTierAnalysis(report, t, p) {
  const analysis = analyzeTier(report, t);
  const tt = t.tierAnalysis;

  p(`  ${c.bold}${tt.heading}${c.reset}`);
  // Keep the first sentence of the intro ("Your current tier is X (Name).") —
  // the rest explains the engine mechanics at length, which stays HTML-only.
  const introFull = tt.intro(analysis.tierKey, analysis.tierName);
  const firstStop = introFull.indexOf('. ');
  const intro = firstStop >= 0 ? introFull.slice(0, firstStop + 1) : introFull;
  p(`  ${c.gray}${intro}${c.reset}`);

  // Summarized met-criteria checklist (reintroduced 2026-07-16): the criteria
  // already satisfied, one concise line each. Full-length wording stays in HTML.
  if (Array.isArray(analysis.metCriteria) && analysis.metCriteria.length) {
    p(`  ${c.dim}${tt.metHeading}${c.reset}`);
    analysis.metCriteria.forEach((m) => p(`    ${c.green}✓${c.reset} ${c.gray}${summarize(m.text, 110)}${c.reset}`));
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

  p(`  ${c.bold}${c.yellow}${t.html.roadmapHeading}${c.reset}`);

  // talents-ai-score, i18n audit: both es/en roadmap content is fully
  // authored today (src/roadmap-content.js) — this defensive branch only
  // fires for a FUTURE tier added to Spanish before English catches up,
  // never against the current T0-T7 set. Never falls back to Spanish
  // prose: shows a short, all-English notice instead.
  if (curatedEntry.contentUnavailable) {
    p(`  ${c.white}${t.html.roadmapContentUnavailable}${c.reset}`);
    if (!curatedEntry.maxTier) p(`  ${c.dim}${t.cli.buildNextLevelHint}${c.reset}`);
    p();
    return;
  }

  const personalization = report && report.roadmapPersonalization;
  const entry = mergeRoadmapPersonalization(curatedEntry, personalization);

  // Terminal-SUMMARIZE (user feedback, 2026-07-16): the earlier condense left
  // only the title + steps here. Bring back the motivational prose the user
  // wants — "you level up when" (jump) / what-remains (T7) and "what it unlocks"
  // — but SHORTENED to one line each; the HTML keeps the full-length prose.
  p(`  ${c.white}${c.bold}${entry.title}${c.reset}`);

  if (entry.maxTier) {
    // ADR-008 (skill-code-certification): T7 is NOT a dead end. Show a short
    // "what remains" line + the curated continuous-refinement steps (optimize
    // hooks/agents, contribute skills, maintain, measure) so the top setups
    // still get actionable next-steps. Curated content, never LLM.
    if (entry.whatRemains) p(`  ${c.gray}${summarize(entry.whatRemains, 150)}${c.reset}`);
    if (Array.isArray(entry.consolidationSteps) && entry.consolidationSteps.length) {
      p(`  ${c.dim}${t.html.roadmapConsolidationLabel}:${c.reset}`);
      entry.consolidationSteps.forEach((s) => p(`    ${c.green}•${c.reset} ${s}`));
    }
  } else {
    if (entry.upgradeWhen) {
      p(`  ${c.dim}${t.html.roadmapUpgradeWhenLabel}${c.reset} ${c.gray}${summarize(entry.upgradeWhen, 120)}${c.reset}`);
    }
    if (entry.unlocks) {
      p(`  ${c.dim}${t.html.roadmapUnlocksLabel}:${c.reset} ${c.gray}${summarize(entry.unlocks, 140)}${c.reset}`);
    }
    if (Array.isArray(entry.steps) && entry.steps.length) {
      p(`  ${c.dim}${t.html.roadmapStepsLabel}:${c.reset}`);
      entry.steps.forEach((s, i) => p(`    ${i + 1}. ${s.text} ${c.dim}(${s.estimate})${c.reset}`));
    }
  }

  // talents-ai-score, "next steps -> prompt": the PRIMARY "how do I
  // implement this" path now — a deterministic, ready-to-paste prompt
  // (src/roadmap-prompt.js), shown as a clearly delimited block so it's
  // easy to select+copy straight from the terminal. skill-code-certification
  // (ADR-008): shown for the T7 terminal entry TOO — there it's a
  // consolidation/refinement prompt, so the top of the ladder never shows
  // "nothing" (consejos + prompt, always).
  {
    const promptText = buildImplementationPrompt(entry, report, maturity, lang);
    if (promptText) {
      p();
      p(`  ${c.bold}${t.html.implementationPromptHeading}${c.reset}`);
      p(`  ${c.dim}${t.html.implementationPromptHint}${c.reset}`);
      const rule = '─'.repeat(48);
      p(`  ${c.gray}${rule}${c.reset}`);
      for (const line of promptText.split('\n')) p(`  ${line}`);
      p(`  ${c.gray}${rule}${c.reset}`);
    }
  }

  // --build-next-level (issue 021) is now a SECONDARY, opt-in alternative
  // to the prompt above — never when already at the terminal T7 entry
  // (there is nothing left to build).
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
    // Terminal-condense (CPO feedback): keep the one-line signal (name,
    // version, category, depth breakdown); the per-tool footprint bytes and
    // recency detail line is dropped from the terminal (it stays in the HTML
    // report).
    const depthBits = Object.entries(tool.depth)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    const extra = depthBits ? `${c.dim} — ${depthBits}${c.reset}` : '';
    const version = tool.version ? `${c.dim} v${tool.version}${c.reset}` : '';
    p(`  ${c.green}●${c.reset} ${tool.name}${version} ${c.gray}(${categoryLabel(lang, tool.category)})${c.reset}${extra}`);
  }
  p();

  // talents-ai-score: the "Not detected: ..." line is intentionally
  // removed — undetected tools added noise without signal, and a relevant
  // next step is already covered by the tier roadmap section below, never
  // silently dropped, just not repeated here as a name list.

  // Environment (summarized parity with render-html.js): reintroduced
  // 2026-07-16 in short form (platform/Node/editors on one/two lines).
  printEnvironment(report, t, p);

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
