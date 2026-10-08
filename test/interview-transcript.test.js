'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TranscriptBuffer } = require('../src/interview-transcript');

// A controllable clock so timestamps / timeInCallSecs are deterministic.
function clock(startMs, stepMs) {
  let t = startMs;
  return () => { const v = t; t += stepMs; return v; };
}

test('records agent + user turns in order, with the certs contract shape', () => {
  const base = Date.parse('2026-09-03T10:00:00.000Z');
  const b = new TranscriptBuffer({ now: clock(base, 2000) }); // +2s per turn
  b.recordAgent('Welcome! Tell me about your work.');
  b.recordUser('I build APIs.');
  b.recordAgent('Thanks, all done.');

  const t = b.toTranscripts();
  assert.equal(t.length, 3);
  assert.deepEqual(t.map((x) => x.role), ['AGENT', 'USER', 'AGENT']);
  assert.equal(t[0].message, 'Welcome! Tell me about your work.');
  assert.equal(t[0].timestamp, '2026-09-03T10:00:00.000Z');
  // timeInCallSecs is measured from the FIRST turn -> first is 0, then +2s each.
  assert.deepEqual(t.map((x) => x.timeInCallSecs), [0, 2, 4]);
  for (const turn of t) {
    assert.match(turn.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(Number.isInteger(turn.timeInCallSecs), true);
  }
});

test('drops empty / whitespace-only turns (never emits a malformed row) and trims', () => {
  const b = new TranscriptBuffer({ now: clock(0, 1000) });
  assert.equal(b.recordUser(''), false);
  assert.equal(b.recordUser('   '), false);
  assert.equal(b.recordAgent(null), false);
  assert.equal(b.recordAgent(undefined), false);
  assert.equal(b.recordUser('  hi  '), true);
  const t = b.toTranscripts();
  assert.equal(t.length, 1);
  assert.equal(t[0].message, 'hi');
  assert.equal(b.length, 1);
});

test('an unknown role is rejected', () => {
  const b = new TranscriptBuffer();
  assert.equal(b.record('assistant', 'nope'), false);
  assert.equal(b.record('system', 'nope'), false);
  assert.equal(b.length, 0);
});

test('the clock base is the first NON-EMPTY turn (leading empties do not shift it)', () => {
  const b = new TranscriptBuffer({ now: clock(1000, 5000) });
  b.recordUser('');        // dropped, consumes a clock tick (1000)
  b.recordAgent('first');  // recorded at 6000 -> becomes base, timeInCallSecs 0
  b.recordUser('second');  // 11000 -> 5s
  const t = b.toTranscripts();
  assert.equal(t[0].timeInCallSecs, 0);
  assert.equal(t[1].timeInCallSecs, 5);
});

test('toTranscripts returns a defensive copy', () => {
  const b = new TranscriptBuffer();
  b.recordAgent('x');
  const a = b.toTranscripts();
  a[0].message = 'mutated';
  assert.equal(b.toTranscripts()[0].message, 'x');
});
