'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { confirmDisclaimerAcceptance, isAffirmative, isNegative } = require('../src/certify-disclaimer');
const { getCatalog } = require('../src/i18n');
const { needle } = require('../test-fixtures/copy-needle');

// skill-code-certification, ADR-001: the legal disclaimer gate.

const en = getCatalog('en');

// Arbitrary alternate disclosure text for the `text` override tests (the old
// retired skill-interview disclosure that used to play this role is gone).
const OVERRIDE_TEXT = 'OVERRIDE DISCLOSURE — a different text shown in place of the ADR-001 default';

// Captures process.stdout.write for the duration of `fn`.
async function captureStdout(fn) {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    const value = await fn();
    return { value, out };
  } finally {
    process.stdout.write = original;
  }
}

// Queue-backed injectable ask.
function askFrom(answers) {
  const q = [...answers];
  return async () => (q.length ? q.shift() : '');
}

test('isAffirmative / isNegative recognize es+en yes/no', () => {
  for (const y of ['y', 'yes', 's', 'si', 'sí', 'Y']) assert.equal(isAffirmative(y), true);
  for (const n of ['n', 'no', 'N']) assert.equal(isNegative(n), true);
  assert.equal(isAffirmative('maybe'), false);
  assert.equal(isNegative('maybe'), false);
});

test('confirmDisclaimerAcceptance: --accept-disclaimer -> accepted (reason flag), disclaimer STILL shown', async () => {
  const { value, out } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom([]), catalog: en, preAccepted: true, stdinIsTTY: false }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'flag' });
  assert.match(out, /LEGAL DISCLAIMER/);
});

test('confirmDisclaimerAcceptance: interactive yes -> accepted', async () => {
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom(['y']), catalog: en, stdinIsTTY: true }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'interactive' });
});

test('confirmDisclaimerAcceptance: interactive no -> declined, nothing sent', async () => {
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom(['n']), catalog: en, stdinIsTTY: true }),
  );
  assert.deepEqual(value, { accepted: false, reason: 'declined' });
});

test('confirmDisclaimerAcceptance: invalid then yes -> accepted (re-prompts)', async () => {
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom(['what', 'y']), catalog: en, stdinIsTTY: true }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'interactive' });
});

test('confirmDisclaimerAcceptance: no recognizable answer within attempts -> no-answer, not accepted', async () => {
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask: askFrom(['x', 'x', 'x', 'x', 'x']), catalog: en, stdinIsTTY: true }),
  );
  assert.deepEqual(value, { accepted: false, reason: 'no-answer' });
});

test('confirmDisclaimerAcceptance: non-TTY without --accept-disclaimer -> non-interactive abort, ask never called', async () => {
  let called = false;
  const ask = async () => { called = true; return 'y'; };
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask, catalog: en, preAccepted: false, stdinIsTTY: false }),
  );
  assert.deepEqual(value, { accepted: false, reason: 'non-interactive' });
  assert.equal(called, false);
});

function withStdoutTTY(isTTY, fn) {
  const real = process.stdout.isTTY;
  process.stdout.isTTY = isTTY;
  return Promise.resolve().then(fn).finally(() => { process.stdout.isTTY = real; });
}

