'use strict';

/*
 * Terminal progress feedback (talents-ai-score): the report got slower once
 * the level-up framework added several extra detectors (issues 015-018) plus
 * the ephemeral agent-synthesis network call (ADR-010) — this gives the
 * talent SOMETHING to look at instead of a silent terminal during that time.
 *
 * Everything here writes to STDERR, never stdout: stdout must stay exactly
 * what it was for `--json` (a single parseable JSON document) and for any
 * future piping of the terminal report — progress feedback is a side
 * channel, not report content (same principle as a build tool's progress
 * bar vs. its actual output).
 *
 * Two distinct feedback shapes, because the two slow phases have genuinely
 * different async profiles — inventing a fake animation for a phase that
 * has no real ticks to show would violate this codebase's "never invent"
 * invariant, extended here to UI feedback:
 *   - `withStaticStatus`: for a SYNCHRONOUS phase (scan() + every detector
 *     run inside it — all plain, blocking fs calls). JS is single-threaded:
 *     a blocking call gives no opportunity for an interval tick to fire
 *     mid-scan, so true animation is impossible here. Prints the label once
 *     (TTY: overwritten/erased right after; non-TTY: a single plain line),
 *     runs the synchronous function, done.
 *   - `withSpinner`: for a genuinely ASYNC phase (the agent-synthesis
 *     network call) — a real animated spinner, ticking on a timer while the
 *     awaited task is in flight, erased on completion either way (success
 *     or failure — the caller's own error handling is untouched).
 *
 * Non-TTY / piped stderr (e.g. CI logs, `2>file`): no ANSI cursor control
 * (`\r`) is ever written — degrades to a single plain status line per
 * phase instead, so redirected/logged output never contains control
 * characters or a half-erased spinner frame.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const TICK_MS = 80;

function isInteractive(stream) {
  return !!(stream && stream.isTTY);
}

// Runs a SYNCHRONOUS `fn` while showing `label` as a static status line.
// Never animates (see header note: a blocking call can't yield ticks).
function withStaticStatus(label, fn, stream = process.stderr) {
  if (!isInteractive(stream)) {
    stream.write(`  ${label}\n`);
    return fn();
  }
  stream.write(`  ${label}`);
  try {
    return fn();
  } finally {
    stream.write(`\r${' '.repeat(label.length + 2)}\r`);
  }
}

// Runs an ASYNC `task` (a zero-arg function returning a Promise) while
// showing an animated spinner with `label`. Erases the spinner line on
// settle, whether `task` resolves or rejects — the caller's own try/catch
// around the awaited result is untouched (this never swallows an error, it
// only guarantees the spinner line is cleaned up either way).
async function withSpinner(label, task, stream = process.stderr) {
  if (!isInteractive(stream)) {
    stream.write(`  ${label}\n`);
    return task();
  }
  let frame = 0;
  stream.write(`\r  ${FRAMES[0]} ${label}`);
  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    stream.write(`\r  ${FRAMES[frame]} ${label}`);
  }, TICK_MS);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    stream.write(`\r${' '.repeat(label.length + 4)}\r`);
  }
}

const PHASE_MS = 8000;

// Pure: which phase index is active after `elapsedMs`. Advances one step per
// `phaseMs` and CLAMPS on the last phase — it never loops back to phase 0
// (looping would read as "the work restarted"). Exposed for deterministic
// unit tests (no timers needed to verify the rotation schedule).
function phaseAt(phaseCount, elapsedMs, phaseMs = PHASE_MS) {
  if (!(phaseCount > 0)) return 0;
  if (!(elapsedMs > 0) || !(phaseMs > 0)) return 0;
  const i = Math.floor(elapsedMs / phaseMs);
  return i >= phaseCount ? phaseCount - 1 : i;
}

// Runs an ASYNC `task` (zero-arg → Promise) through ONE long, opaque wait
// (e.g. `map`'s ~57s single-shot Pro call) while showing an animated spinner
// whose COPY rotates through `phases` on a timer — time-phased reassurance,
// NOT fake precise progress (we can't read the model's internal state). The
// braille frame ticks at `tickMs`; the copy advances every `phaseMs` and holds
// on the last phase. Non-TTY (piped/redirected/CI): prints phase[0] once as a
// plain line and does NOT rotate or emit `\r` — same posture as withSpinner.
// The line is fully erased on settle (success OR failure); the caller's own
// try/catch around the awaited result is untouched.
async function withPhasedSpinner(phases, task, { stream = process.stderr, phaseMs = PHASE_MS, tickMs = TICK_MS } = {}) {
  const list = (Array.isArray(phases) ? phases : [phases]).filter((s) => typeof s === 'string' && s.length > 0);
  const first = list[0] || '';
  if (!isInteractive(stream)) {
    if (first) stream.write(`  ${first}\n`);
    return task();
  }
  const start = Date.now();
  let frame = 0;
  let maxLen = 0;
  const render = () => {
    const copy = list[phaseAt(list.length, Date.now() - start, phaseMs)] || first;
    const line = `  ${FRAMES[frame]} ${copy}`;
    maxLen = Math.max(maxLen, line.length);
    stream.write(`\r${line.padEnd(maxLen)}`); // padEnd clears a longer previous phase's tail
  };
  render();
  const timer = setInterval(() => { frame = (frame + 1) % FRAMES.length; render(); }, tickMs);
  try {
    return await task();
  } finally {
    clearInterval(timer);
    stream.write(`\r${' '.repeat(maxLen)}\r`);
  }
}

module.exports = { withStaticStatus, withSpinner, withPhasedSpinner, phaseAt, isInteractive };
