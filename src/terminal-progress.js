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

module.exports = { withStaticStatus, withSpinner, isInteractive };
