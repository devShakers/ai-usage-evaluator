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
