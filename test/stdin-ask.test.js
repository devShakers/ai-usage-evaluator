'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLineQueueAsk } = require('../src/stdin-ask');

test('createLineQueueAsk: answers arriving BEFORE ask() is called are still delivered in order (the bug this fixes)', async () => {
  const questions = [];
  const { ask, pushLine } = createLineQueueAsk((q) => questions.push(q));

  // Simulate both lines of piped input arriving immediately, before the second `ask()` call even happens — the exact race that broke the naive `rl.question()`-per-call implementation.
  pushLine('yes');
  pushLine('talent@example.com');

  const a1 = await ask('Q1?');
  const a2 = await ask('Q2?');

  assert.equal(a1, 'yes');
  assert.equal(a2, 'talent@example.com');
  assert.deepEqual(questions, ['Q1?', 'Q2?']);
});

test('createLineQueueAsk: answers arriving AFTER ask() is called also work (normal interactive case)', async () => {
  const { ask, pushLine } = createLineQueueAsk(() => {});

  const p1 = ask('Q1?');
  pushLine('no');
  assert.equal(await p1, 'no');
});

test('createLineQueueAsk: interleaved arrival (some before, some after) still resolves in FIFO order', async () => {
  const { ask, pushLine } = createLineQueueAsk(() => {});

  pushLine('first');
  const a1 = await ask('Q1?');
  assert.equal(a1, 'first');

  const p2 = ask('Q2?');
  pushLine('second');
  assert.equal(await p2, 'second');
});

test('createLineQueueAsk: markEnded() resolves a PENDING ask() with \'\' instead of hanging forever (the hang this fixes)', async () => {
  const { ask, markEnded } = createLineQueueAsk(() => {});

  const pending = ask('Q1?');
  markEnded(); // simulates stdin closing with nothing more to give
  const answer = await pending;
  assert.equal(answer, '');
});

test('createLineQueueAsk: after markEnded(), any FURTHER ask() also resolves immediately with \'\' (never hangs)', async () => {
  const { ask, markEnded } = createLineQueueAsk(() => {});
  markEnded();
  assert.equal(await ask('Q1?'), '');
  assert.equal(await ask('Q2?'), '');
});

test('createLineQueueAsk: markEnded() does NOT discard an answer that already arrived and is still queued', async () => {
  const { ask, pushLine, markEnded } = createLineQueueAsk(() => {});
  pushLine('already-here');
  markEnded();
  assert.equal(await ask('Q1?'), 'already-here'); // queued answer still wins
  assert.equal(await ask('Q2?'), ''); // queue exhausted, stream ended -> ''
});

test('createLineQueueAsk: drain() discards whatever is queued and unread — the picker-residual-Enter fix', async () => {
  const { ask, pushLine, drain } = createLineQueueAsk(() => {});
  // Simulates the stray leftover line landing in the queue before the
  // consent question is even shown.
  pushLine('');
  drain();
  // The real answer, typed AFTER seeing the question, is what resolves —
  // never the stale one that was just discarded.
  const pending = ask('Consent?');
  pushLine('y');
  assert.equal(await pending, 'y');
});

test('createLineQueueAsk: drain() does NOT end the stream — a further ask() still waits for a fresh line normally', async () => {
  const { ask, pushLine, drain } = createLineQueueAsk(() => {});
  pushLine('stale');
  drain();
  const pending = ask('Q?');
  let settled = false;
  pending.then(() => { settled = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, 'drain() must not resolve/end anything by itself — it only clears the backlog');
  pushLine('fresh');
  assert.equal(await pending, 'fresh');
});

test('createLineQueueAsk: drain() on an empty queue is a no-op (never throws, never affects a pending ask())', async () => {
  const { ask, pushLine, drain } = createLineQueueAsk(() => {});
  const pending = ask('Q?');
  drain(); // nothing queued; must not resolve the pending ask()
  pushLine('answer');
  assert.equal(await pending, 'answer');
});
