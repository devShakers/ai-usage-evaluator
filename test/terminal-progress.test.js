'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { withStaticStatus, withSpinner, withPhasedSpinner, phaseAt, isInteractive } = require('../src/terminal-progress');

/*
 * talents-ai-score: terminal progress feedback for the (now slower) scan +
 * synthesis phases. Fake stream objects below stand in for process.stderr
 * so tests never depend on the real TTY-ness of the test runner's own
 * stderr, and never leave a real interval running past the test.
 */

function makeFakeStream(isTTY) {
  const stream = new EventEmitter();
  stream.isTTY = isTTY;
  stream.written = [];
  stream.write = (s) => {
    stream.written.push(s);
    return true;
  };
  return stream;
}

test('isInteractive: true only when stream.isTTY is truthy', () => {
  assert.equal(isInteractive({ isTTY: true }), true);
  assert.equal(isInteractive({ isTTY: false }), false);
  assert.equal(isInteractive({}), false);
  assert.equal(isInteractive(null), false);
  assert.equal(isInteractive(undefined), false);
});

test('withStaticStatus: non-TTY -> a single plain line, no ANSI/control characters, runs fn and returns its value', () => {
  const stream = makeFakeStream(false);
  const result = withStaticStatus('Scanning...', () => 42, stream);
  assert.equal(result, 42);
  assert.equal(stream.written.length, 1);
  assert.equal(stream.written[0], '  Scanning...\n');
  assert.equal(/\x1b|\r/.test(stream.written.join('')), false);
});

test('withStaticStatus: TTY -> writes the label then erases it (no leftover text), still runs fn synchronously', () => {
  const stream = makeFakeStream(true);
  let ranDuringWrite = false;
  const result = withStaticStatus('Scanning...', () => {
    ranDuringWrite = stream.written.length > 0;
    return 'done';
  }, stream);
  assert.equal(result, 'done');
  assert.equal(ranDuringWrite, true);
  const combined = stream.written.join('');
  assert.match(combined, /Scanning\.\.\./);
  // Last write must be a full erase (only carriage returns and spaces).
  const last = stream.written[stream.written.length - 1];
  assert.match(last, /^\r[ ]+\r$/);
});

test('withStaticStatus: TTY -> erases the status even when fn throws (never leaves a stuck line)', () => {
  const stream = makeFakeStream(true);
  assert.throws(() => withStaticStatus('Scanning...', () => {
    throw new Error('boom');
  }, stream));
  const last = stream.written[stream.written.length - 1];
  assert.match(last, /^\r[ ]+\r$/);
});

test('withSpinner: non-TTY -> a single plain line, no animation frames, awaits and returns the task result', async () => {
  const stream = makeFakeStream(false);
  const result = await withSpinner('Synthesizing...', async () => 'ok', stream);
  assert.equal(result, 'ok');
  assert.equal(stream.written.length, 1);
  assert.equal(stream.written[0], '  Synthesizing...\n');
  assert.equal(/\x1b|\r/.test(stream.written.join('')), false);
});

test('withSpinner: TTY -> animates while the task is pending and erases the line on success', async () => {
  const stream = makeFakeStream(true);
  let resolveTask;
  const task = () => new Promise((resolve) => { resolveTask = resolve; });

  const promise = withSpinner('Synthesizing...', task, stream);
  // Let a few spinner ticks fire while the task is still pending.
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(stream.written.length > 1, 'expected multiple spinner frames while pending');

  resolveTask('synthesis-result');
  const result = await promise;
  assert.equal(result, 'synthesis-result');

  const last = stream.written[stream.written.length - 1];
  assert.match(last, /^\r[ ]+\r$/); // fully erased, nothing left on screen
});

test('withSpinner: TTY -> erases the spinner even when the task rejects, and the rejection still propagates', async () => {
  const stream = makeFakeStream(true);
  await assert.rejects(
    () => withSpinner('Synthesizing...', async () => {
      throw new Error('network down');
    }, stream),
    /network down/,
  );
  const last = stream.written[stream.written.length - 1];
  assert.match(last, /^\r[ ]+\r$/);
});

