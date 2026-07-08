'use strict';

const readline = require('readline');

/*
 * `ask(question) => Promise<string>` factory for real stdin, used by
 * bin/report.js to drive src/consent-flow.js's interactive disclosure.
 *
 * Bug this fixes (talents-ai-score, ADR-007, issue 006): a naive
 * `rl.question()` call per question is unreliable when stdin is piped
 * (non-TTY, e.g. `printf "s\ntalent@example.com\n" | ai-footprint`).
 * `readline.Interface` emits a `'line'` event for EVERY line as soon as
 * it's readable, whether or not a `.question()` is currently pending —
 * `.question()` only listens `once('line', cb)` while it's outstanding.
 * On piped input, both lines can arrive before the second `.question()`
 * call is even made, so the second line's `'line'` event fires with no
 * listener attached and is silently lost — the flow hangs waiting for an
 * answer that already came and went.
 *
 * Fix: a single, permanent `'line'` listener feeds a FIFO queue,
 * decoupled from when `ask()` happens to be called. `createLineQueueAsk`
 * is the pure logic (no real readline), exported for unit testing that
 * race directly; `createStdinAsk` wires it to a real stdin interface.
 */

function createLineQueueAsk(writeQuestion) {
  const queue = [];
  let resolveNext = null;

  function pushLine(line) {
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve(line);
    } else {
      queue.push(line);
    }
  }

  function ask(question) {
    writeQuestion(question);
    return new Promise((resolve) => {
      if (queue.length > 0) resolve(queue.shift());
      else resolveNext = resolve;
    });
  }

  return { ask, pushLine };
}

function createStdinAsk() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const { ask, pushLine } = createLineQueueAsk((question) => {
    process.stdout.write(`  ${question} `);
  });
  rl.on('line', pushLine);
  ask.close = () => rl.close();
  return ask;
}

module.exports = { createStdinAsk, createLineQueueAsk };
