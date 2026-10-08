'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');

const {
  revealText, splitSections, revealEnabled,
  REVEAL_TOTAL_MS, REVEAL_MIN_STEP_MS, REVEAL_MAX_STEP_MS,
} = require('../src/typewriter');
const { renderTerminal } = require('../src/render-terminal');
const { parseArgs } = require('../src/cli-args');

// Issue 103 — the result used to land in a single write.

function fakeStream(isTTY) {
  const written = [];
  return { isTTY, written, write: (s) => { written.push(String(s)); return true; } };
}
const noSleep = () => { const f = async (ms) => { f.delays.push(ms); }; f.delays = []; return f; };

/* ---------------- the partition ---------------- */

test('103: splitSections is a PARTITION — the concatenation is byte-identical', () => {
  const cases = [
    '', 'one line', 'a\n\nb', 'a\n\n\nb\n', '  h\n\n  x\n  y\n\n  z',
    'trailing\n\n', '\n\nleading', 'no blanks at all\njust lines\n',
  ];
  for (const input of cases) {
    assert.equal(splitSections(input).join(''), input, `partition broken for ${JSON.stringify(input)}`);
  }
});

test('103: the copyable block is never split — a rule toggles a HOLD', () => {
  // The roadmap's implementation prompt sits between two horizontal rules and its line breaks ARE content (issue 087).
  const rule = '  ' + '─'.repeat(46);
  const text = ['  HEAD', '', '  body', '', rule, '  prompt line 1', '', '  prompt line 2', rule, '', '  TAIL'].join('\n');
  const sections = splitSections(text);
  assert.equal(sections.join(''), text);
  const withRule = sections.filter((s) => s.includes('─'.repeat(20)));
  assert.equal(withRule.length, 1, 'the ruled region must be a single chunk');
  assert.match(withRule[0], /prompt line 1[\s\S]*prompt line 2/, 'both prompt lines stay together');
});

test('103: a real rendered report splits into sections, not into lines', () => {
  const report = {
    schemaVersion: 1, generatedAt: '2026-08-03T00:00:00.000Z', anonId: 'a1b2c3d4e5f6',
    platform: 'darwin', scope: 'project', environment: { editorsInstalled: [] },
    summary: { totalDetected: 1 },
    tools: [{ id: 'claude-code', name: 'Claude Code', detected: true, signalCount: 1, depth: {} }],
    agents: [], agentCounts: { agents: 0 }, technologies: ['React'],
    mcp: { servers: [] }, memory: {}, automations: {}, browserTools: {},
  };
  const maturity = {
    level: 1, key: 'exploring', name: 'x', emoji: 'x', score: 30, next: 'x',
    tier: 2, tierKey: 'T2', tierName: 'x', setupLevel: { key: 'S1', code: 'S1', rank: 1 },
  };
  const out = renderTerminal(report, maturity, 'es', { showRoadmap: true });
  const sections = splitSections(out);
  assert.equal(sections.join(''), out, 'the partition must hold for real output too');
  assert.ok(sections.length >= 4, `expected several sections, got ${sections.length}`);
  // Section-level, not line-level: far fewer chunks than lines.
  assert.ok(sections.length < out.split('\n').length / 3,
    `too many chunks (${sections.length}) for ${out.split('\n').length} lines — this is a line animation`);
});

/* ---------------- the gate ---------------- */

test('103: the gate is the SAME shape as the colour one — env present = off, non-TTY = off', () => {
  assert.equal(revealEnabled({ stream: { isTTY: true }, env: {} }), true);
  assert.equal(revealEnabled({ stream: { isTTY: false }, env: {} }), false, 'a pipe never animates');
  assert.equal(revealEnabled({ stream: { isTTY: true }, env: { NO_ANIMATION: '1' } }), false);
  assert.equal(revealEnabled({ stream: { isTTY: true }, env: { NO_ANIMATION: '0' } }), false,
    'presence is the signal, like NO_COLOR — the value is irrelevant');
  assert.equal(revealEnabled({ stream: { isTTY: true }, env: { NO_ANIMATION: '' } }), true,
    'empty means absent, so a wrapper can neutralise an inherited value');
  assert.equal(revealEnabled({ stream: { isTTY: true }, env: {}, animate: false }), false,
    'the explicit flag wins over both');
});

