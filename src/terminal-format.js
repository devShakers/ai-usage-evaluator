'use strict';

const { palette } = require('./ansi');
const { BRAND_ANSI } = require('./brand-ansi');

const c = palette({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  primary: BRAND_ANSI.primary,
  accent: BRAND_ANSI.accent,
  success: BRAND_ANSI.success,
  warning: BRAND_ANSI.warning,
  danger: BRAND_ANSI.danger,
  muted: BRAND_ANSI.muted,
  white: '\x1b[97m',
});

function bar(score, width = 24) {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// A light visual break between the reordered sections — a dim rule
// with air around it, keeping the branded ANSI look and zero deps.
function sep(p) {
  p();
  p(`  ${c.muted}${'─'.repeat(46)}${c.reset}`);
  p();
}

// WRAPPING.
const WRAP_COLS = 76;

function wrap(text, width = WRAP_COLS) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (!s) return [];
  const out = [];
  let line = '';
  for (const word of s.split(' ')) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

// Terminal-SUMMARIZE: the earlier condense over-trimmed — it left the terminal as headings + copyable prompts with the prose stripped out.
function summarize(text, max = 140) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastStop = slice.lastIndexOf('. ');
  if (lastStop >= max * 0.5) return slice.slice(0, lastStop + 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:.]+$/, '') + '…';
}

module.exports = { c, bar, sep, wrap, summarize };
