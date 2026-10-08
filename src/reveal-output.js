'use strict';

// Shared, reusable output reveal for the NEW talent commands: buffer the human
// render and type it out with the report's typewriter pacing (bounded by
// `maxTotalMs`). ONE place, so every new command animates consistently.
//
// The LOADER stays live: on a TTY `io.withProgress` animates on stderr during the
// fetch; only the post-fetch RENDER is buffered here and revealed afterwards.
//
// GATE (reused from the typewriter, not reinvented): no animation in `--json`
// (machine output), in an interactive setter (live prompts), off a TTY, or under
// NO_ANIMATION — in those cases writes are passed straight through.

const { typeOut, revealEnabled } = require('./typewriter');

// Returns `{ write, finish }`. When animating, `write` buffers and `finish`
// types the buffer out; otherwise `write` passes through and `finish` is a no-op.
function makeRevealSink({ json = false, interactive = false, out = null, stream = process.stdout, env = process.env, sleep } = {}) {
  const passthrough = out || ((s) => { if (stream && typeof stream.write === 'function') stream.write(s); });
  const animating = !json && !interactive && !out && revealEnabled({ stream, env });
  if (!animating) return { write: passthrough, finish: async () => {} };
  let buf = '';
  return {
    write: (s) => { buf += s; },
    finish: async () => { if (buf) await typeOut(buf, { stream, ...(sleep ? { sleep } : {}) }); },
  };
}

module.exports = { makeRevealSink };
