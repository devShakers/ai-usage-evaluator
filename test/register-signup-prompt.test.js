'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeIo } = require('../bin/register');
const { getCatalog } = require('../src/i18n');

function mockAsk(answers, secrets = []) {
  const a = answers.slice();
  const s = secrets.slice();
  const ask = async () => (a.length ? a.shift() : '');
  ask.secret = async () => (s.length ? s.shift() : '');
  return ask;
}

function ioWith(ask) {
  const out = [];
  const io = makeIo({ ask, lang: 'en', out: (line) => out.push(line), acceptDisclaimer: false, stdinIsTTY: false });
  return { io, out };
}

const c = getCatalog('en').onboarding;

test('askSignUp: no longer asks freelanceType (asked once, later, via work situation)', async () => {
  const ask = mockAsk(['Ada', 'Lovelace', 'a@b.com', 'n'], ['pw12345678', 'pw12345678']);
  const { io } = ioWith(ask);
  const fields = await io.askSignUp(c);
  assert.equal(fields.freelanceType, undefined);
  assert.equal(fields.name, 'Ada');
  assert.equal(fields.password, 'pw12345678');
});

test('askGoogleSignUp: asks nothing (freelanceType derived later from work situation)', async () => {
  const ask = mockAsk([]);
  const { io } = ioWith(ask);
  const g = await io.askGoogleSignUp(c);
  assert.deepEqual(g, {});
});

test('askWorkSituation (ADR-036): FREELANCE skips participation and opinion, still asks motivation', async () => {
  const ask = mockAsk(['FREELANCE', 'HIGHER_RATE']);
  const { io } = ioWith(ask);
  const w = await io.askWorkSituation(c);
  assert.equal(w.situation, 'FREELANCE');
  assert.equal(w.participation, undefined);
  assert.equal(w.opinion, undefined);
  assert.equal(w.changeMotivators, 'HIGHER_RATE');
});

test('askWorkSituation (ADR-036): EMPLOYED asks participation and opinion; NOT_INTERESTED skips motivation', async () => {
  const ask = mockAsk(['EMPLOYED', 'FULL_TIME', 'NOT_INTERESTED']);
  const { io } = ioWith(ask);
  const w = await io.askWorkSituation(c);
  assert.equal(w.situation, 'EMPLOYED');
  assert.equal(w.participation, 'FULL_TIME');
  assert.equal(w.opinion, 'NOT_INTERESTED');
  assert.equal(w.changeMotivators, undefined);
});

test('askLanguages (ADR-036): collects rows until declining to add another', async () => {
  const ask = mockAsk(['es', 'NATIVE', 'y', 'en', 'ADVANCED', 'n']);
  const { io } = ioWith(ask);
  const rows = await io.askLanguages(c);
  assert.deepEqual(rows, [{ language: 'es', level: 'NATIVE' }, { language: 'en', level: 'ADVANCED' }]);
});

test('askPricing (non-TTY fallback): standard price always asked (currency by number), part-time declined', async () => {
  const ask = mockAsk(['2', '5000', 'n']);
  const { io } = ioWith(ask);
  const p = await io.askPricing(c);
  assert.equal(p.fullTimeSelected, true);
  assert.equal(p.fullTimeCurrency, 'EUR');
  assert.equal(p.fullTimeAmount, '5000');
  assert.equal(p.partTimeSelected, false);
});

test('askPricing (non-TTY fallback): both modalities, currency can be given by value', async () => {
  const ask = mockAsk(['EUR', '4000', 'y', 'GBP', '3000']);
  const { io } = ioWith(ask);
  const p = await io.askPricing(c);
  assert.equal(p.fullTimeSelected, true);
  assert.equal(p.fullTimeCurrency, 'EUR');
  assert.equal(p.fullTimeAmount, '4000');
  assert.equal(p.partTimeSelected, true);
  assert.equal(p.partTimeCurrency, 'GBP');
  assert.equal(p.partTimeAmount, '3000');
});

test('askPricing (TTY): an invalid amount re-asks instead of aborting', async () => {
  const out = [];
  const ask = mockAsk(['2', '60.000', '60,000', '60000', 'n']);
  const io = makeIo({ ask, lang: 'en', out: (line) => out.push(line), acceptDisclaimer: false, stdinIsTTY: true });
  const p = await io.askPricing(c);
  assert.equal(p.fullTimeAmount, '60000', 're-asks until a valid amount');
  assert.ok(out.filter((l) => l.includes(c.pricingAmountInvalid)).length >= 2, 'warned on each invalid try');
});

test('interviewLoop (non-TTY): plain output, no animation/spinner, completes without hanging', async () => {
  const out = [];
  const ask = mockAsk(['my answer']);
  const io = makeIo({ ask, lang: 'en', out: (line) => out.push(line), acceptDisclaimer: false, stdinIsTTY: false });
  const r = await io.interviewLoop({
    open: async () => ({ ok: true, greeting: 'Hi, I am Alma' }),
    turn: async () => ({ ok: true, response: 'Thanks, that is all!', ended: true }),
  });
  const joined = out.join('');
  assert.equal(r.ok, true);
  assert.ok(joined.includes('Hi, I am Alma'));
  assert.ok(joined.includes('Question 1'));
  assert.ok(joined.includes('Thanks, that is all!'));
  assert.ok(!/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(joined), 'no spinner frames in the captured output');
});

test('interviewLoop: a failed start returns ok:false and does not loop', async () => {
  const out = [];
  const io = makeIo({ ask: mockAsk([]), lang: 'en', out: (line) => out.push(line), acceptDisclaimer: false, stdinIsTTY: false });
  const r = await io.interviewLoop({ open: async () => ({ ok: false, reason: 'no-endpoint' }), turn: async () => ({ ok: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-endpoint');
});

test('askSignUp: a mismatched password confirmation re-asks before accepting', async () => {
  const ask = mockAsk(['Ada', 'Lovelace', 'a@b.com', 'n', '1'], ['first-typo', 'second-typo', 'pw12345678', 'pw12345678']);
  const { io, out } = ioWith(ask);
  const fields = await io.askSignUp(c);
  assert.equal(fields.password, 'pw12345678');
  assert.ok(out.some((l) => l.includes(c.passwordMismatch)));
});
