'use strict';

/*
 * Terminal render of a SINGLE agent-certification result (`certify agents`),
 * printed right after each verdict. Zero-dep ANSI. A MID-LEVEL summary: level
 * Pn + agent name + role · category, then the five assessed areas one line each
 * with their performance tag and the verified count — enough to see WHERE the
 * command is strong/weak at a glance, WITHOUT the full evidence lists or the
 * long rationale. Those (and the same areas) live in the HTML report's own
 * "Agent certification" section, reached via the `report` command
 * (certifyAgents.savedHint). Coherence: the verified count and the per-area
 * tags come straight from the area tags the level is derived from, so the
 * terminal can never contradict the level (mirrors the HTML derivation).
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

// Per-area tag color. Verified green, partial amber, n_a muted, the rest red.
function tagColor(tag) {
  if (tag === 'verified') return c.green;
  if (tag === 'partial') return c.yellow;
  if (tag === 'n_a') return c.gray;
  return c.red; // claimed / not_evidenced
}

/**
 * Returns the terminal summary as a string. `verdict` is the normalized client
 * shape ({agentName, category, role, level, areas, verifiedEvidence,
 * unverifiedEvidence, rationale}); `t` is the full i18n catalog for the run's
 * language. Renders level + role·category + the five areas with their tag and
 * the verified count — not the evidence lists or the rationale (HTML report).
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
  p(`  ${ca.levelLabel}: ${levelColor(verdict.level)}${c.bold}${levelName}${c.reset}`);

  if (total) {
    p(`  ${c.bold}${ca.areasHeading}${c.reset} ${c.gray}(${ca.areasVerified(verifiedCount, total)})${c.reset}`);
    for (const a of areas) {
      const areaName = (ca.areaNames && ca.areaNames[a.area]) || a.area;
      const tagLabel = (ca.tagLabels && ca.tagLabels[a.tag]) || a.tag;
      p(
        `    ${tagColor(a.tag)}●${c.reset} ${c.white}${areaName}${c.reset} ` +
          `${c.gray}—${c.reset} ${tagColor(a.tag)}${tagLabel}${c.reset}`,
      );
    }
  }
  p();

  return lines.join('\n');
}

module.exports = { renderAgentCertification };
