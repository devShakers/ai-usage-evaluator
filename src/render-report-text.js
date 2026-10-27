'use strict';

const { renderTerminal } = require('./render-terminal');
const { renderAiProfilePlain } = require('./render-ai-fluency');
const { reportGateForIdentity } = require('./report-gating');

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s) => String(s).replace(ANSI_RE, '');

function renderFullReportText(report, maturity, aiProfile, { lang = 'en', gate } = {}) {
  const profile = renderAiProfilePlain(
    aiProfile || { status: 'unavailable', preview: null },
    { lang },
  );
  let terminal = '';
  try {
    terminal = stripAnsi(renderTerminal(report, maturity, lang, { gate: gate || reportGateForIdentity() }))
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    terminal = '';
  }
  return terminal ? `\`\`\`\n${terminal}\n\`\`\`\n\n${profile}` : profile;
}

module.exports = { renderFullReportText, stripAnsi };
