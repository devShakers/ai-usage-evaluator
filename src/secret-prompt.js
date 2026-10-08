'use strict';

// SECRET PROMPT — reads a secret WITHOUT painting it (issue 102).

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = /[\u0008\u007f]/;

// Reads a secret from a RAW tty.
function readSecretRaw({ input, output, mask = '' } = {}) {
  return new Promise((resolve, reject) => {
    let value = '';
    let done = false;

    const restore = () => {
      if (done) return;
      done = true;
      // Order matters: stop listening BEFORE leaving raw mode, so a keystroke that
      // arrives during teardown is not delivered to a half-restored terminal.
      try { input.removeListener('data', onData); } catch { /* already gone */ }
      if (input.setRawMode) { try { input.setRawMode(false); } catch { /* not a TTY any more */ } }
    };

    function onData(chunk) {
      const s = String(chunk);
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          restore();
          output.write('\n');
          resolve(value);
          return;
        }
        if (ch === CTRL_C || ch === CTRL_D) {
          // Restore FIRST, then report the cancellation: whatever the caller does
          // with it (exit, retry), the terminal is already usable.
          restore();
          output.write('\n');
          resolve(null);
          return;
        }
        if (BACKSPACE.test(ch)) {
          if (value.length) {
            value = value.slice(0, -1);
            // Only erase on screen if something was drawn there.
            if (mask) output.write('\b \b');
          }
          continue;
        }
        // Ignore the rest of the C0 controls (arrows arrive as escape sequences and
        // would otherwise land inside the secret).
        if (ch < ' ') continue;
        value += ch;
        if (mask) output.write(mask);
      }
    }

    try {
      if (input.setRawMode) input.setRawMode(true);
      if (input.resume) input.resume();
      input.on('data', onData);
    } catch (err) {
      restore();
      reject(err);
    }
  });
}

function canPromptSecretly(input) {
  return !!(input && input.isTTY && typeof input.setRawMode === 'function');
}

module.exports = { readSecretRaw, canPromptSecretly };
