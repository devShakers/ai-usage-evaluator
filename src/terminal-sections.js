'use strict';

// The MCP-services, tier-analysis, progression-ladder and tier-roadmap sections of the terminal report, extracted from src/render-terminal.js (structure refactor, issue 020).

const { getRoadmapEntry } = require('./roadmap-content');
const { analyzeTier, buildLadder } = require('./tier-analysis');
const { mergeRoadmapPersonalization } = require('./roadmap-personalization');
const { buildImplementationPrompt } = require('./roadmap-prompt');
const { sanitizeRenderText } = require('./sanitize-network-text');
const { callFailed, MODEL_CALL } = require('./model-call-record');
const { projectNextTier } = require('./tier-projection');
const { c, sep, wrap, summarize, labelledBlock, printStepLines } = require('./terminal-format');

function printMcpServices(report, t, p) {
  const mcp = report && report.mcp ? report.mcp : null;
  const services = mcp && Array.isArray(mcp.services) ? mcp.services : [];
  const unidentified = mcp && typeof mcp.unidentified === 'number' ? mcp.unidentified : 0;

  p(`  ${c.bold}${t.html.mcpHeading}${c.reset}`);
  if (services.length === 0 && unidentified === 0) {
    for (const line of wrap(t.html.mcpEmpty)) p(`  ${c.muted}${line}${c.reset}`);
    p();
    return;
  }
  if (services.length) {
    const shown = services.map((s) => `${sanitizeRenderText(s.label)}${s.count > 1 ? ` ×${s.count}` : ''}`);
    p(`  ${c.primary}${shown.join(`${c.reset}${c.muted} · ${c.reset}${c.primary}`)}${c.reset}`);
  }
  // Stated, never omitted: the list has to account for every server the tier
  // counted, or the screen shows two different numbers for one set (issue 096).
  if (unidentified > 0) {
    for (const line of wrap(t.html.mcpUnidentified(unidentified))) p(`  ${c.dim}${line}${c.reset}`);
  }
  p();
}

// tier analysis: why this tier (summarized) Same deterministic source (src/tier-analysis.js) as the HTML report.

function printTierAnalysis(report, t, p) {
  const analysis = analyzeTier(report, t);
  const tt = t.tierAnalysis;

  p(`  ${c.bold}${tt.heading}${c.reset}`);
  // Keep the first sentence of the intro ("Your current tier is X (Name).") —
  // the rest explains the engine mechanics at length, which stays HTML-only.
  const introFull = tt.intro(analysis.tierKey, analysis.tierName);
  const firstStop = introFull.indexOf('. ');
  const intro = firstStop >= 0 ? introFull.slice(0, firstStop + 1) : introFull;
  p(`  ${c.muted}${intro}${c.reset}`);

  // Summarized met-criteria checklist (reintroduced 2026-07-16): the criteria
  // already satisfied, one concise line each. Full-length wording stays in HTML.
  if (Array.isArray(analysis.metCriteria) && analysis.metCriteria.length) {
    p(`  ${c.dim}${tt.metHeading}${c.reset}`);
    analysis.metCriteria.forEach((m) => p(`    ${c.success}✓${c.reset} ${c.muted}${summarize(m.text, 110)}${c.reset}`));
  }

  if (analysis.blockingCriterion) {
    p(`  ${c.bold}${c.warning}${tt.blockingLabel}${c.reset}`);
    p(`  ${c.white}${analysis.blockingCriterion}${c.reset}`);
  } else {
    p(`  ${c.white}${tt.maxTierNote}${c.reset}`);
  }
  p();
}

function ladderMark(status) {
  if (status === 'done') return `${c.success}✓${c.reset}`;
  if (status === 'current') return `${c.primary}${c.bold}●${c.reset}`;
  return `${c.muted}○${c.reset}`;
}

