'use strict';

const { palette, styleQuestion } = require('./ansi');
const { BRAND_ANSI } = require('./brand-ansi');

// Zero-dependency interactive multi-select (skill-code-certification, issue 011).

// COLOUR goes through the one gate (src/ansi.js).
const ANSI = palette({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  primary: BRAND_ANSI.primary,
  success: BRAND_ANSI.success,
});

// Maps a raw input chunk to a logical key, or null if unrecognized. Handles
// the common single-chunk case for arrow escape sequences.
function decodeKey(chunk) {
  const s = String(chunk);
  if (s === '\x1b[A' || s === 'k') return 'up';
  if (s === '\x1b[B' || s === 'j') return 'down';
  if (s === ' ') return 'space';
  if (s === '\r' || s === '\n') return 'enter';
  if (s === 'a' || s === 'A') return 'all';
  if (s === '\x03' || s === '\x1b') return 'cancel'; // ctrl-c / esc
  return null;
}

// Pure reducer.
function applyKey(state, key, single = false) {
  const next = {
    cursor: state.cursor,
    marked: new Set(state.marked),
    count: state.count,
    done: state.done,
    cancelled: state.cancelled,
  };
  if (next.count === 0) {
    if (key === 'enter') next.done = true;
    if (key === 'cancel') next.cancelled = true;
    return next;
  }
  switch (key) {
    case 'up':
      next.cursor = (next.cursor - 1 + next.count) % next.count;
      break;
    case 'down':
      next.cursor = (next.cursor + 1) % next.count;
      break;
    case 'space':
      if (single) {
        next.marked = new Set([next.cursor]);
        next.done = true;
      } else if (next.marked.has(next.cursor)) {
        next.marked.delete(next.cursor);
      } else {
        next.marked.add(next.cursor);
      }
      break;
    case 'all':
      if (single) break; // no select-all in single mode
      if (next.marked.size === next.count) next.marked.clear();
      else for (let i = 0; i < next.count; i++) next.marked.add(i);
      break;
    case 'enter':
      // Single mode: ENTER picks the highlighted item (radio style).
      if (single) next.marked = new Set([next.cursor]);
      next.done = true;
      break;
    case 'cancel':
      next.cancelled = true;
      break;
    default:
      break;
  }
  return next;
}

// Selected items in list order from the marked index set.
function selectedFrom(state, items) {
  return items.filter((_, i) => state.marked.has(i));
}

const DESC_WRAP_COLS = 72;
function wrapDesc(text, width = DESC_WRAP_COLS) {
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

// Builds the visible block (array of lines) for the current state.
function renderLines(state, { items, labelFor, header, hint, single = false, descriptionFor = null }) {
  const lines = [];
  if (header) lines.push(`  ${styleQuestion(header)}`);
  if (hint) lines.push(`  ${ANSI.dim}${hint}${ANSI.reset}`);
  items.forEach((item, i) => {
    const isCursor = i === state.cursor;
    const pointer = isCursor ? `${ANSI.primary}›${ANSI.reset}` : ' ';
    const box = single ? '' : `${state.marked.has(i) ? `${ANSI.success}[x]${ANSI.reset}` : '[ ]'} `;
    const label = labelFor(item, i);
    const shown = isCursor ? `${ANSI.bold}${label}${ANSI.reset}` : label;
    lines.push(`  ${pointer} ${box}${shown}`);
  });
  if (typeof descriptionFor === 'function' && items.length > 0) {
    const desc = descriptionFor(items[state.cursor], state.cursor);
    if (desc) {
      lines.push('');
      for (const l of wrapDesc(desc)) lines.push(`    ${ANSI.dim}${l}${ANSI.reset}`);
    }
  }
  return lines;
}

// Raw-stdin driver.
function runInteractiveMultiSelect({
  items,
  labelFor = (x) => String(x),
  header = '',
  hint = '',
  single = false,
  descriptionFor = null,
  input = process.stdin,
  output = process.stdout,
  initialMarked = [],
}) {
  return new Promise((resolve) => {
    let state = {
      cursor: 0,
      marked: single ? new Set() : new Set(initialMarked),
      count: items.length,
      done: false,
      cancelled: false,
    };
    let printedLines = 0;

    function draw() {
      const lines = renderLines(state, { items, labelFor, header, hint, single, descriptionFor });
      // Redraw in place: move up over the previous block and clear downward.
      if (printedLines > 0) output.write(`\x1b[${printedLines}A\x1b[0J`);
      output.write(lines.join('\n') + '\n');
      printedLines = lines.length;
    }

    function cleanup() {
      if (input.setRawMode) { try { input.setRawMode(false); } catch { /* non-TTY */ } }
      input.removeListener('data', onData);
      if (input.pause) input.pause();
    }

    function onData(chunk) {
      const key = decodeKey(chunk);
      if (!key) return;
      state = applyKey(state, key, single);
      if (state.cancelled) {
        cleanup();
        resolve(null);
        return;
      }
      if (state.done) {
        cleanup();
        resolve(selectedFrom(state, items));
        return;
      }
      draw();
    }

    if (input.setRawMode) { try { input.setRawMode(true); } catch { /* non-TTY */ } }
    if (input.resume) input.resume();
    input.on('data', onData);
    draw();
  });
}

module.exports = { decodeKey, applyKey, selectedFrom, renderLines, runInteractiveMultiSelect, wrapDesc, ANSI };
