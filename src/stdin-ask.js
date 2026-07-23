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
 *
 * talents-ai-score, DX fix: a SECOND, previously-invisible bug lived here —
 * when stdin is non-interactive and ends with NO more lines ever coming
 * (e.g. piped from an already-closed source, or `< /dev/null`), a pending
 * `ask()` call's Promise never resolved: `rl`'s `'line'` event simply never
 * fires again after the stream ends, so `await ask(...)` hung FOREVER. From
 * the talent's point of view this looked exactly like "the CLI froze after
 * showing the report" — indistinguishable from a crash, and much worse
 * than a silent skip. `markEnded` (wired to `rl`'s `'close'` event, which
 * fires when the underlying stream ends) resolves any pending `ask()` with
 * `''` instead — never a valid yes/no/email, so the EXISTING validation in
 * src/consent-flow.js already treats it as "no answer obtained" and prints
 * `notObtained`, exhausting gracefully instead of hanging.
 */

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
  // Resolves any PENDING ask() with '' rather than leaving it hanging; any
  // ask() call made AFTER this also resolves immediately with '' (there's
  // nothing left to wait for).
  function markEnded() {
    ended = true;
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve('');
    }
  }

  function ask(question) {
    writeQuestion(question);
    return new Promise((resolve) => {
      if (queue.length > 0) resolve(queue.shift());
      else if (ended) resolve('');
      else resolveNext = resolve;
    });
  }

  return { ask, pushLine, markEnded };
}

// `onInterrupt` (optional): a Ctrl-C (SIGINT) handler for a TTY. Registering a
// 'SIGINT' listener on the readline is what stops Node's default hard-kill and
// lets us exit cleanly. This ask drives the consent / email / OTP prompts; if a
// Talent aborts there, we exit WITHOUT a stack trace. No partial state is left
// behind by construction: nothing is persisted until the consent decision
// reaches a terminal state (decline, or grant + verified email — see
// src/consent-flow.js), which is strictly AFTER any prompt this handler could
// interrupt. Defaults to a clean exit(130) (the conventional SIGINT code).
function createStdinAsk({ onInterrupt } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const { ask, pushLine, markEnded } = createLineQueueAsk((question) => {
    // Long-answer wrap bug (skill-code-certification, certify agents): in a TTY,
    // `readline` runs in terminal mode and redraws the current line on every
    // keystroke (wrap, cursor). It computes that redraw against ITS OWN internal
    // prompt — which stayed `''` while we wrote the visible prompt by hand with
    // `process.stdout.write`. So when an answer wrapped past the terminal width,
    // `_refreshLine` redrew from column 0 (prompt width 0) instead of after the
    // indented `  > `, leaving a duplicated/misaligned line. Piped (non-TTY)
    // input never triggered it because terminal mode is off there — no redraw.
    //
    // Fix: hand the FINAL (editable) line to readline as its real prompt via
    // setPrompt/prompt, so its wrap/cursor math uses the correct column. Any
    // preceding header lines (the cyan question text, blank lines) are written
    // directly — they're static and sit ABOVE the editable line, so readline's
    // single-line prompt keeps a clean, ANSI-free width and never redraws them.
    const text = `  ${question} `;
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline >= 0) {
      process.stdout.write(text.slice(0, lastNewline + 1));
      rl.setPrompt(text.slice(lastNewline + 1));
    } else {
      rl.setPrompt(text);
    }
    rl.prompt();
  });
  rl.on('line', pushLine);
  rl.on('close', markEnded);
  rl.on('SIGINT', onInterrupt || (() => {
    process.stdout.write('\n');
    rl.close();
    process.exit(130);
  }));
  ask.close = () => rl.close();
  return ask;
}

module.exports = { createStdinAsk, createLineQueueAsk };
