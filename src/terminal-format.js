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

// ADR-016: a light visual break between the reordered sections — a dim rule
// with air around it, keeping the branded ANSI look and zero deps.
function sep(p) {
  p();
  p(`  ${c.muted}${'─'.repeat(46)}${c.reset}`);
  p();
}

// WRAPPING, added for issue 087.
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

// One step, wrapped, with its estimate.
function printStepLines(p, marker, text, estimate) {
  const indent = ' '.repeat(4 + marker.length + 1);
  const width = WRAP_COLS - indent.length;
  const lines = wrap(text, width);
  if (lines.length === 0) return;
  // The estimate is measured, not just appended.
  const plain = estimate ? ` (${estimate})` : '';
  const coloured = estimate ? ` ${c.dim}(${estimate})${c.reset}` : '';
  const last = lines.length - 1;
  const fits = !estimate || lines[last].length + plain.length <= width;
  lines.forEach((line, i) => {
    const head = i === 0 ? `    ${marker} ` : indent;
    p(`${head}${line}${i === last && fits ? coloured : ''}`);
  });
  if (estimate && !fits) p(`${indent}${c.dim}(${estimate})${c.reset}`);
}

// A LABELLED BLOCK: the label on its own dim line, the value wrapped and indented under it.
function labelledBlock(p, label, value, indent = '    ') {
  if (!value) return;
  p(`  ${c.dim}${label}${c.reset}`);
  for (const line of wrap(value, WRAP_COLS - indent.length)) p(`${indent}${c.muted}${line}${c.reset}`);
}

// Terminal-SUMMARIZE (user feedback, 2026-07-16): the earlier condense (commit 465badb) over-trimmed — it left the terminal as headings + copyable prompts with the prose stripped out.
function summarize(text, max = 140) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastStop = slice.lastIndexOf('. ');
  if (lastStop >= max * 0.5) return slice.slice(0, lastStop + 1);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:.]+$/, '') + '…';
}

module.exports = { c, bar, sep, wrap, printStepLines, labelledBlock, summarize, WRAP_COLS };