test('confirmDisclaimerAcceptance: a real TTY frames the disclaimer with a heading + rule, wording intact', async () => {
  const { out } = await withStdoutTTY(true, () =>
    captureStdout(() => confirmDisclaimerAcceptance({ ask: askFrom([]), catalog: en, preAccepted: true, stdinIsTTY: false })),
  );
  assert.match(out, /\x1b\[[0-9;]*m/, 'a real TTY must colour the notice');
  assert.ok(out.includes(needle(en.legalNotice.label, 'en.legalNotice.label')));
  assert.ok(out.includes(needle(en.certify.disclaimer, 'en.certify.disclaimer')), 'the exact legal wording must survive the styling');
});

test('confirmDisclaimerAcceptance: non-TTY stays byte-identical to before this feature (no heading, no rule, no ANSI)', async () => {
  const { out } = await withStdoutTTY(false, () =>
    captureStdout(() => confirmDisclaimerAcceptance({ ask: askFrom([]), catalog: en, preAccepted: true, stdinIsTTY: false })),
  );
  assert.equal(/\x1b\[/.test(out), false);
  assert.ok(out.includes(`\n  ${en.certify.disclaimer}\n`));
});

test('confirmDisclaimerAcceptance: `text` override shows a DIFFERENT disclosure, but every other string is still catalog.certify\'s generic set', async () => {
  const { value, out } = await captureStdout(() =>
    confirmDisclaimerAcceptance({
      ask: askFrom(['y']),
      catalog: en,
      stdinIsTTY: true,
      text: OVERRIDE_TEXT,
    }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'interactive' });
  assert.ok(out.includes(needle(OVERRIDE_TEXT, 'override-text')), 'shows the OVERRIDE text');
  assert.equal(out.includes(en.certify.disclaimer), false, 'does not ALSO show the default ADR-001 text');
});

test('confirmDisclaimerAcceptance: `text` override + decline -> the generic certify.disclaimerDeclined is printed (the override text has no dedicated declined copy)', async () => {
  const { value, out } = await captureStdout(() =>
    confirmDisclaimerAcceptance({
      ask: askFrom(['n']),
      catalog: en,
      stdinIsTTY: true,
      text: OVERRIDE_TEXT,
    }),
  );
  assert.deepEqual(value, { accepted: false, reason: 'declined' });
  assert.ok(out.includes(needle(en.certify.disclaimerDeclined, 'certify.disclaimerDeclined')));
});

test('confirmDisclaimerAcceptance: `text` override with no `drainBeforeAsk` -> a QUEUED answer still wins (default, unaffected — only the NEW call site opts in)', async () => {
  const ask = askFrom(['y']);
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask, catalog: en, stdinIsTTY: true, text: OVERRIDE_TEXT }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'interactive' });
});

test('confirmDisclaimerAcceptance: `drainBeforeAsk: true` calls ask.drain() exactly once, before the first ask(), only when the reader implements it', async () => {
  const calls = [];
  const ask = async () => { calls.push('ask'); return 'y'; };
  ask.drain = () => { calls.push('drain'); };
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask, catalog: en, stdinIsTTY: true, text: OVERRIDE_TEXT, drainBeforeAsk: true }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'interactive' });
  assert.deepEqual(calls, ['drain', 'ask'], 'drain runs BEFORE the question is asked, exactly once');
});

test('confirmDisclaimerAcceptance: `drainBeforeAsk: true` with an ask that has no .drain() -> never throws, behaves exactly as without it', async () => {
  const ask = askFrom(['y']); // no .drain method at all
  const { value } = await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask, catalog: en, stdinIsTTY: true, text: OVERRIDE_TEXT, drainBeforeAsk: true }),
  );
  assert.deepEqual(value, { accepted: true, reason: 'interactive' });
});

test('confirmDisclaimerAcceptance: `drainBeforeAsk: true` is a no-op on preAccepted/non-interactive paths — drain() is never called when ask() itself is never called', async () => {
  const calls = [];
  const ask = async () => { calls.push('ask'); return 'y'; };
  ask.drain = () => { calls.push('drain'); };

  await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask, catalog: en, preAccepted: true, stdinIsTTY: false, text: OVERRIDE_TEXT, drainBeforeAsk: true }),
  );
  assert.deepEqual(calls, [], 'pre-accepted via flag: neither drain() nor ask() runs');

  calls.length = 0;
  await captureStdout(() =>
    confirmDisclaimerAcceptance({ ask, catalog: en, preAccepted: false, stdinIsTTY: false, text: OVERRIDE_TEXT, drainBeforeAsk: true }),
  );
  assert.deepEqual(calls, [], 'non-interactive, no flag: neither drain() nor ask() runs');
});
