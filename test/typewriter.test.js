'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { typeOut, charsPerTick, TICK_MS, MAX_TOTAL_MS } = require('../src/typewriter');

// talents-ai-score (camino A): the progressive reveal of an interview question that has ALREADY arrived complete.

function makeFakeStream(isTTY) {
  const written = [];
  return { isTTY, written, write: (s) => { written.push(String(s)); return true; } };
}

// Records the delays without waiting for them.
function makeFakeSleep() {
  const delays = [];
  const sleep = async (ms) => { delays.push(ms); };
  sleep.delays = delays;
  return sleep;
}

test('typeOut: non-TTY -> exactly ONE write, byte-identical, with no ANSI or carriage return added', async () => {
  const stream = makeFakeStream(false);
  const sleep = makeFakeSleep();
  await typeOut('Question 1 about purpose_fit?', { stream, sleep });
  assert.deepEqual(stream.written, ['Question 1 about purpose_fit?']);
  // Nothing was scheduled: a piped run pays no animation at all.
  assert.equal(sleep.delays.length, 0);
  assert.equal(/\x1b|\r/.test(stream.written.join('')), false);
});

test('typeOut: TTY -> reveals in several writes whose concatenation is byte-identical to the input', async () => {
  const stream = makeFakeStream(true);
  const sleep = makeFakeSleep();
  const text = 'How did you bound the agent scope, and what did you discard?';
  await typeOut(text, { stream, tickMs: 1, maxTotalMs: 60, sleep });
  assert.ok(stream.written.length > 1, 'expected a progressive reveal, not a single write');
  assert.equal(stream.written.join(''), text);
});

test('typeOut: the reveal is bounded by TIME, not by length — a long text just moves faster', async () => {
  const short = makeFakeStream(true);
  const long = makeFakeStream(true);
  const maxTicks = Math.floor(MAX_TOTAL_MS / TICK_MS);

  await typeOut('x'.repeat(40), { stream: short, sleep: makeFakeSleep() });
  await typeOut('x'.repeat(4000), { stream: long, sleep: makeFakeSleep() });

  // Both finish within the same tick budget: 100x the text is NOT 100x the wait,
  // which is the whole reason the speed is derived instead of fixed.
  assert.ok(short.written.length <= maxTicks, `short: ${short.written.length} > ${maxTicks}`);
  assert.ok(long.written.length <= maxTicks, `long: ${long.written.length} > ${maxTicks}`);
  assert.equal(long.written.join(''), 'x'.repeat(4000));
});

test('typeOut: TTY -> sleeps BETWEEN writes only, never after the last one', async () => {
  const stream = makeFakeStream(true);
  const sleep = makeFakeSleep();
  await typeOut('abcdef', { stream, tickMs: 7, maxTotalMs: 42, sleep });
  assert.equal(stream.written.length, 6);
  assert.equal(sleep.delays.length, 5, 'the reveal ends when the text is on screen, not one idle tick later');
  assert.deepEqual(new Set(sleep.delays), new Set([7]));
});

test('typeOut: slices by CODE POINT — a surrogate pair is never cut in half', async () => {
  const stream = makeFakeStream(true);
  const text = '🚀🛰️🔭 scope?';
  await typeOut(text, { stream, tickMs: 1, maxTotalMs: 100, sleep: makeFakeSleep() });
  const joined = stream.written.join('');
  assert.equal(joined, text);
  // No lone surrogate escaped into an individual write (that renders as a box).
  for (const chunk of stream.written) {
    assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(chunk), false);
  }
});

test('typeOut: empty, non-string or absent stream -> writes nothing and never throws', async () => {
  const stream = makeFakeStream(true);
  await typeOut('', { stream });
  await typeOut(null, { stream });
  await typeOut(undefined, { stream });
  await typeOut(42, { stream });
  assert.deepEqual(stream.written, []);
  await assert.doesNotReject(() => typeOut('text', { stream: null }));
  await assert.doesNotReject(() => typeOut('text', { stream: { isTTY: true } }));
});

test('typeOut: a zero or negative time budget degrades to one write, never a division by zero', async () => {
  const stream = makeFakeStream(true);
  const sleep = makeFakeSleep();
  await typeOut('abcdef', { stream, tickMs: 0, maxTotalMs: 0, sleep });
  assert.equal(stream.written.join(''), 'abcdef');
  assert.equal(sleep.delays.length, 0);
});

/* ---------- charsPerTick: the pure speed schedule (no timers) ---------- */

test('charsPerTick: derives speed from length against the tick budget, minimum one', () => {
  assert.equal(charsPerTick(100, 50), 2);
  assert.equal(charsPerTick(101, 50), 3);   // rounds UP, so it never overruns the budget
  assert.equal(charsPerTick(10, 50), 1);    // short text: one per tick, never zero
  assert.equal(charsPerTick(4000, 43), 94);
});

test('charsPerTick: defensive edges — no text or no budget', () => {
  assert.equal(charsPerTick(0, 50), 0);
  assert.equal(charsPerTick(-1, 50), 0);
  assert.equal(charsPerTick(100, 0), 100);  // no budget -> everything at once
  assert.equal(charsPerTick(100, -3), 100);
});
