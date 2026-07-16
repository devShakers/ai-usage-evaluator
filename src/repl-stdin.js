'use strict';

const readline = require('readline');
const { createLineQueueAsk } = require('./stdin-ask');

/*
 * Shared stdin reader for the branded REPL (ADR-014). THE fix for the
 * nested-stdin problem.
 *
 * Why a single shared reader (and not "close the REPL's readline, let the
 * command open its own"): with PIPED input the whole script arrives as one
 * chunk, e.g. `printf 'footprint\ns\ntalent@x.com\n123456\nexit\n'`. A
 * `readline.Interface` emits a `'line'` event for EVERY complete line in that
 * chunk, synchronously, the moment it's readable — it does NOT stop after the
 * one line the REPL wanted. So if the REPL read `footprint` off its own
 * readline and then closed it to let the command open a second readline, the
 * lines `s`, `talent@x.com`, `123456` would already have been emitted to the
 * REPL's dead 'line' listener and lost — the command's fresh readline would
 * get nothing and hang. THE only robust design is ONE reader whose lines are
 * decoupled from consumption via a FIFO queue (src/stdin-ask.js's
 * createLineQueueAsk), shared by BOTH the REPL prompt loop AND the command
 * running inside it. Every line lands in the same queue; whoever asks next
 * pulls the next line. No second readline over process.stdin ever exists, so
 * nothing is dropped and the first character is never eaten.
 *
 * The command (bin/report.js / bin/certify.js) receives this `ask` injected
 * and NEVER closes it — the REPL owns its lifecycle.
 *
 * suspend()/resume(): the interactive multi-select (src/interactive-select.js,
 * certify only, TTY only) takes over RAW stdin via `data` events, which can't
 * coexist with a cooked-mode readline. certify releases the shared reader
 * around that select; suspend() detaches the readline WITHOUT ending the FIFO
 * queue (buffered lines survive), resume() re-attaches. On a pipe the select
 * branch is never reached (non-TTY falls back to --all/--skills), so this only
 * matters on a real TTY.
 */

function createReplStdin({ input = process.stdin, output = process.stdout, onInterrupt = null } = {}) {
  // One FIFO queue, independent of the readline lifecycle, so suspend/resume
  // never drops buffered lines.
  const { ask: baseAsk, pushLine, markEnded } = createLineQueueAsk((question) => {
    // Commands pass their prompt text here (mirrors src/stdin-ask.js's format);
    // the REPL prints its own coloured prompt and asks with '' (no double).
    if (question) output.write(`  ${question} `);
  });

  let rl = null;
  let ended = false;
  let suspending = false;

  function attach() {
    if (rl) return;
    rl = readline.createInterface({ input, output });
    rl.on('line', pushLine);
    rl.on('close', () => {
      rl = null;
      // A suspend() close is intentional (raw-mode select) — do NOT end the
      // queue. A real EOF (piped input exhausted, Ctrl-D on a TTY) does.
      if (!suspending) {
        ended = true;
        markEnded();
      }
    });
    if (onInterrupt) rl.on('SIGINT', onInterrupt); // Ctrl-C on a TTY -> clean exit
  }

  attach();

  const ask = (question) => baseAsk(question);

  // Release the readline so a command can drive raw stdin (interactive
  // multi-select). Buffered lines stay in the FIFO queue.
  ask.suspend = () => {
    if (!rl) return;
    suspending = true;
    const r = rl;
    rl = null;
    r.close();
    suspending = false;
  };
  ask.resume = () => attach();

  // Full teardown (REPL exit). Idempotent.
  ask.close = () => {
    if (rl) {
      const r = rl;
      rl = null;
      r.close();
    }
    ended = true;
    markEnded();
  };

  // Lets the REPL loop tell a real EOF ('' + ended) from an empty line on a
  // TTY ('' + not ended -> just re-prompt).
  ask.isEnded = () => ended;

  return ask;
}

module.exports = { createReplStdin };
