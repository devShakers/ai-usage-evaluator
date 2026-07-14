'use strict';

const { getCatalog } = require('./i18n');

/*
 * Client-side "remediation prompt" for the certify report (skill-code-
 * certification, issue 011). From the LLM's returned `improvements` per Skill,
 * assemble a ready-to-paste prompt the Talent drops into their own AI tool
 * (Claude Code / Cursor / …) to actually apply those improvements in their
 * project.
 *
 * ONE prompt PER Skill (design choice, documented): improvements are
 * per-Skill and a Talent typically acts on one Skill at a time; a focused
 * prompt yields a focused change set. Purely deterministic assembly from data
 * the report already has — never a second LLM call, never invents content
 * (same "mechanical, not authored" spirit as src/roadmap-prompt.js). Contains
 * NO code (improvements are prose; the sampled code was ephemeral and never
 * comes back to the CLI).
 *
 * Returns `null` when there are no improvements to act on, so callers can
 * skip the block entirely rather than render an empty prompt.
 */
function buildRemediationPrompt(item, lang) {
  const r = getCatalog(lang).certify.report;
  const improvements =
    item && item.result && Array.isArray(item.result.improvements)
      ? item.result.improvements.filter((x) => typeof x === 'string' && x)
      : [];
  if (improvements.length === 0) return null;

  const lines = [];
  lines.push(r.remediationIntro(item.skillName, item.technology));
  lines.push('');
  improvements.forEach((imp, i) => lines.push(`${i + 1}. ${imp}`));
  lines.push('');
  lines.push(r.remediationClosing);
  return lines.join('\n');
}

module.exports = { buildRemediationPrompt };
