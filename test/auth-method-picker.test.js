'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { chooseAuthMethod } = require('../src/auth-method-picker');
const { getCatalog } = require('../src/i18n');
const { needle } = require('../test-fixtures/copy-needle');

// The SHARED CLI method picker (talents-ai-score).

const c = getCatalog('es').login;

class FakeInput extends EventEmitter {
  setRawMode() {}
  resume() {}
  pause() {}
}
const nullOutput = { write() {} };

function keys(input, seq) {
  for (const k of seq) input.emit('data', Buffer.from(k));
}

function makeSharedAsk(lines = []) {
  const queue = [...lines];
  const fn = async () => (queue.length ? queue.shift() : '');
  fn.suspend = () => {};
  fn.resume = () => {};
  fn.close = () => {};
  return fn;
}

test('login flow, TTY + suspend-capable ask: enter on the first item picks email', async () => {
  const input = new FakeInput();
  const ask = makeSharedAsk();
  const p = chooseAuthMethod({ flow: 'login', ask, stdinIsTTY: true, catalog: c, input, output: nullOutput });
  keys(input, ['\r']);
  assert.equal(await p, 'email');
});

test('login flow, TTY + suspend-capable ask: down then enter picks google', async () => {
  const input = new FakeInput();
  const ask = makeSharedAsk();
  const p = chooseAuthMethod({ flow: 'login', ask, stdinIsTTY: true, catalog: c, input, output: nullOutput });
  keys(input, ['\x1b[B', '\r']);
  assert.equal(await p, 'google');
});

test('login flow, TTY numbered fallback: prints heading + both labels, "2" picks google', async () => {
  const chunks = [];
  const output = { write: (s) => chunks.push(String(s)) };
  const ask = async () => '2';
  const method = await chooseAuthMethod({ flow: 'login', ask, stdinIsTTY: true, catalog: c, output });
  assert.equal(method, 'google');
  const printed = chunks.join('');
  assert.ok(printed.includes(needle(c.chooseMethodHeading)));
  assert.ok(printed.includes(needle(c.methodEmail)));
  assert.ok(printed.includes(needle(c.methodGoogle)));
});

test('login flow, non-TTY: returns email immediately, ask never called', async () => {
  let called = false;
  const ask = async () => { called = true; return ''; };
  const method = await chooseAuthMethod({ flow: 'login', ask, stdinIsTTY: false, catalog: c, output: nullOutput });
  assert.equal(method, 'email');
  assert.equal(called, false);
});

test('login flow: esc cancels -> null', async () => {
  const input = new FakeInput();
  const ask = makeSharedAsk();
  const p = chooseAuthMethod({ flow: 'login', ask, stdinIsTTY: true, catalog: c, input, output: nullOutput });
  keys(input, ['\x1b']);
  assert.equal(await p, null);
});

test('register flow, TTY: shows the picker (email + google) — down+enter picks google', async () => {
  const input = new FakeInput();
  const ask = makeSharedAsk();
  const p = chooseAuthMethod({ flow: 'register', ask, stdinIsTTY: true, catalog: c, input, output: nullOutput });
  keys(input, ['\x1b[B', '\r']);
  assert.equal(await p, 'google');
});

test('register flow, non-TTY: returns email (first method), no prompt', async () => {
  let called = false;
  const ask = async () => { called = true; return ''; };
  const method = await chooseAuthMethod({ flow: 'register', ask, stdinIsTTY: false, catalog: c, output: nullOutput });
  assert.equal(method, 'email');
  assert.equal(called, false);
});
