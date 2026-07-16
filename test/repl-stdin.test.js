'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('stream');

const { createReplStdin } = require('../src/repl-stdin');

// A throwaway writable so readline has an output sink in tests.
function sink() {
  const s = new PassThrough();
  s.resume();
  return s;
}

test('shared reader returns piped lines in FIFO order', async () => {
  const input = new PassThrough();
  const ask = createReplStdin({ input, output: sink() });

  input.write('footprint\n');
  input.write('s\n');
  input.write('talent@example.com\n');

  assert.strictEqual(await ask(''), 'footprint');
  assert.strictEqual(await ask(''), 's');
  assert.strictEqual(await ask(''), 'talent@example.com');

  ask.close();
});

test('ask() called before the line arrives still resolves with it (no lost first char)', async () => {
  const input = new PassThrough();
  const ask = createReplStdin({ input, output: sink() });

  // Ask FIRST, write AFTER — the promise must resolve with the eventual line.
  const pending = ask('');
  setImmediate(() => input.write('help\n'));
  assert.strictEqual(await pending, 'help');

  ask.close();
});

test('EOF (input end) resolves pending/next ask with "" and flips isEnded()', async () => {
  const input = new PassThrough();
  const ask = createReplStdin({ input, output: sink() });

  input.write('exit\n');
  assert.strictEqual(await ask(''), 'exit');
  assert.strictEqual(ask.isEnded(), false);

  input.end(); // EOF
  assert.strictEqual(await ask(''), '');
  assert.strictEqual(ask.isEnded(), true);
});

test('suspend()/resume() keeps queued lines and keeps reading afterwards', async () => {
  const input = new PassThrough();
  const ask = createReplStdin({ input, output: sink() });

  input.write('a\n');
  input.write('b\n');
  assert.strictEqual(await ask(''), 'a');

  // Suspend must NOT end the queue: 'b' already buffered survives.
  ask.suspend();
  assert.strictEqual(ask.isEnded(), false, 'suspend is not EOF');
  assert.strictEqual(await ask(''), 'b');

  // Resume and keep reading new input.
  ask.resume();
  input.write('c\n');
  assert.strictEqual(await ask(''), 'c');

  ask.close();
});

test('close() is idempotent and marks ended', async () => {
  const input = new PassThrough();
  const ask = createReplStdin({ input, output: sink() });
  ask.close();
  ask.close(); // no throw
  assert.strictEqual(ask.isEnded(), true);
  assert.strictEqual(await ask(''), '');
});
