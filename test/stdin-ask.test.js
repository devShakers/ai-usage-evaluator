'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLineQueueAsk } = require('../src/stdin-ask');

/*
 * Regression test (talents-ai-score, ADR-007, issue 006): a naive
 * `rl.question()`-per-call implementation loses input on piped (non-TTY)
 * stdin when multiple lines arrive before the second question is asked —
 * this was caught by manual end-to-end testing of bin/report.js's
 * disclosure flow (unit tests alone, using an injected `ask`, didn't
 * exercise the real stdin wiring). `createLineQueueAsk` is the queueing
 * logic extracted so this race is testable without a real TTY/readline.
 */

test('createLineQueueAsk: answers arriving BEFORE ask() is called are still delivered in order (the bug this fixes)', async () => {
  const questions = [];
  const { ask, pushLine } = createLineQueueAsk((q) => questions.push(q));

  // Simulate both lines of piped input arriving immediately, before the
  // second `ask()` call even happens — the exact race that broke the
  // naive `rl.question()`-per-call implementation.
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

// talents-ai-score, DX fix: previously, if stdin ended (EOF) with no more
// lines ever arriving — non-interactive input with nothing to give, e.g.
// piped from an already-closed source or `< /dev/null` — a pending ask()
// call hung FOREVER (no 'line' event ever fires again after the stream
// closes). From the talent's point of view this looked exactly like a
// frozen CLI, indistinguishable from a crash. markEnded() fixes this.

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
