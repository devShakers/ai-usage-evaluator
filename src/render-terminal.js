'use strict';

const { getCatalog, categoryLabel } = require('./i18n');
const { buildAgentCardTree } = require('./render-html');
const { getRoadmapEntry } = require('./roadmap-content');
const { analyzeTier, buildLadder } = require('./tier-analysis');
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
  red: '\x1b[31m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

function bar(score, width = 24) {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ADR-016: a light visual break between the reordered sections — a dim rule
// with air around it, keeping the branded ANSI look and zero deps.
function sep(p) {
  p();
  p(`  ${c.gray}${'─'.repeat(46)}${c.reset}`);
  p();
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

/* ---------- environment REMOVED from the terminal (ADR-016) ----------
 * The "entorno"/environment section (platform / Node / editors) added no
 * signal in the terminal and was dropped entirely. It still lives in the
 * `report` HTML (render-html.js is untouched).
 */

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

/* ---------- agents (ADR-016: one line per agent) ----------
 * As SIMPLE as possible: ONE line per agent. Nesting is drawn with stacked
 * down-arrows (↓ per depth level) leading to the subagent, so a sub-agent two
 * levels down reads `↓↓ name`. Each line carries a COMPACT definition-quality
 * score (0-100, from the ephemeral LLM evaluation — src/agent-evaluation.js)
 * and a COMPACT local-usage signal (Claude Code invocation count —
 * src/agent-usage.js). The full per-agent detail (rationale, exact usage) lives
 * in the `report` HTML, never here. Same tree (buildAgentCardTree, shared with
 * the HTML renderer); guards a malformed `parent` cycle with a `visited` set.
 */

function scoreColor(score) {
  if (score >= 80) return c.green;
  if (score >= 50) return c.yellow;
  return c.red;
}

function agentScoreBit(card) {
  if (typeof card.score !== 'number') return '';
  return `  ${scoreColor(card.score)}${c.bold}${card.score}${c.reset}${c.dim}/100${c.reset}`;
}

function agentUsageBit(card, t) {
  if (card.usageCount === null || card.usageCount === undefined) return '';
  const label = card.usageCount === 0 ? t.terminal.agentUnused : t.terminal.agentUsed(card.usageCount);
  return `  ${c.gray}${label}${c.reset}`;
}

function agentLine(card, depth, t) {
  const indent = '  '.repeat(depth);
  // Root = a filled bullet; every deeper level = that many stacked down-arrows.
  const marker = depth === 0 ? `${c.green}●${c.reset}` : `${c.cyan}${'↓'.repeat(depth)}${c.reset}`;
  const title = card.symbolicName
    ? `${card.symbolicName} ${c.gray}(${card.name})${c.reset}`
    : card.name;
  const modelBit = card.model ? ` ${c.dim}[${card.model}]${c.reset}` : '';
  return `  ${indent}${marker} ${c.bold}${c.white}${title}${c.reset}${modelBit}`
    + `${agentScoreBit(card)}${agentUsageBit(card, t)}`;
}

// A compact, dim, summarized description under each agent (frontmatter
// `description` via buildAgentCardTree's whatItDoes), truncated to ~90 chars on
// a clean boundary. Full-length detail stays in the report HTML.
function agentDescLine(card, depth) {
  if (!card.whatItDoes) return null;
  const indent = '  '.repeat(depth);
  return `  ${indent}   ${c.dim}${summarize(card.whatItDoes, 90)}${c.reset}`;
}

// Agent classification (report req 2): AFFIRMATIVE one-liner — Category · Role ·
// Level, no "closest to" hedging and NO visible match-method badge (the `method`
// field stays in the data, just not rendered). A genuinely unmatched agent shows
// a neutral, plain "No category" — never bracketed/apologetic.
function agentClassLine(card, depth, t) {
  const indent = '  '.repeat(depth);
  const cc = t.classification;
  // No evaluation ran for this agent → no classification line.
  if (!card.classification) return '';
  if (card.classification.method === 'unclassified' || !card.classification.catalogId) {
    return `  ${indent}   ${c.gray}${cc.noCategory}${c.reset}`;
  }
  const { category, role, level } = card.classification;
  const catLabel = (category && cc.categories[category]) || category;
  const levelLabel = (level && cc.levels[level]) || level;
  const bits = [];
  if (catLabel) bits.push(`${c.cyan}${catLabel}${c.reset}`);
  if (role) bits.push(`${c.white}${role}${c.reset}`);
  if (levelLabel) bits.push(`${c.dim}${levelLabel}${c.reset}`);
  return `  ${indent}   ${bits.join(`${c.gray} · ${c.reset}`)}`;
}

// v4 (report req 3): the "how to improve" tips, one per line under the agent.
function agentImprovementLines(card, depth, t) {
  const tips = Array.isArray(card.improvements) ? card.improvements : [];
  if (tips.length === 0) return [];
  const indent = '  '.repeat(depth);
  const out = [`  ${indent}   ${c.dim}${t.classification.improvementsHeading}${c.reset}`];
  for (const tip of tips) out.push(`  ${indent}     ${c.gray}- ${tip}${c.reset}`);
  return out;
}

function printAgents(report, t, p) {
  const { childrenByParent, roots } = buildAgentCardTree(report, t);
  p(`  ${c.bold}${t.html.diagramHeading}${c.reset}`);
  if (!roots.length) {
    p(`  ${c.gray}  ${t.html.agentsEmpty}${c.reset}`);
    p();
    return;
  }
  const visited = new Set();
  const walk = (card, depth) => {
    if (visited.has(card.name)) return;
    visited.add(card.name);
    p(agentLine(card, depth, t));
    const desc = agentDescLine(card, depth);
    if (desc) p(desc);
    const classLine = agentClassLine(card, depth, t);
    if (classLine) p(classLine);
    for (const line of agentImprovementLines(card, depth, t)) p(line);
    const children = childrenByParent.get(card.name) || [];
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // A single note when the local usage history is unavailable, so a blank usage
  // column reads as "no local history" rather than "never used".
  if (report.agentUsage && report.agentUsage.available === false) {
    p(`  ${c.dim}${t.terminal.agentUsageUnavailable}${c.reset}`);
  }
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

/* ---------- progression ladder: levels 0-4 + tiers T0-T7 (report req 1) ----------
 * FULL in the terminal (user decision): every level and every tier with its
 * name, what it represents, and — for pending tiers — the exact unlock criterion.
 * ✓ passed · ● current · ○ pending. Deterministic (src/tier-analysis.js#buildLadder),
 * same data as the HTML report.
 */
function ladderMark(status) {
  if (status === 'done') return `${c.green}✓${c.reset}`;
  if (status === 'current') return `${c.cyan}${c.bold}●${c.reset}`;
  return `${c.gray}○${c.reset}`;
}

function printLadder(report, t, p) {
  const ld = t.ladder;
  const { levels } = buildLadder(report, t);
  const allTiers = levels.flatMap((lvl) => lvl.tiers);
  const done = allTiers.filter((x) => x.status === 'done').length;
  const current = allTiers.filter((x) => x.status === 'current').length;
  const pending = allTiers.filter((x) => x.status === 'pending').length;

  p(`  ${c.bold}${ld.levelsHeading}${c.reset}`);
  p(`  ${c.gray}${ld.intro}${c.reset}`);
  p(`  ${c.dim}${ld.legend(done, current, pending)}${c.reset}`);
  p();
  // NESTED (user decision): each maturity level, then its tiers indented beneath.
  for (const lvl of levels) {
    const nameStyle = lvl.status === 'pending' ? c.gray : `${c.bold}${c.white}`;
    const badge = lvl.status === 'current' ? `  ${c.cyan}${ld.currentLabel}${c.reset}` : '';
    const keys = lvl.tierKeys.length ? ` ${c.gray}— [${lvl.tierKeys.join(', ')}]${c.reset}` : '';
    p(`  ${ladderMark(lvl.status)} ${nameStyle}${lvl.emoji} ${ld.levelLabel(lvl.level)} · ${lvl.name}${c.reset}${keys}${badge}`);
    p(`      ${c.dim}${lvl.description}${c.reset}`);
    for (const tier of lvl.tiers) {
      const tierNameStyle = tier.status === 'pending' ? c.gray : c.white;
      const tierBadge = tier.status === 'current' ? `  ${c.cyan}${ld.currentLabel}${c.reset}` : '';
      p(`        ${ladderMark(tier.status)} ${c.bold}${tier.tierKey}${c.reset} ${tierNameStyle}${tier.name}${c.reset}${tierBadge}`);
      p(`            ${c.dim}${tier.description}${c.reset}`);
      if (tier.unlock) {
        p(`            ${c.gray}${ld.unlockLabel}: ${tier.unlock}${c.reset}`);
      }
    }
    p();
  }
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
//
// Terminal view order (ADR-016, reordered per user feedback 2026-07-17):
//   1. The SCORE / tier meter (the "nota") FIRST.
//   2. Immediately followed by the WHY — the tier-analysis rationale.
//   3. Detected tools, technologies, and a ONE-LINE-PER-AGENT summary (with ↓
//      nesting + compact score/usage).
//   4. No Environment section; the tier roadmap / next-steps is behind
//      `--roadmap` (opts.showRoadmap), not in the default output.
function renderTerminal(report, maturity, lang, opts = {}) {
  const t = getCatalog(lang);
  const lines = [];
  const p = (s = '') => lines.push(s);

  const levelName = t.levelNames[maturity.key] || maturity.name;

  // A compact brand header in BOTH modes for orientation.
  p();
  p(`${c.bold}${c.cyan}  AI FOOTPRINT${c.reset}${c.gray}  ·  ${t.terminal.brandSub}${c.reset}`);
  p(`${c.gray}  ${new Date(report.generatedAt).toLocaleString()}  ·  ${t.terminal.toolsDetected(report.tools.filter((x) => x.detected).length, report.tools.length)}${c.reset}`);

  // `--roadmap` (opts.showRoadmap): render ONLY the next-steps/roadmap section
  // (header + steps + the copyable implementation prompt) — NOT the rest of the
  // report. The default report doesn't reprint here.
  if (opts.showRoadmap) {
    sep(p);
    printRoadmap(report, maturity, t, lang, p);
    return lines.join('\n');
  }

  // Default report: score -> why -> tools -> technologies -> agents, then a
  // dim hint pointing at --roadmap (so the next-steps section is discoverable).
  // EMPTY sections are pruned entirely (no header, no "none" placeholder) —
  // only sections with actual data are printed. (Agents are NOT pruned for
  // "no local use" — an unused agent still carries a quality score + a
  // description; the agents section is omitted only when there are zero agents.)

  // 1. The score / level meter — the "nota" FIRST. The top bar now shows the
  // current TIER alongside the level (user request) — both from the already
  // computed maturity (no recompute); the tier name is localized via tierNames.
  sep(p);
  const tierName = (maturity.tierKey && t.tierNames[maturity.tierKey]) || maturity.tierName || '';
  const tierBit = maturity.tierKey ? t.terminal.tierInline(maturity.tierKey, tierName) : '';
  p(`  ${c.bold}${c.white}${t.terminal.level(maturity.level, levelName)}${c.reset}${c.gray}${tierBit}${c.reset}`);
  p(`  ${c.cyan}${bar(maturity.score)}${c.reset} ${c.dim}${maturity.score}/100${c.reset}`);

  // 2. WHY that score/tier — the rationale, right after the number.
  sep(p);
  printTierAnalysis(report, t, p);

  // 2b. Progression ladder — what each level 0-4 and tier T0-T7 means, and the
  // ✓/●/○ progression with unlock criteria (report req 1, full in terminal).
  sep(p);
  printLadder(report, t, p);

  // 3. Detected tools — omitted entirely if none detected.
  const detected = report.tools.filter((tool) => tool.detected);
  if (detected.length) {
    sep(p);
    p(`  ${c.bold}${t.terminal.detectedHeading}${c.reset}`);
    for (const tool of detected) {
      const depthBits = Object.entries(tool.depth)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      const extra = depthBits ? `${c.dim} — ${depthBits}${c.reset}` : '';
      const version = tool.version ? `${c.dim} v${tool.version}${c.reset}` : '';
      p(`  ${c.green}●${c.reset} ${tool.name}${version} ${c.gray}(${categoryLabel(lang, tool.category)})${c.reset}${extra}`);
    }
  }

  // 4. Project technologies — omitted entirely if none recognized.
  const technologies = Array.isArray(report.technologies) ? report.technologies : [];
  if (technologies.length) {
    sep(p);
    printTechnologies(report, t, p);
  }

  // 5. Agents — one line per agent (+ summarized description, ↓ nesting,
  // compact score + usage). Omitted entirely when there are no agents at all.
  const hasAgents = Array.isArray(report.agents) && report.agents.length > 0;
  if (hasAgents) {
    sep(p);
    printAgents(report, t, p);
  }

  // Discoverability hint (dim): how to see the next-steps/roadmap section.
  p(`  ${c.dim}${t.terminal.roadmapHint}${c.reset}`);
  p();

  return lines.join('\n');
}

module.exports = { renderTerminal };