test('103: the report parser accepts --no-animation', () => {
  assert.equal(parseArgs(['--no-animation']).noAnimation, true);
  assert.equal(parseArgs([]).noAnimation, false);
  // And the flag does not disturb its neighbours.
  const opts = parseArgs(['--json', '--roadmap', '--no-animation']);
  assert.equal(opts.json, true);
  assert.equal(opts.roadmap, true);
});

/* ---------------- the writes ---------------- */

test('103: non-TTY is ONE write with zero timers and zero byte change', async () => {
  const stream = fakeStream(false);
  const sleep = noSleep();
  const text = 'a\n\nb\n\nc';
  await revealText(text, { stream, env: {}, sleep });
  assert.deepEqual(stream.written, [text], 'a pipe must get the output in one write');
  assert.equal(sleep.delays.length, 0, 'no timers on a pipe');
});

test('103: on a TTY it writes section by section, and the concatenation is the input', async () => {
  const stream = fakeStream(true);
  const sleep = noSleep();
  const text = 'one\n\ntwo\n\nthree\n\nfour';
  await revealText(text, { stream, env: {}, sleep });
  assert.ok(stream.written.length > 1, 'expected a progressive reveal');
  assert.equal(stream.written.join(''), text, 'the reveal changed the bytes');
  // Sleeps BETWEEN sections only, never after the last one.
  assert.equal(sleep.delays.length, stream.written.length - 1);
});

test('103: the budget is TOTAL, so more sections do not mean more waiting', async () => {
  const few = fakeStream(true); const sFew = noSleep();
  const many = fakeStream(true); const sMany = noSleep();
  await revealText('a\n\nb\n\nc', { stream: few, env: {}, sleep: sFew });
  await revealText(Array.from({ length: 40 }, (_, i) => `s${i}`).join('\n\n'), { stream: many, env: {}, sleep: sMany });
  const total = (s) => s.delays.reduce((a, b) => a + b, 0);
  // A report with 13x the sections must not cost 13x the time: the per-step delay
  // shrinks against the shared budget, floored so it stays perceptible.
  assert.ok(total(sMany) <= REVEAL_TOTAL_MS + REVEAL_MIN_STEP_MS * 2,
    `40 sections cost ${total(sMany)}ms, over the ${REVEAL_TOTAL_MS}ms budget`);
  assert.ok(sMany.delays.every((d) => d >= REVEAL_MIN_STEP_MS && d <= REVEAL_MAX_STEP_MS));
  assert.ok(total(sFew) <= REVEAL_TOTAL_MS);
});

test('103: with the flag or the env var, a TTY gets ONE write — identical bytes', async () => {
  const text = 'one\n\ntwo\n\nthree';
  for (const opts of [{ animate: false, env: {} }, { env: { NO_ANIMATION: '1' } }]) {
    const stream = fakeStream(true);
    const sleep = noSleep();
    await revealText(text, { stream, sleep, ...opts });
    assert.deepEqual(stream.written, [text], `disabled reveal must be a single write: ${JSON.stringify(opts)}`);
    assert.equal(sleep.delays.length, 0);
  }
});

test('103: a single-section output is written whole rather than "revealed"', async () => {
  const stream = fakeStream(true);
  const sleep = noSleep();
  await revealText('no blank lines here', { stream, env: {}, sleep });
  assert.equal(stream.written.length, 1, 'nothing to stagger, so no stagger');
  assert.equal(sleep.delays.length, 0);
});

test('103: empty input and a broken stream are no-ops, never throws', async () => {
  const stream = fakeStream(true);
  await revealText('', { stream, env: {} });
  await revealText(null, { stream, env: {} });
  assert.deepEqual(stream.written, []);
  await assert.doesNotReject(() => revealText('x', { stream: null, env: {} }));
  await assert.doesNotReject(() => revealText('x', { stream: {}, env: {} }));
});

test('103: the reveal writes to the stream it is GIVEN, not to process.stdout', async () => {
  // The three call sites pass their own stream (`ctx.outStream` in the interview),
  // which is what keeps the tests and the piped paths honest.
  const s = new PassThrough();
  const chunks = [];
  s.on('data', (b) => chunks.push(String(b)));
  s.isTTY = true;
  await revealText('a\n\nb', { stream: s, env: {}, sleep: async () => {} });
  await new Promise((r) => setImmediate(r));
  assert.equal(chunks.join(''), 'a\n\nb');
});
