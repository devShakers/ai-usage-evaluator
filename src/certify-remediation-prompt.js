'use strict';

const { getCatalog } = require('./i18n');

// Client-side "remediation prompt" for the certify report (skill-code- certification, issue 011).
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
