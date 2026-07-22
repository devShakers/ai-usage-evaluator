'use strict';

/*
 * Terminal SUMMARY of a SINGLE agent-certification result (`certify agents`).
 * Printed right after each verdict. Zero-dep ANSI. Intentionally compact and
 * scannable: level Pn + agent name + role · category, and how many of the five
 * areas came back verified. The FULL breakdown — the "why" (verified/unverified
 * evidence), the five areas with their tags, and the rationale — now lives in
 * the HTML report's agents section (render-html.js#agentCertLevelHtml), reached
 * via the `report` command (see certifyAgents.savedHint).
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

/**
 * Returns the terminal SUMMARY as a string. `verdict` is the normalized client
 * shape ({agentName, category, role, level, areas, verifiedEvidence,
 * unverifiedEvidence, rationale}); `t` is the full i18n catalog for the run's
 * language. Only level, name, role·category and the verified-area count are
 * shown here — the pointer to the full HTML breakdown is printed by the caller
 * (certifyAgents.savedHint).
 */
function renderAgentCertification(verdict, t) {
  const ca = t.certifyAgents;
  const lines = [];
  const p = (s = '') => lines.push(s);

  const levelName = (ca.levelNames && ca.levelNames[verdict.level]) || verdict.level;
  const roleBit = verdict.role
    ? ` ${c.gray}·${c.reset} ${verdict.role}${verdict.category ? ` ${c.gray}(${t.classification.categories[verdict.category] || verdict.category})${c.reset}` : ''}`
    : '';

  const areas = Array.isArray(verdict.areas) ? verdict.areas : [];
  const verifiedCount = areas.filter((a) => a && a.tag === 'verified').length;
  const total = areas.length;

  p();
  p(`  ${c.bold}${c.cyan}${ca.summaryHeading}${c.reset}${c.gray}  ·  ${verdict.agentName}${c.reset}${roleBit}`);
  const desc = ca.levelDesc && ca.levelDesc[verdict.level];
  p(
    `  ${ca.levelLabel}: ${levelColor(verdict.level)}${c.bold}${levelName}${c.reset}` +
      (desc ? ` ${c.dim}— ${desc}${c.reset}` : ''),
  );
  if (total) p(`  ${c.dim}${ca.areasVerified(verifiedCount, total)}${c.reset}`);
  p();

  return lines.join('\n');
}

module.exports = { renderAgentCertification };
