'use strict';

// Shared PRESENTATION for the CLI's legal/consent disclosures (talents-ai-score).

const { palette, colorEnabled } = require('./ansi');
const { BRAND_ANSI } = require('./brand-ansi');

const RULE_CHAR = '─';
const RULE_WIDTH = 62;

function renderLegalNotice(text, catalog, { stream = process.stdout } = {}) {
  if (!colorEnabled({ stream })) return text;
  const ANSI = palette({ reset: '\x1b[0m', bold: '\x1b[1m', warning: BRAND_ANSI.warning }, { stream });
  const rule = `${ANSI.warning}${RULE_CHAR.repeat(RULE_WIDTH)}${ANSI.reset}`;
  const label = catalog && catalog.legalNotice ? catalog.legalNotice.label : null;
  const lines = [];
  if (label) lines.push(`${ANSI.bold}${ANSI.warning}⚠ ${label}${ANSI.reset}`);
  lines.push(rule, text, rule);
  // TRAILING NEWLINE (colour path only) — WHERE THE ANSWER LANDS.
  return lines.join('\n') + '\n';
}

function splitTrailingPrompt(text) {
  const s = String(text == null ? '' : text);
  const bracket = s.match(/\[[^\]\n]*\/[^\]\n]*\]\s*$/);
  if (!bracket) return { body: s, prompt: '' };
  const beforeBracket = s.slice(0, bracket.index).replace(/\s+$/, '');
  if (!beforeBracket) return { body: '', prompt: s }; // the bracket IS the whole text
  const lastChar = beforeBracket.slice(-1);
  const isSentenceEnd = lastChar === '.' || lastChar === '?' || lastChar === '!';
  // Search for the PRECEDING boundary in everything BEFORE that terminator — never in the terminator itself.
  const searchIn = isSentenceEnd ? beforeBracket.slice(0, -1) : beforeBracket;
  const boundary = Math.max(searchIn.lastIndexOf('. '), searchIn.lastIndexOf('? '), searchIn.lastIndexOf('! '));
  if (boundary === -1) return { body: '', prompt: s };
  return { body: s.slice(0, boundary + 1), prompt: s.slice(boundary + 2) };
}

// Returns `{ box, prompt }`.
function renderLegalNoticeSplit(text, catalog, { stream = process.stdout } = {}) {
  if (!colorEnabled({ stream })) return { box: null, prompt: text };
  const { body, prompt } = splitTrailingPrompt(text);
  if (!prompt) return { box: renderLegalNotice(text, catalog, { stream }), prompt: null };
  const ANSI = palette({ reset: '\x1b[0m', bold: '\x1b[1m', warning: BRAND_ANSI.warning }, { stream });
  const rule = `${ANSI.warning}${RULE_CHAR.repeat(RULE_WIDTH)}${ANSI.reset}`;
  const label = catalog && catalog.legalNotice ? catalog.legalNotice.label : null;
  const lines = [];
  if (label) lines.push(`${ANSI.bold}${ANSI.warning}⚠ ${label}${ANSI.reset}`);
  if (body) lines.push(rule, body, rule);
  else lines.push(rule); // the whole text WAS the question — nothing to box.
  return { box: lines.join('\n'), prompt };
}

module.exports = { renderLegalNotice, renderLegalNoticeSplit, splitTrailingPrompt };
