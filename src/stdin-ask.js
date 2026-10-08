'use strict';

const readline = require('readline');
const { readSecretRaw, canPromptSecretly } = require('./secret-prompt');

// `ask(question) => Promise<string>` factory for real stdin, used by bin/report.js to drive src/consent-flow.js's interactive disclosure.

function createLineQueueAsk(writeQuestion) {
  const queue = [];
  let resolveNext = null;
  let ended = false;

  function pushLine(line) {
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve(line);
    } else {
      queue.push(line);
    }
  }

  // Signals the stream has ended (EOF) with nothing further to give.
  function markEnded() {
    ended = true;
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve('');
    }
  }

  // DELIBERATE EXCEPTION to this file's own rule ("answers arriving BEFORE ask() is called are still delivered in order" — see the test file's own name for that behaviour).
  function drain() {
    queue.length = 0;
  }

  function ask(question) {
    writeQuestion(question);
    return new Promise((resolve) => {
      if (queue.length > 0) resolve(queue.shift());
      else if (ended) resolve('');
      else resolveNext = resolve;
    });
  }

  return { ask, pushLine, markEnded, drain };
}

// `onInterrupt` (optional): a Ctrl-C (SIGINT) handler for a TTY.
function createStdinAsk({ onInterrupt } = {}) {
  // `rl` is re-createable (issue 102), not a `const`.
  let rl = null;
  let ended = false;
  let suspending = false;
  let currentPrompt = '';

  const { ask, pushLine, markEnded, drain } = createLineQueueAsk((question) => {
    // Long-answer wrap bug (skill-code-certification, certify agents): in a TTY, `readline` runs in terminal mode and redraws the current line on every keystroke (wrap, cursor).
    const text = `  ${question} `;
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline >= 0) {
      process.stdout.write(text.slice(0, lastNewline + 1));
      currentPrompt = text.slice(lastNewline + 1);
    } else {
      currentPrompt = text;
    }
    if (rl) { rl.setPrompt(currentPrompt); rl.prompt(); }
  });
  function attach() {
    if (rl) return;
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // The issue-088 fix, re-applied on every attach: readline must own the prompt
    // it repaints, and a new interface does not know the old one.
    if (currentPrompt) rl.setPrompt(currentPrompt);
    rl.on('line', pushLine);
    rl.on('close', () => {
      rl = null;
      // A `suspend()` close is intentional (the secret prompt); a real EOF is not.
      if (!suspending) { ended = true; markEnded(); }
    });
    rl.on('SIGINT', onInterrupt || (() => {
      process.stdout.write('\n');
      if (rl) rl.close();
      process.exit(130);
    }));
  }

  attach();

  // Releases stdin so the raw-mode secret reader can own it, WITHOUT ending the
  // FIFO queue: buffered lines survive. Mirrors `repl-stdin.js#suspend`.
  function suspend() {
    if (!rl) return;
    suspending = true;
    const r = rl;
    rl = null;
    r.close();
    suspending = false;
  }
  // SECRETS DO NOT ECHO (issue 102).
  ask.secret = async (question) => {
    if (!canPromptSecretly(process.stdin)) return ask(question);
    process.stdout.write(`  ${question} `);
    suspend();
    try {
      const value = await readSecretRaw({ input: process.stdin, output: process.stdout });
      return value == null ? '' : value;
    } finally {
      // In a `finally` because a terminal left without echo is worse than the bug
      // this replaces: re-attaching restores readline's cooked mode and its prompt.
      attach();
    }
  };

  ask.close = () => {
    ended = true;
    if (rl) { const r = rl; rl = null; r.close(); }
    markEnded();
  };
  ask.suspend = suspend;
  ask.resume = attach;
  ask.isEnded = () => ended;
  // See createLineQueueAsk's `drain` docblock: discards whatever is queued and unread, without ending the stream.
  ask.drain = drain;
  return ask;
}

module.exports = { createStdinAsk, createLineQueueAsk };