test('withSpinner/withStaticStatus: default stream (no argument) never throws even outside a real TTY test runner', async () => {
  assert.doesNotThrow(() => withStaticStatus('x', () => 1));
  await assert.doesNotReject(() => withSpinner('x', async () => 1));
});

/* ---------- phaseAt: the pure copy-rotation schedule (no timers) ---------- */

test('phaseAt: advances one step per phaseMs and CLAMPS on the last phase (never loops)', () => {
  const N = 4;
  const P = 1000;
  assert.equal(phaseAt(N, 0, P), 0);      // t=0 → first
  assert.equal(phaseAt(N, 500, P), 0);    // within first window
  assert.equal(phaseAt(N, 1000, P), 1);   // boundary → second
  assert.equal(phaseAt(N, 2500, P), 2);   // third
  assert.equal(phaseAt(N, 3000, P), 3);   // last
  assert.equal(phaseAt(N, 9999, P), 3);   // WAY past → still last (clamped, no wrap to 0)
});

test('phaseAt: defensive edges — no phases, non-positive elapsed/phaseMs → index 0', () => {
  assert.equal(phaseAt(0, 5000, 1000), 0);
  assert.equal(phaseAt(4, 0, 1000), 0);
  assert.equal(phaseAt(4, -5, 1000), 0);
  assert.equal(phaseAt(4, 5000, 0), 0);
  assert.equal(phaseAt(1, 50000, 1000), 0); // single phase → always 0
});

/* ---------- withPhasedSpinner: rendering branches ---------- */

test('withPhasedSpinner: non-TTY -> prints ONLY the first phase as a plain line, no rotation, no ANSI/\\r', async () => {
  const stream = makeFakeStream(false);
  const phases = ['Collecting…', 'Analyzing…', 'Composing…'];
  const result = await withPhasedSpinner(phases, async () => 'done', { stream });
  assert.equal(result, 'done');
  assert.equal(stream.written.length, 1);
  assert.equal(stream.written[0], '  Collecting…\n');
  assert.equal(/\x1b|\r/.test(stream.written.join('')), false);
});

test('withPhasedSpinner: TTY -> animates AND rotates the copy through phases over time, erased on success', async () => {
  const stream = makeFakeStream(true);
  let resolveTask;
  const task = () => new Promise((resolve) => { resolveTask = resolve; });
  const phases = ['PHASE_ONE', 'PHASE_TWO', 'PHASE_THREE'];
  // Tiny phaseMs so the copy advances within the test's real-timer window.
  const promise = withPhasedSpinner(phases, task, { stream, phaseMs: 40, tickMs: 10 });
  await new Promise((r) => setTimeout(r, 130)); // enough real time to cross ≥2 phase windows
  resolveTask('graph');
  const result = await promise;
  assert.equal(result, 'graph');

  const combined = stream.written.join('');
  const seen = phases.filter((p) => combined.includes(p));
  assert.ok(seen.length >= 2, `expected at least 2 distinct phase copies, saw ${seen.length}: ${seen.join(',')}`);
  const last = stream.written[stream.written.length - 1];
  assert.match(last, /^\r[ ]+\r$/); // line fully erased, nothing left on screen
});

test('withPhasedSpinner: TTY -> erases the line even when the task rejects, and the rejection propagates', async () => {
  const stream = makeFakeStream(true);
  await assert.rejects(
    () => withPhasedSpinner(['Analyzing…'], async () => { throw new Error('endpoint down'); }, { stream, phaseMs: 40, tickMs: 10 }),
    /endpoint down/,
  );
  const last = stream.written[stream.written.length - 1];
  assert.match(last, /^\r[ ]+\r$/);
});

test('withPhasedSpinner: accepts a single string phase and default stream without throwing', async () => {
  await assert.doesNotReject(() => withPhasedSpinner('just one', async () => 1));
});
