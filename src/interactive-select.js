'use strict';

/*
 * Zero-dependency interactive multi-select (skill-code-certification, issue
 * 011). Arrow keys to move, space to toggle, `a` to toggle-all, enter to
 * confirm, esc/ctrl-c to cancel — no typing comma-separated indices.
 *
 * Built as a pure state reducer (`applyKey`) + a pure key decoder
 * (`decodeKey`) + a thin raw-stdin driver (`runInteractiveMultiSelect`), so
 * the logic is unit-testable without a real TTY. Uses only node stdlib (raw
 * mode on the input stream + a `data` listener), honoring the repo's
 * zero-dependency invariant. The caller only invokes the driver on a real
 * TTY; `--all`/`--skills` remain the non-interactive path.
 */

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
};

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

// Pure reducer. `state` = { cursor, marked:Set<number>, count, done, cancelled }.
// Returns a NEW state (marked copied) so callers/tests can compare snapshots.
//
// `single` = SINGLE-SELECT mode (one item, e.g. `certify agents` picking one
// agent): ENTER (or space) picks the HIGHLIGHTED item and finishes immediately;
// there is no toggle and no "select all". `single=false` (default) keeps the
// original multi-select behaviour used by `certify skills`.
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

// Builds the visible block (array of lines) for the current state. In `single`
// mode there is no checkbox — just the arrow pointer (radio style).
function renderLines(state, { items, labelFor, header, hint, single = false }) {
  const lines = [];
  if (header) lines.push(`  ${ANSI.bold}${header}${ANSI.reset}`);
  if (hint) lines.push(`  ${ANSI.dim}${hint}${ANSI.reset}`);
  items.forEach((item, i) => {
    const isCursor = i === state.cursor;
    const pointer = isCursor ? `${ANSI.cyan}›${ANSI.reset}` : ' ';
    const box = single ? '' : `${state.marked.has(i) ? `${ANSI.green}[x]${ANSI.reset}` : '[ ]'} `;
    const label = labelFor(item, i);
    const shown = isCursor ? `${ANSI.bold}${label}${ANSI.reset}` : label;
    lines.push(`  ${pointer} ${box}${shown}`);
  });
  return lines;
}

// Raw-stdin driver. Resolves with the selected items (list order) on enter,
// or `null` on cancel (esc/ctrl-c). Injectable input/output for testing:
// `input` must be an EventEmitter emitting 'data'; setRawMode/resume/pause are
// called only if present.
function runInteractiveMultiSelect({
  items,
  labelFor = (x) => String(x),
  header = '',
  hint = '',
  single = false,
  input = process.stdin,
  output = process.stdout,
}) {
  return new Promise((resolve) => {
    let state = { cursor: 0, marked: new Set(), count: items.length, done: false, cancelled: false };
    let printedLines = 0;

    function draw() {
      const lines = renderLines(state, { items, labelFor, header, hint, single });
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

module.exports = { decodeKey, applyKey, selectedFrom, renderLines, runInteractiveMultiSelect, ANSI };
