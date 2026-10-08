'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestPricingRate, fetchPricingRate } = require('../src/rate-client');
const { runRate, parseAmount, buildBody } = require('../src/rate-flow');
const { makeRateTools } = require('../src/mcp-rate-tools');
const { getCatalog } = require('../src/i18n');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function fakeIo() {
  const lines = [];
  return { lines, section: (t) => lines.push(`SECTION ${t}`), notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, "")), error: (t) => lines.push(`ERROR ${t}`), warn: () => {}, success: (t) => lines.push(`OK ${t}`), withProgress: (_l, task) => task() };
}

const PRICING = { id: 'r1', fullTimeProjectSelected: true, fullTimeProjectPrice: { amount: 5000, currency: 'EUR' }, partTimeProjectSelected: true, partTimeProjectPrice: { amount: 3000, currency: 'EUR' } };

test('requestPricingRate: parses TalentPricingDto + Bearer; 404 -> not-found', async () => {
  let auth;
  const { server, base } = await startServer((req, res) => { auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: PRICING })); });
  try {
    const r = await requestPricingRate({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/talents/me/work-details/pricing-rate` });
    assert.equal(r.ok, true);
    assert.equal(r.pricing.fullTimePrice.amount, 5000);
    assert.equal(r.pricing.partTimeSelected, true);
    assert.equal(auth, 'Bearer hub-jwt');
  } finally { server.close(); }
  const { server: s2, base: b2 } = await startServer((req, res) => { res.writeHead(404); res.end('{}'); });
  try {
    assert.equal((await requestPricingRate({ hubAccessToken: 't' }, { endpoint: `${b2}/p` })).reason, 'not-found');
  } finally { s2.close(); }
});

test('fetchPricingRate: reuses getPricingRateEndpoint', async () => {
  const none = await fetchPricingRate({ getPricingRateEndpoint: () => null }, { hubAccessToken: 't' });
  assert.equal(none.reason, 'no-endpoint');
});

test('runRate: renders full/part-time (view-only), no register hint', async () => {
  const io = fakeIo();
  await runRate({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchPricingRate: async () => ({ ok: true, pricing: { fullTimeSelected: true, fullTimePrice: { amount: 5000, currency: 'EUR' }, partTimeSelected: true, partTimePrice: { amount: 3000, currency: 'EUR' } } }) } });
  const out = io.lines.join('\n');
  assert.match(out, /Full-time project: 5000 EUR/);
  assert.match(out, /Part-time project: 3000 EUR/);
  assert.doesNotMatch(out, /register/); // the confusing register hint is gone
});

// A scripted io for the interactive --set flow.
function setIo(answers, confirmValue) {
  const lines = [];
  const q = [...answers];
  return {
    lines,
    section: (t) => lines.push(`SECTION ${t}`),
    notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, '')),
    error: (t) => lines.push(`ERROR ${t}`),
    warn: () => {},
    success: (t) => lines.push(`OK ${t}`),
    withProgress: (_l, task) => task(),
    ask: async () => (q.length ? q.shift() : ''),
    confirm: async () => confirmValue,
  };
}

const CURRENT = { fullTimeSelected: true, fullTimePrice: { amount: 5000, currency: 'EUR' }, partTimeSelected: false, partTimePrice: null };

test('parseAmount: numbers only, 0..999999.99, comma allowed; else null', () => {
  assert.equal(parseAmount('4000'), 4000);
  assert.equal(parseAmount('40,5'), 40.5);
  assert.equal(parseAmount('-1'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('1000000'), null);
});

test('buildBody: sets chosen modality, preserves the untouched one', () => {
  const body = buildBody(CURRENT, 'part', 60, 'EUR');
  assert.equal(body.fullTimeProjectSelected, true);
  assert.deepEqual(body.fullTimeProjectPrice, { amount: 5000, currency: 'EUR' }); // preserved
  assert.equal(body.partTimeProjectSelected, true);
  assert.deepEqual(body.partTimeProjectPrice, { amount: 60, currency: 'EUR' });
});

// Discrete choices (modality, currency) go through an arrow-key picker; the test
// stubs deps.promptSelect with a queue. Amount stays a free-text io.ask answer.
function setDeps(picks, over = {}) {
  const q = [...picks];
  return {
    fetchPricingRate: async () => ({ ok: true, pricing: CURRENT }),
    savePricingRate: async () => ({ ok: true }),
    promptSelect: async () => (q.length ? q.shift() : null),
    ...over,
  };
}

test('runRate --set: pickers for modality+currency, confirms, PUTs merged body', async () => {
  let sent;
  const io = setIo(['6500'], true); // amount only (modality/currency are pickers)
  const r = await runRate({
    io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'),
    opts: { set: true, stdinIsTTY: true },
    deps: setDeps([{ label: 'full-time', value: 'full' }, 'EUR'], { savePricingRate: async ({ pricing }) => { sent = pricing; return { ok: true }; } }),
  });
  assert.equal(r.ok, true);
  assert.equal(sent.fullTimeProjectPrice.amount, 6500);
  assert.equal(sent.fullTimeProjectPrice.currency, 'EUR');
  assert.deepEqual(sent.partTimeProjectPrice, null); // untouched modality preserved
  assert.match(io.lines.join('\n'), /full-time rate updated: 6500 EUR/);
});

test('runRate --set: declining confirmation does NOT write', async () => {
  let called = false;
  const io = setIo(['80'], false);
  const r = await runRate({
    io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'),
    opts: { set: true, stdinIsTTY: true },
    deps: setDeps([{ label: 'part-time', value: 'part' }, 'USD'], { savePricingRate: async () => { called = true; return { ok: true }; } }),
  });
  assert.equal(r.cancelled, true);
  assert.equal(called, false);
  assert.match(io.lines.join('\n'), /Cancelled/);
});

test('runRate --set: bad amount aborts; cancelling a picker cancels', async () => {
  const noWrite = { savePricingRate: async () => { throw new Error('must not write'); } };
  const rAmt = await runRate({ io: setIo(['abc'], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([{ label: 'full-time', value: 'full' }, 'EUR'], noWrite) });
  assert.equal(rAmt.reason, 'bad-amount');
  const rCancel = await runRate({ io: setIo([], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([null], noWrite) }); // picker esc -> null
  assert.equal(rCancel.cancelled, true);
});

test('runRate --set: non-interactive is refused (never prompts)', async () => {
  const r = await runRate({ io: setIo([], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: false }, deps: setDeps([]) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'non-interactive');
});

test('runRate --set: PUT failure surfaces setFailed', async () => {
  const io = setIo(['6500'], true);
  const r = await runRate({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([{ label: 'full-time', value: 'full' }, 'EUR'], { savePricingRate: async () => ({ ok: false, reason: 'http-500' }) }) });
  assert.equal(r.ok, false);
  assert.match(io.lines.join('\n'), /ERROR .*http-500/);
});

test('runRate: not-found reason -> notFound copy; --json', async () => {
  const io = fakeIo();
  const r = await runRate({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchPricingRate: async () => ({ ok: false, reason: 'not-found' }) } });
  assert.equal(r.ok, false);
  assert.match(io.lines.join('\n'), /not set your rate yet/);
  let raw = '';
  await runRate({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { json: true }, deps: { fetchPricingRate: async () => ({ ok: true, pricing: { fullTimeSelected: true, fullTimePrice: { amount: 5000, currency: 'EUR' } } }) } });
  assert.equal(JSON.parse(raw).pricing.fullTimePrice.amount, 5000);
});

test('get_rate tool: session-gated + read', async () => {
  const [tool] = makeRateTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchPricingRate: async () => ({ ok: true, pricing: { fullTimeSelected: true, fullTimePrice: { amount: 5000, currency: 'EUR' } } }) });
  assert.equal(tool.name, 'get_rate');
  assert.match(tool.description, /partTimePrice is the hourly rate.*fullTimePrice the annual target/);
  assert.doesNotMatch(tool.description, /per-project/);
  assert.equal((await tool.handler({})).pricing.fullTimePrice.amount, 5000);
  const [gated] = makeRateTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({}), /no active Shakers session/);
});
