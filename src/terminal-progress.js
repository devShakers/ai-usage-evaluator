'use strict';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const TICK_MS = 80;

function isInteractive(stream) {
  return !!(stream && stream.isTTY);
}

const ERASE_LINE = '\r\x1b[2K\r';

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
    stream.write(ERASE_LINE);
  }
}

// Runs an ASYNC `task` (a zero-arg function returning a Promise) while showing an animated spinner with `label`.
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
    stream.write(ERASE_LINE);
  }
}

// Manual spinner for a wait whose END isn't a single awaitable (e.g. streaming:
// spin until the FIRST token arrives). Returns an idempotent `stop()` that
// clears the line. On a non-TTY it prints the label once and `stop()` is a no-op.
function startSpinner(label, stream = process.stderr) {
  if (!isInteractive(stream)) {
    stream.write(`  ${label}\n`);
    return () => {};
  }
  let frame = 0;
  stream.write(`\r  ${FRAMES[0]} ${label}`);
  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length;
    stream.write(`\r  ${FRAMES[frame]} ${label}`);
  }, TICK_MS);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stream.write(ERASE_LINE);
  };
}

const PHASE_MS = 8000;

// Pure: which phase index is active after `elapsedMs`.
function phaseAt(phaseCount, elapsedMs, phaseMs = PHASE_MS) {
  if (!(phaseCount > 0)) return 0;
  if (!(elapsedMs > 0) || !(phaseMs > 0)) return 0;
  const i = Math.floor(elapsedMs / phaseMs);
  return i >= phaseCount ? phaseCount - 1 : i;
}

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
    stream.write(ERASE_LINE);
  }
}

module.exports = { withStaticStatus, withSpinner, startSpinner, withPhasedSpinner, phaseAt, isInteractive };
