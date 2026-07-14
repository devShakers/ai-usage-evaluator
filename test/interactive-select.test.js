'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const {
  decodeKey, applyKey, selectedFrom, runInteractiveMultiSelect,
} = require('../src/interactive-select');

/*
 * skill-code-certification, issue 011: zero-dep interactive multi-select.
 * Pure reducer + key decoder are unit-tested directly; the raw-stdin driver
 * is exercised with a fake input stream (no real TTY needed).
 */

// --- decodeKey ---------------------------------------------------------------

test('decodeKey: arrows, vim keys, space, enter, all, cancel', () => {
  assert.equal(decodeKey('\x1b[A'), 'up');
  assert.equal(decodeKey('\x1b[B'), 'down');
  assert.equal(decodeKey('k'), 'up');
  assert.equal(decodeKey('j'), 'down');
  assert.equal(decodeKey(' '), 'space');
  assert.equal(decodeKey('\r'), 'enter');
  assert.equal(decodeKey('\n'), 'enter');
  assert.equal(decodeKey('a'), 'all');
  assert.equal(decodeKey('\x03'), 'cancel'); // ctrl-c
  assert.equal(decodeKey('\x1b'), 'cancel'); // esc
  assert.equal(decodeKey('z'), null);
});

// --- applyKey (pure reducer) -------------------------------------------------

function initial(count) {
  return { cursor: 0, marked: new Set(), count, done: false, cancelled: false };
}

test('applyKey: down/up wrap around', () => {
  let s = initial(3);
  s = applyKey(s, 'down'); assert.equal(s.cursor, 1);
  s = applyKey(s, 'down'); assert.equal(s.cursor, 2);
  s = applyKey(s, 'down'); assert.equal(s.cursor, 0); // wrap
  s = applyKey(s, 'up'); assert.equal(s.cursor, 2);   // wrap back
});

test('applyKey: space toggles the item under the cursor', () => {
  let s = initial(3);
  s = applyKey(s, 'space'); assert.ok(s.marked.has(0));
  s = applyKey(s, 'space'); assert.equal(s.marked.has(0), false);
});

test('applyKey: "all" marks all, then clears all', () => {
  let s = initial(3);
  s = applyKey(s, 'all'); assert.equal(s.marked.size, 3);
  s = applyKey(s, 'all'); assert.equal(s.marked.size, 0);
});

test('applyKey: enter sets done, cancel sets cancelled; does not mutate input', () => {
  const s0 = initial(2);
  const s1 = applyKey(s0, 'enter');
  assert.equal(s1.done, true);
  assert.equal(s0.done, false, 'reducer must not mutate the input state');
  assert.equal(applyKey(s0, 'cancel').cancelled, true);
});

test('selectedFrom: returns items in list order for the marked indices', () => {
  const items = ['a', 'b', 'c'];
  const s = { marked: new Set([2, 0]) };
  assert.deepEqual(selectedFrom(s, items), ['a', 'c']);
});

// --- driver (fake input stream) ----------------------------------------------

class FakeInput extends EventEmitter {
  setRawMode() {}
  resume() {}
  pause() {}
}
const nullOutput = { write() {} };

function keys(input, seq) {
  for (const k of seq) input.emit('data', Buffer.from(k));
}

test('driver: down, space, down, space, enter -> selects items 1 and 2', async () => {
  const input = new FakeInput();
  const items = [{ id: 0 }, { id: 1 }, { id: 2 }];
  const p = runInteractiveMultiSelect({ items, input, output: nullOutput, labelFor: (x) => `#${x.id}` });
  keys(input, ['\x1b[B', ' ', '\x1b[B', ' ', '\r']);
  const selected = await p;
  assert.deepEqual(selected.map((x) => x.id), [1, 2]);
});

test('driver: "a" then enter selects all', async () => {
  const input = new FakeInput();
  const items = ['x', 'y'];
  const p = runInteractiveMultiSelect({ items, input, output: nullOutput });
  keys(input, ['a', '\r']);
  assert.deepEqual(await p, ['x', 'y']);
});

test('driver: esc cancels -> resolves null (nothing sent)', async () => {
  const input = new FakeInput();
  const p = runInteractiveMultiSelect({ items: ['x', 'y'], input, output: nullOutput });
  keys(input, ['\x1b']);
  assert.equal(await p, null);
});

test('driver: enter with nothing marked -> empty array (caller treats as none)', async () => {
  const input = new FakeInput();
  const p = runInteractiveMultiSelect({ items: ['x'], input, output: nullOutput });
  keys(input, ['\r']);
  assert.deepEqual(await p, []);
});
