'use strict';

/*
 * Terminal render of a SINGLE agent-certification result (`certify agents`).
 * Printed right after each verdict. Zero-dep ANSI. The HTML surface is the
 * footprint report's agents section (a level tag on the agent's card) — this
 * module is the terminal-only, per-agent detail: level, the "why" (verified vs
 * unverified evidence), the five areas with their tag, and the rationale.
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

// Higher levels greener; floor red. Purely visual, never affects the level.
function levelColor(level) {
  if (level === 'P5' || level === 'P4') return c.green;
  if (level === 'P3' || level === 'P2') return c.yellow;
  if (level === 'P1') return c.cyan;
  return c.red; // none / not substantiated
}

function tagColor(tag) {
  if (tag === 'verified') return c.green;
  if (tag === 'partial') return c.yellow;
  if (tag === 'n_a') return c.gray;
  return c.red; // claimed / not_evidenced
}

/**
 * Returns the terminal report as a string. `verdict` is the normalized client
 * shape ({agentName, category, role, level, areas, verifiedEvidence,
 * unverifiedEvidence, rationale}); `t` is the full i18n catalog for the run's
 * language.
 */
function renderAgentCertification(verdict, t) {
  const ca = t.certifyAgents;
  const lines = [];
  const p = (s = '') => lines.push(s);

  const levelName = (ca.levelNames && ca.levelNames[verdict.level]) || verdict.level;
  const roleBit = verdict.role
    ? ` ${c.gray}·${c.reset} ${verdict.role}${verdict.category ? ` ${c.gray}(${t.classification.categories[verdict.category] || verdict.category})${c.reset}` : ''}`
    : '';

  p();
  p(`  ${c.bold}${c.cyan}${ca.reportHeading}${c.reset}${c.gray}  ·  ${verdict.agentName}${c.reset}${roleBit}`);
  p(`  ${ca.levelLabel}: ${levelColor(verdict.level)}${c.bold}${levelName}${c.reset}`);
  const desc = ca.levelDesc && ca.levelDesc[verdict.level];
  if (desc) p(`  ${c.dim}${desc}${c.reset}`);
  p();

  // Why: verified + unverified evidence.
  p(`  ${c.bold}${ca.whyHeading}${c.reset}`);
  p(`  ${c.green}${ca.verifiedHeading}${c.reset}`);
  if (verdict.verifiedEvidence.length) {
    for (const e of verdict.verifiedEvidence) p(`    ${c.green}✓${c.reset} ${e}`);
  } else {
    p(`    ${c.dim}${ca.noVerified}${c.reset}`);
  }
  if (verdict.unverifiedEvidence.length) {
    p(`  ${c.yellow}${ca.unverifiedHeading}${c.reset}`);
    for (const e of verdict.unverifiedEvidence) p(`    ${c.yellow}~${c.reset} ${c.gray}${e}${c.reset}`);
  }
  p();

  // Areas with tags.
  p(`  ${c.bold}${ca.areasHeading}${c.reset}`);
  for (const a of verdict.areas) {
    const areaName = (ca.areaNames && ca.areaNames[a.area]) || a.area;
    const tagLabel = (ca.tagLabels && ca.tagLabels[a.tag]) || a.tag;
    p(`    ${tagColor(a.tag)}●${c.reset} ${c.white}${areaName}${c.reset} ${c.gray}—${c.reset} ${tagColor(a.tag)}${tagLabel}${c.reset}`);
    if (a.evidence) p(`        ${c.dim}${a.evidence}${c.reset}`);
  }

  if (verdict.rationale) {
    p();
    p(`  ${c.bold}${ca.rationaleHeading}${c.reset}`);
    p(`  ${c.gray}${verdict.rationale}${c.reset}`);
  }
  p();

  return lines.join('\n');
}

module.exports = { renderAgentCertification };
