'use strict';

const { isInteractive } = require('./terminal-progress');

// Progressive reveal of text that is ALREADY IN HAND (talents-ai-score, camino A).

// 60fps. Fine enough that the reveal reads as continuous, coarse enough that a
// 700ms budget is ~43 writes rather than one per character.
const TICK_MS = 16;

// The hard ceiling on what this can add, for ANY length.
const MAX_TOTAL_MS = 700;

// How many code points to reveal per tick so that `length` finishes within `maxTicks`.
function charsPerTick(length, maxTicks) {
  if (!(length > 0)) return 0;
  if (!(maxTicks > 0)) return length;
  return Math.max(1, Math.ceil(length / maxTicks));
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Writes `text` to `stream`, progressively in a TTY and in one write otherwise.
async function typeOut(text, { stream, tickMs = TICK_MS, maxTotalMs = MAX_TOTAL_MS, sleep = defaultSleep } = {}) {
  const s = typeof text === 'string' ? text : '';
  if (!s || !stream || typeof stream.write !== 'function') return;
  if (!isInteractive(stream)) {
    stream.write(s);
    return;
  }
  const chars = Array.from(s);
  const maxTicks = Math.max(1, Math.floor((maxTotalMs > 0 ? maxTotalMs : 0) / (tickMs > 0 ? tickMs : TICK_MS)));
  const step = charsPerTick(chars.length, maxTicks);
  for (let i = 0; i < chars.length; i += step) {
    stream.write(chars.slice(i, i + step).join(''));
    // AFTER the write, and skipped on the last slice: the reveal ends when the
    // text is on screen, never one idle tick later.
    if (i + step < chars.length) await sleep(tickMs);
  }
}

// Total for the WHOLE output, same order of magnitude as the typewriter's.
const REVEAL_TOTAL_MS = 600;
// A floor, so a two-section report still reads as a reveal rather than a blink, and
// a ceiling, so a very long one never feels like waiting for the tool.
const REVEAL_MIN_STEP_MS = 24;
const REVEAL_MAX_STEP_MS = 120;
const RULE_RE = /^[\s]*[\u2500\u2501\u2508\u2509-]{20,}[\s]*$/;

// Splits rendered output into reveal chunks on BLANK LINES, holding everything between two horizontal rules together (the copyable block).
function splitSections(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s) return [];
  const parts = s.split('\n');
  const last = parts.length - 1;
  const out = [];
  let current = '';
  let held = false;
  for (let i = 0; i <= last; i++) {
    const line = parts[i];
    // The newline that FOLLOWED this line in the input belongs to this chunk, or the concatenation would lose it.
    current += line + (i < last ? '\n' : '');
    if (RULE_RE.test(line)) { held = !held; continue; }
    if (line.trim() === '' && !held && current.length) {
      out.push(current);
      current = '';
    }
  }
  if (current.length) out.push(current);
  return out;
}

function revealEnabled({ stream = process.stdout, env = process.env, animate = null } = {}) {
  if (animate === false) return false;
  const flag = env ? env.NO_ANIMATION : undefined;
  if (typeof flag === 'string' && flag.length > 0) return false;
  return isInteractive(stream);
}

// Writes `text` to `stream`, one section at a time when the reveal is on and in a SINGLE write otherwise.
async function revealText(text, { stream = process.stdout, env = process.env, animate = null, sleep = defaultSleep, totalMs = REVEAL_TOTAL_MS } = {}) {
  const s = typeof text === 'string' ? text : '';
  if (!s || !stream || typeof stream.write !== 'function') return;
  if (!revealEnabled({ stream, env, animate })) {
    stream.write(s);
    return;
  }
  const sections = splitSections(s);
  if (sections.length <= 1) {
    stream.write(s);
    return;
  }
  // THE FLOOR MUST NOT BREAK THE CEILING, and getting this wrong is the whole failure mode the issue warns about.
  const maxPauses = Math.max(1, Math.floor(totalMs / REVEAL_MIN_STEP_MS));
  const groups = [];
  const perGroup = Math.ceil(sections.length / (maxPauses + 1));
  for (let i = 0; i < sections.length; i += perGroup) groups.push(sections.slice(i, i + perGroup).join(''));
  const step = Math.min(REVEAL_MAX_STEP_MS, Math.max(REVEAL_MIN_STEP_MS, Math.floor(totalMs / groups.length)));
  for (let i = 0; i < groups.length; i++) {
    stream.write(groups[i]);
    // After the write and never after the last one: the reveal ends when the report
    // is on screen, not one step later.
    if (i < groups.length - 1) await sleep(step);
  }
}

// Backlog we tolerate before speeding up the reveal: at TICK_MS this bounds how
// far behind the stream the animation can lag (~STREAM_CATCHUP_TICKS * tickMs).
const STREAM_CATCHUP_TICKS = 50;

// A STREAMING typewriter for text that arrives in chunks over time (Alma's NDJSON
// deltas). Same pacing + gate as the report's reveal: char-by-char in a TTY,
// plain pass-through otherwise (non-TTY / NO_ANIMATION). `push(text)` feeds the
// queue; a single loop drains it at `tickMs`, revealing more per tick when the
// queue backs up so a big chunk animates continuously instead of dumping at once.
// `end()` flushes whatever is left and resolves.
function makeStreamReveal({ stream = process.stdout, env = process.env, animate = null, tickMs = TICK_MS, sleep = defaultSleep, catchupTicks = STREAM_CATCHUP_TICKS } = {}) {
  const canWrite = stream && typeof stream.write === 'function';
  if (!canWrite || !revealEnabled({ stream, env, animate })) {
    // Plain: write each chunk as it arrives, no pacing (matches the report's
    // non-TTY degradation).
    return { push: (t) => { if (t && canWrite) stream.write(String(t)); }, end: async () => {} };
  }
  const queue = [];
  let ended = false;
  let draining = null;
  const drain = async () => {
    for (;;) {
      if (queue.length === 0) {
        if (ended) return;
        await sleep(tickMs); // wait for more input without busy-spinning
        continue;
      }
      const step = Math.max(1, Math.ceil(queue.length / catchupTicks));
      stream.write(queue.splice(0, step).join(''));
      if (queue.length > 0 || !ended) await sleep(tickMs);
    }
  };
  return {
    push: (t) => {
      if (!t) return;
      for (const ch of String(t)) queue.push(ch);
      if (!draining) draining = drain();
    },
    end: async () => { ended = true; if (draining) await draining; },
  };
}

module.exports = {
  typeOut, charsPerTick, TICK_MS, MAX_TOTAL_MS,
  revealText, splitSections, revealEnabled,
  makeStreamReveal, STREAM_CATCHUP_TICKS,
  REVEAL_TOTAL_MS, REVEAL_MIN_STEP_MS, REVEAL_MAX_STEP_MS,
};
