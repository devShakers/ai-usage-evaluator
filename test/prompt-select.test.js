'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { promptSelect, promptMultiSelect } = require('../src/prompt-select');

function mockAsk(answers) {
  const a = answers.slice();
  return async () => (a.length ? a.shift() : '');
}

function fakeTtyInput(keys) {
  const e = new EventEmitter();
  e.setRawMode = () => {};
  e.resume = () => {};
  e.pause = () => {};
  const origOn = e.on.bind(e);
  e.on = (ev, fn) => {
    origOn(ev, fn);
    if (ev === 'data') setImmediate(() => { for (const k of keys) e.emit('data', Buffer.from(k)); });
    return e;
  };
  return e;
}

const ITEMS = ['FREELANCE', 'EMPLOYEE', 'AGENCY', 'POTENTIAL_FREELANCE'];

test('non-TTY fallback: a number selects the item', async () => {
  const r = await promptSelect({ ask: mockAsk(['2']), stdinIsTTY: false, out: () => {}, items: ITEMS });
  assert.equal(r, 'EMPLOYEE');
});

test('non-TTY fallback: a value selects the item; a bad value returns null', async () => {
  assert.equal(await promptSelect({ ask: mockAsk(['agency']), stdinIsTTY: false, out: () => {}, items: ITEMS }), 'AGENCY');
  assert.equal(await promptSelect({ ask: mockAsk(['nope']), stdinIsTTY: false, out: () => {}, items: ITEMS }), null);
});

test('TTY arrow mode: Enter picks the highlighted item, arrows move the cursor', async () => {
  const ask = Object.assign(async () => '', { suspend: () => {}, resume: () => {} });
  const first = await promptSelect({ ask, stdinIsTTY: true, out: () => {}, items: ITEMS, input: fakeTtyInput(['\r']), output: { write: () => {} } });
  assert.equal(first, 'FREELANCE');
  const second = await promptSelect({ ask, stdinIsTTY: true, out: () => {}, items: ITEMS, input: fakeTtyInput(['\x1b[B', '\r']), output: { write: () => {} } });
  assert.equal(second, 'EMPLOYEE');
});

const MODES = ['REMOTE', 'HYBRID', 'IN_PERSON'];

test('promptMultiSelect non-TTY: space/comma separated indices and labels, deduped', async () => {
  assert.deepEqual(await promptMultiSelect({ ask: mockAsk(['1 2']), stdinIsTTY: false, out: () => {}, items: MODES }), ['REMOTE', 'HYBRID']);
  assert.deepEqual(await promptMultiSelect({ ask: mockAsk(['remote, in_person']), stdinIsTTY: false, out: () => {}, items: MODES }), ['REMOTE', 'IN_PERSON']);
  assert.deepEqual(await promptMultiSelect({ ask: mockAsk(['1 1 bogus']), stdinIsTTY: false, out: () => {}, items: MODES }), ['REMOTE']);
  assert.deepEqual(await promptMultiSelect({ ask: mockAsk(['']), stdinIsTTY: false, out: () => {}, items: MODES }), []);
});

test('promptMultiSelect TTY: SPACE marks several, ENTER confirms the array', async () => {
  const ask = Object.assign(async () => '', { suspend: () => {}, resume: () => {} });
  // mark item 0 (REMOTE), move down, mark item 1 (HYBRID), confirm.
  const picked = await promptMultiSelect({
    ask, stdinIsTTY: true, out: () => {}, items: MODES,
    input: fakeTtyInput([' ', '\x1b[B', ' ', '\r']), output: { write: () => {} },
  });
  assert.deepEqual(picked, ['REMOTE', 'HYBRID']);
});
