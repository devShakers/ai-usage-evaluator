'use strict';

// The MCP-services, tier-analysis and progression-ladder sections of the terminal report, extracted from src/render-terminal.js.

const { analyzeTier, buildLadder } = require('./tier-analysis');
const { sanitizeRenderText } = require('./sanitize-network-text');
const { c, wrap, summarize } = require('./terminal-format');

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
  // counted, or the screen shows two different numbers for one set.
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
  // NESTED: each SETUP LEVEL, then its tiers indented beneath.
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

module.exports = { printMcpServices, printTierAnalysis, printLadder };
