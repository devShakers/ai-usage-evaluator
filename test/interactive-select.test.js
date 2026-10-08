'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const {
  decodeKey, applyKey, selectedFrom, runInteractiveMultiSelect, renderLines, wrapDesc,
} = require('../src/interactive-select');

// skill-code-certification, issue 011: zero-dep interactive multi-select.

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

// --- single-select mode (certify agents) -------------------------------------
test('applyKey single: enter picks the highlighted item and finishes', () => {
  let s = { cursor: 0, marked: new Set(), count: 3, done: false, cancelled: false };
  s = applyKey(s, 'down', true); // cursor -> 1
  s = applyKey(s, 'enter', true);
  assert.equal(s.done, true);
  assert.deepEqual([...s.marked], [1]);
});

test('applyKey single: space also picks the highlighted item (radio style)', () => {
  let s = { cursor: 2, marked: new Set(), count: 3, done: false, cancelled: false };
  s = applyKey(s, 'space', true);
  assert.equal(s.done, true);
  assert.deepEqual([...s.marked], [2]);
});

test('applyKey single: "all" is a no-op (no select-all in single mode)', () => {
  let s = { cursor: 0, marked: new Set(), count: 3, done: false, cancelled: false };
  s = applyKey(s, 'all', true);
  assert.equal(s.done, false);
  assert.equal(s.marked.size, 0);
});

// --- descriptionFor (talents-ai-score, dueño 2026-08-11 — `start`'s menu) ----

test('wrapDesc: wraps to width without breaking a single long word', () => {
  assert.deepEqual(wrapDesc('one two three', 100), ['one two three']);
  const wrapped = wrapDesc('a '.repeat(50).trim(), 10);
  assert.ok(wrapped.every((l) => l.length <= 10));
  assert.deepEqual(wrapDesc(''), []);
  // A word longer than the width still gets its own line, never broken.
  assert.deepEqual(wrapDesc('supercalifragilisticexpialidocious', 5), ['supercalifragilisticexpialidocious']);
});

test('renderLines: the description shows ONLY for the item under the cursor, nobody else\'s', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const descriptionFor = (item) => `desc-for-${item.id}`;
  const state = { cursor: 1, marked: new Set(), count: 3, done: false, cancelled: false };
  const lines = renderLines(state, { items, labelFor: (x) => x.id, descriptionFor }).join('\n');
  assert.ok(lines.includes('desc-for-b'), 'the highlighted item\'s description must be shown');
  assert.equal(lines.includes('desc-for-a'), false, 'a non-highlighted item\'s description must not appear');
  assert.equal(lines.includes('desc-for-c'), false, 'a non-highlighted item\'s description must not appear');
});

test('renderLines: moving the cursor swaps WHICH description shows, never shows two at once', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const descriptionFor = (item) => `desc-for-${item.id}`;
  const at0 = renderLines({ cursor: 0, marked: new Set(), count: 2 }, { items, labelFor: (x) => x.id, descriptionFor }).join('\n');
  const at1 = renderLines({ cursor: 1, marked: new Set(), count: 2 }, { items, labelFor: (x) => x.id, descriptionFor }).join('\n');
  assert.ok(at0.includes('desc-for-a') && !at0.includes('desc-for-b'));
  assert.ok(at1.includes('desc-for-b') && !at1.includes('desc-for-a'));
});

function withStdout({ isTTY, noColor }, fn) {
  const realTTY = process.stdout.isTTY;
  const realNoColor = process.env.NO_COLOR;
  process.stdout.isTTY = isTTY;
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
  try {
    return fn();
  } finally {
    process.stdout.isTTY = realTTY;
    if (realNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = realNoColor;
  }
}
const SGR = /\x1b\[[0-9;]*m/;

test('renderLines: header (the picker\'s question) is highlighted bold+colour on a real terminal', () => {
  const items = ['x'];
  const state = { cursor: 0, marked: new Set(), count: 1 };
  const lines = withStdout({ isTTY: true }, () =>
    renderLines(state, { items, labelFor: (x) => x, header: 'What type of entry is this?' }));
  const headerLine = lines[0];
  assert.match(headerLine, SGR, 'must actually carry an SGR code when colour is enabled');
  assert.match(headerLine, /What type of entry is this\?/, 'never rewords the question');
});

test('renderLines: header degrades to PLAIN text under NO_COLOR / a pipe, same gate as everywhere else', () => {
  const items = ['x'];
  const state = { cursor: 0, marked: new Set(), count: 1 };
  const piped = withStdout({ isTTY: false }, () =>
    renderLines(state, { items, labelFor: (x) => x, header: 'What type of entry is this?' }));
  assert.equal(SGR.test(piped[0]), false);
  assert.match(piped[0], /What type of entry is this\?/);

  const noColor = withStdout({ isTTY: true, noColor: '1' }, () =>
    renderLines(state, { items, labelFor: (x) => x, header: 'What type of entry is this?' }));
  assert.equal(SGR.test(noColor[0]), false, 'NO_COLOR wins even on a real terminal');
});

test('renderLines: hint stays its own plain/dim treatment, unchanged — only the header (question) is highlighted', () => {
  const items = ['x'];
  const state = { cursor: 0, marked: new Set(), count: 1 };
  const lines = withStdout({ isTTY: true }, () =>
    renderLines(state, { items, labelFor: (x) => x, header: 'Question?', hint: 'Arrows to move' }));
  assert.match(lines[0], SGR, 'header is styled');
  assert.match(lines[1], SGR, 'hint keeps its own (dim) SGR — this asserts it is NOT the bold/primary question style');
  assert.equal(lines[1].includes('\x1b[1m'), false, 'hint is dim, never bold — that stays the question\'s distinguishing mark');
});

test('renderLines: no descriptionFor passed -> renders byte-identically to before this feature', () => {
  const items = ['x', 'y'];
  const state = { cursor: 0, marked: new Set(), count: 2 };
  const withNone = renderLines(state, { items, labelFor: (x) => x }).join('\n');
  const withNull = renderLines(state, { items, labelFor: (x) => x, descriptionFor: null }).join('\n');
  assert.equal(withNone, withNull);
  assert.equal(withNone.includes('desc-for'), false);
});

test('renderLines: descriptionFor returning null/empty for the highlighted item adds no extra lines', () => {
  const items = ['x', 'y'];
  const state = { cursor: 0, marked: new Set(), count: 2 };
  const withDesc = renderLines(state, { items, labelFor: (x) => x, descriptionFor: () => 'text' }).join('\n');
  const withoutDesc = renderLines(state, { items, labelFor: (x) => x, descriptionFor: () => null }).join('\n');
  assert.notEqual(withDesc, withoutDesc);
  assert.equal(renderLines(state, { items, labelFor: (x) => x }).join('\n'), withoutDesc);
});

test('driver: the description follows the cursor across a real down/up sequence', async () => {
  const input = new FakeInput();
  const writes = [];
  const capturingOutput = { write: (s) => writes.push(s) };
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const p = runInteractiveMultiSelect({
    items, input, output: capturingOutput, labelFor: (x) => x.id,
    descriptionFor: (item) => `desc-for-${item.id}`,
    single: true,
  });
  keys(input, ['\x1b[B', '\x1b[B', '\r']); // down, down, enter -> lands on 'c'
  await p;
  assert.ok(writes[0].includes('desc-for-a'));
  assert.ok(writes[writes.length - 1].includes('desc-for-c'));
});