function printLadder(report, t, p) {
  const ld = t.ladder;
  const { setupLevels } = buildLadder(report, t);
  const allTiers = setupLevels.flatMap((lvl) => lvl.tiers);
  const done = allTiers.filter((x) => x.status === 'done').length;
  const current = allTiers.filter((x) => x.status === 'current').length;
  const pending = allTiers.filter((x) => x.status === 'pending').length;

  p(`  ${c.bold}${ld.setupHeading}${c.reset}`);
  p(`  ${c.muted}${ld.setupIntro}${c.reset}`);
  p(`  ${c.dim}${ld.legend(done, current, pending)}${c.reset}`);
  p();
  // NESTED (ADR-016): each SETUP LEVEL, then its tiers indented beneath.
  for (const lvl of setupLevels) {
    const nameStyle = lvl.status === 'pending' ? c.muted : `${c.bold}${c.white}`;
    const keys = lvl.tierKeys.length ? ` ${c.muted}— [${lvl.tierKeys.join(', ')}]${c.reset}` : '';
    // "You are here" lives ONLY on the current TIER, not the level header (user request).
    p(`  ${ladderMark(lvl.status)} ${nameStyle}${lvl.emoji} ${lvl.label}${c.reset}${keys}`);
    p(`      ${c.dim}${lvl.description}${c.reset}`);
    for (const tier of lvl.tiers) {
      const tierNameStyle = tier.status === 'pending' ? c.muted : c.white;
      const tierBadge = tier.status === 'current' ? `  ${c.primary}${ld.currentLabel}${c.reset}` : '';
      p(`        ${ladderMark(tier.status)} ${c.bold}${tier.tierKey}${c.reset} ${tierNameStyle}${tier.name}${c.reset}${tierBadge}`);
      p(`            ${c.dim}${tier.description}${c.reset}`);
      if (tier.unlock) {
        p(`            ${c.muted}${ld.unlockLabel}: ${tier.unlock}${c.reset}`);
      }
    }
    p();
  }
}

// One side of the before/after, in the SAME format for both — the comparison is the feature, so a second formatter here would defeat it.
function projectionLine(side, t) {
  const name = (t.tierNames && t.tierNames[side.tierKey]) || side.tierKey;
  const setup = (t.setupLevels && t.setupLevels[side.setupLevelKey] && t.setupLevels[side.setupLevelKey].label)
    || side.setupLevelKey;
  return `${side.tierKey} · ${name} · ${setup} · ${side.score}/100`;
}

function printProjection(report, t, p) {
  const projection = projectNextTier(report);
  if (!projection) return;

  p();
  p(`  ${c.dim}${t.html.roadmapNowLabel}${c.reset}`);
  p(`  ${c.white}${projectionLine(projection.current, t)}${c.reset}`);
  p();
  // The tag rides ON the heading, not in a footnote: a reader who skims the two
  // numbers must still see that the second one is a projection.
  p(`  ${c.dim}${t.html.roadmapProjectionLabel}${c.reset}  ${c.warning}[${t.html.roadmapProjectionTag}]${c.reset}`);
  p(`  ${c.white}${projectionLine(projection.projected, t)}${c.reset}`);
  for (const line of wrap(t.html.roadmapProjectionNote)) p(`  ${c.dim}${line}${c.reset}`);
}

