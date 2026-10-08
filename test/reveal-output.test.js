'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeRevealSink } = require('../src/reveal-output');

function fakeStream(isTTY) {
  const writes = [];
  return { isTTY, write: (s) => writes.push(s), writes };
}
const instantSleep = () => Promise.resolve();

test('makeRevealSink: on a TTY it buffers then types the buffer out (paced, multiple writes)', async () => {
  const stream = fakeStream(true);
  const sink = makeRevealSink({ json: false, interactive: false, out: null, stream, env: {}, sleep: instantSleep });
  sink.write('  Line one\n');
  sink.write('  Line two — a bit longer so the reveal steps more than once\n');
  assert.equal(stream.writes.length, 0); // nothing until finish (buffered)
  await sink.finish();
  const joined = stream.writes.join('');
  assert.match(joined, /Line one/);
  assert.match(joined, /Line two/);
  assert.ok(stream.writes.length > 1, 'revealed in more than one write (typewriter pacing)');
});

test('makeRevealSink: --json passes through immediately, no buffering, no animation', async () => {
  const stream = fakeStream(true);
  const sink = makeRevealSink({ json: true, stream, env: {}, sleep: instantSleep });
  sink.write('{"ok":true}');
  assert.deepEqual(stream.writes, ['{"ok":true}']); // written straight through
  await sink.finish();
  assert.deepEqual(stream.writes, ['{"ok":true}']); // finish adds nothing
});

test('makeRevealSink: interactive setter passes through (live prompts, no buffering)', async () => {
  const stream = fakeStream(true);
  const sink = makeRevealSink({ json: false, interactive: true, stream, env: {}, sleep: instantSleep });
  sink.write('prompt> ');
  assert.deepEqual(stream.writes, ['prompt> ']);
  await sink.finish();
});

test('makeRevealSink: off-TTY / NO_ANIMATION -> plain pass-through (single write, no pacing)', async () => {
  const pipe = fakeStream(false);
  const s1 = makeRevealSink({ stream: pipe, env: {}, sleep: instantSleep });
  s1.write('a'); s1.write('b');
  await s1.finish();
  assert.deepEqual(pipe.writes, ['a', 'b']); // passthrough, not revealed

  const tty = fakeStream(true);
  const s2 = makeRevealSink({ stream: tty, env: { NO_ANIMATION: '1' }, sleep: instantSleep });
  s2.write('x');
  await s2.finish();
  assert.deepEqual(tty.writes, ['x']); // NO_ANIMATION disables the reveal
});

test('makeRevealSink: an injected out (redirect/test) always passes through', async () => {
  const out = [];
  const sink = makeRevealSink({ json: false, out: (s) => out.push(s), stream: fakeStream(true), env: {}, sleep: instantSleep });
  sink.write('hello');
  await sink.finish();
  assert.deepEqual(out, ['hello']);
});