function printRoadmap(report, maturity, t, lang, p) {
  const tierKey = maturity && maturity.tierKey;
  const curatedEntry = tierKey ? getRoadmapEntry(tierKey, lang) : null;

  if (!curatedEntry) {
    const nextStep = t.nextSteps[maturity.level] || maturity.next;
    p(`  ${c.bold}${c.warning}${t.terminal.nextStep}${c.reset}`);
    p(`  ${c.white}${nextStep}${c.reset}`);
    p();
    return;
  }

  p(`  ${c.bold}${c.warning}${t.html.roadmapHeading}${c.reset}`);
  // Issue 083: the register, stated before the content.
  // Wrapped like every other prose line in this block (issue 087): it was the one line still running past the 80th column, which is the shape the squad read as a dump.
  for (const line of wrap(t.html.roadmapSubheading)) p(`  ${c.dim}${line}${c.reset}`);

  if (curatedEntry.contentUnavailable) {
    p(`  ${c.white}${t.html.roadmapContentUnavailable}${c.reset}`);
    if (!curatedEntry.maxTier) p(`  ${c.dim}${t.cli.buildNextLevelHint}${c.reset}`);
    p();
    return;
  }

  const personalization = report && report.roadmapPersonalization;
  const entry = mergeRoadmapPersonalization(curatedEntry, personalization);

  // Issue 087: the jump title gets air and its own line, and everything below it hangs off it.
  // THE BEFORE AND THE AFTER (issue 084), above the steps and not below them.
  printProjection(report, t, p);

  p();
  p(`  ${c.white}${c.bold}${sanitizeRenderText(entry.title)}${c.reset}`);
  p();

  // Issue 109: whether this roadmap is YOURS or the template, said out loud.
  if (personalization) {
    p(`  ${c.dim}${t.html.roadmapPersonalizedNotice}${c.reset}`);
    p();
  } else if (callFailed(report, MODEL_CALL.ROADMAP)) {
    for (const line of wrap(t.html.roadmapNotPersonalizedNotice)) p(`  ${c.dim}${line}${c.reset}`);
    p();
  }

  if (entry.maxTier) {
    // ADR-008 (skill-code-certification): T7 is NOT a dead end.
    if (entry.whatRemains) {
      for (const line of wrap(sanitizeRenderText(entry.whatRemains))) p(`  ${c.muted}${line}${c.reset}`);
      p();
    }
    if (Array.isArray(entry.consolidationSteps) && entry.consolidationSteps.length) {
      p(`  ${c.dim}${t.html.roadmapConsolidationLabel}:${c.reset}`);
      entry.consolidationSteps.forEach((step) => printStepLines(p, `${c.success}•${c.reset}`, sanitizeRenderText(step), null));
    }
  } else {
    labelledBlock(p, t.html.roadmapUpgradeWhenLabel, sanitizeRenderText(entry.upgradeWhen));
    if (entry.upgradeWhen) p();
    labelledBlock(p, `${t.html.roadmapUnlocksLabel}:`, sanitizeRenderText(entry.unlocks));
    if (entry.unlocks) p();
    if (Array.isArray(entry.steps) && entry.steps.length) {
      p(`  ${c.dim}${t.html.roadmapStepsLabel}:${c.reset}`);
      // Numbered, wrapped, and with the estimate on the same line as the step it belongs to.
      const width = String(entry.steps.length).length;
      entry.steps.forEach((step, i) => {
        const marker = `${String(i + 1).padStart(width)}.`;
        printStepLines(p, marker, sanitizeRenderText(step.text), sanitizeRenderText(step.estimate));
      });
    }
  }

  {
    const promptText = buildImplementationPrompt(entry, report, maturity, lang);
    if (promptText) {
      // Issue 087: THE wall of text.
      sep(p);
      p(`  ${c.bold}${t.html.implementationPromptHeading}${c.reset}`);
      for (const line of wrap(t.html.implementationPromptHint)) p(`  ${c.dim}${line}${c.reset}`);
      p();
      const rule = `${'─'.repeat(48)}`;
      p(`  ${c.muted}${rule}${c.reset}`);
      for (const line of promptText.split('\n')) p(`  ${sanitizeRenderText(line)}`);
      p(`  ${c.muted}${rule}${c.reset}`);
    }
  }

  // --build-next-level (issue 021) is now a SECONDARY, opt-in alternative to the prompt above — never when already at the terminal T7 entry (there is nothing left to build).
  if (!entry.maxTier) p(`  ${c.dim}${t.cli.buildNextLevelHint}${c.reset}`);

  p();
}

module.exports = { printMcpServices, printTierAnalysis, printLadder, printRoadmap };
