'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  requestCode,
  verifyCode,
  classifyVerifyReason,
  runEmailVerification,
} = require('../src/email-verification');
const { getCatalog } = require('../src/i18n');

/*
 * skill-code-certification / ADR-006: the email-ownership OTP client + the
 * interactive wait-mode loop. The client follows the DISCRIMINATED-result
 * resilience shape (like certify-client.js — inform, never silently succeed);
 * the loop is driven by an injected `ask` and injected requestCode/verifyCode
 * so it never touches the network or a real TTY.
 */

const catalogEs = getCatalog('es');

/* ---------- a tiny configurable stub server for the client tests ---------- */

function startStub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch { /* leave null */ }
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const urlFor = (server, path) => `http://127.0.0.1:${server.address().port}${path}`;
const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

/* ---------- requestCode ---------- */

test('requestCode: no url -> { ok:false, reason:"no-endpoint" }', async () => {
  assert.deepEqual(await requestCode({ email: 'a@b.com' }, { url: null }), { ok: false, reason: 'no-endpoint' });
});

test('requestCode: 2xx -> { ok:true } and posts the email', async () => {
  let received = null;
  const server = await startStub((req, res, body) => { received = body; json(res, 200, { sent: true }); });
  try {
    const r = await requestCode({ email: 'talent@example.com' }, { url: urlFor(server, '/request') });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(received, { email: 'talent@example.com' });
  } finally {
    server.close();
  }
});

test('requestCode: non-2xx -> { ok:false, reason:"http-<status>" }', async () => {
  const server = await startStub((req, res) => json(res, 500, { error: 'boom' }));
  try {
    const r = await requestCode({ email: 'a@b.com' }, { url: urlFor(server, '/request') });
    assert.deepEqual(r, { ok: false, reason: 'http-500' });
  } finally {
    server.close();
  }
});

test('requestCode: connection refused -> { ok:false, reason:"network-error" }', async () => {
  // Nothing listening on this port.
  const r = await requestCode({ email: 'a@b.com' }, { url: 'http://127.0.0.1:1/request' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'network-error');
});

/* ---------- verifyCode ---------- */

test('verifyCode: 2xx { verified:true } -> { ok:true, verified:true }', async () => {
  let received = null;
  const server = await startStub((req, res, body) => { received = body; json(res, 200, { verified: true }); });
  try {
    const r = await verifyCode({ email: 'a@b.com', code: '123456' }, { url: urlFor(server, '/verify') });
    assert.deepEqual(r, { ok: true, verified: true });
    assert.deepEqual(received, { email: 'a@b.com', code: '123456' });
  } finally {
    server.close();
  }
});

test('verifyCode: 2xx { verified:false } -> soft { ok:false, reason:"invalid-code" }', async () => {
  const server = await startStub((req, res) => json(res, 200, { verified: false, reason: 'invalid-code' }));
  try {
    const r = await verifyCode({ email: 'a@b.com', code: '000000' }, { url: urlFor(server, '/verify') });
    assert.deepEqual(r, { ok: false, reason: 'invalid-code' });
  } finally {
    server.close();
  }
});

test('verifyCode: 2xx { verified:false, reason:"expired" } -> soft { ok:false, reason:"expired" }', async () => {
  const server = await startStub((req, res) => json(res, 200, { verified: false, reason: 'expired' }));
  try {
    const r = await verifyCode({ email: 'a@b.com', code: '123456' }, { url: urlFor(server, '/verify') });
    assert.deepEqual(r, { ok: false, reason: 'expired' });
  } finally {
    server.close();
  }
});

test('verifyCode: 400/410 with a reason are treated as soft (retryable), not technical', async () => {
  const expired = await startStub((req, res) => json(res, 410, { reason: 'expired' }));
  try {
    assert.deepEqual(await verifyCode({ email: 'a@b.com', code: 'x' }, { url: urlFor(expired, '/verify') }), { ok: false, reason: 'expired' });
  } finally {
    expired.close();
  }
  const bad = await startStub((req, res) => json(res, 400, { reason: 'invalid-code' }));
  try {
    assert.deepEqual(await verifyCode({ email: 'a@b.com', code: 'x' }, { url: urlFor(bad, '/verify') }), { ok: false, reason: 'invalid-code' });
  } finally {
    bad.close();
  }
});

test('verifyCode: 5xx -> technical { ok:false, reason:"http-500" }', async () => {
  const server = await startStub((req, res) => json(res, 500, { error: 'boom' }));
  try {
    const r = await verifyCode({ email: 'a@b.com', code: 'x' }, { url: urlFor(server, '/verify') });
    assert.deepEqual(r, { ok: false, reason: 'http-500' });
  } finally {
    server.close();
  }
});

test('verifyCode: 2xx with unparseable body -> { ok:false, reason:"invalid-json" }', async () => {
  const server = await startStub((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('not json'); });
  try {
    const r = await verifyCode({ email: 'a@b.com', code: 'x' }, { url: urlFor(server, '/verify') });
    assert.deepEqual(r, { ok: false, reason: 'invalid-json' });
  } finally {
    server.close();
  }
});

test('classifyVerifyReason: invalid/expired are soft, everything else technical', () => {
  assert.equal(classifyVerifyReason('invalid-code'), 'soft');
  assert.equal(classifyVerifyReason('expired'), 'soft');
  assert.equal(classifyVerifyReason('network-error'), 'technical');
  assert.equal(classifyVerifyReason('http-500'), 'technical');
  assert.equal(classifyVerifyReason('no-endpoint'), 'technical');
});

/* ---------- runEmailVerification (wait-mode loop) ---------- */

// Scripted stdin: resolves each queued answer in order; '' after the queue
// drains (mimics EOF/closed stdin -> cancel).
function scriptedAsk(answers) {
  const queue = [...answers];
  return async () => (queue.length ? queue.shift() : '');
}
// Swallow the module's stdout writes during loop tests.
const silent = { write: () => {} };

test('runEmailVerification: no derived endpoint -> { verified:false, reason:"unavailable" }, no request attempted', async () => {
  let requested = false;
  const r = await runEmailVerification({
    email: 'a@b.com',
    ask: scriptedAsk([]),
    catalog: catalogEs,
    requestUrl: null,
    verifyUrl: null,
    deps: { requestCode: async () => { requested = true; return { ok: true }; }, verifyCode: async () => ({ ok: true, verified: true }), write: silent.write },
  });
  assert.deepEqual(r, { verified: false, reason: 'unavailable' });
  assert.equal(requested, false);
});

test('runEmailVerification: request fails -> { verified:false, reason:"request-failed" }, never prompts for a code', async () => {
  let codeAsked = false;
  const r = await runEmailVerification({
    email: 'a@b.com',
    ask: async () => { codeAsked = true; return '123456'; },
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: { requestCode: async () => ({ ok: false, reason: 'http-500' }), verifyCode: async () => ({ ok: true, verified: true }), write: silent.write },
  });
  assert.deepEqual(r, { verified: false, reason: 'request-failed' });
  assert.equal(codeAsked, false);
});

test('runEmailVerification: happy path -> sends code, enters wait mode, verifies -> { verified:true }', async () => {
  const writes = [];
  let requestCalls = 0;
  const r = await runEmailVerification({
    email: 'talent@example.com',
    ask: scriptedAsk(['123456']),
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: {
      requestCode: async () => { requestCalls++; return { ok: true }; },
      verifyCode: async ({ code }) => (code === '123456' ? { ok: true, verified: true } : { ok: false, reason: 'invalid-code' }),
      write: (s) => writes.push(s),
    },
  });
  assert.deepEqual(r, { verified: true });
  assert.equal(requestCalls, 1);
  // The "wait mode" message names the email the code was sent to.
  assert.ok(writes.some((w) => w.includes('talent@example.com')), 'expected a "sent to <email>" line');
});

test('runEmailVerification: wrong code then correct one -> retries, then { verified:true }', async () => {
  let verifyCalls = 0;
  const r = await runEmailVerification({
    email: 'a@b.com',
    ask: scriptedAsk(['000000', '123456']),
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: {
      requestCode: async () => ({ ok: true }),
      verifyCode: async ({ code }) => { verifyCalls++; return code === '123456' ? { ok: true, verified: true } : { ok: false, reason: 'invalid-code' }; },
      write: silent.write,
    },
  });
  assert.deepEqual(r, { verified: true });
  assert.equal(verifyCalls, 2);
});

test('runEmailVerification: "r" resends without consuming an attempt, then verifies', async () => {
  let requestCalls = 0;
  const r = await runEmailVerification({
    email: 'a@b.com',
    ask: scriptedAsk(['r', '123456']),
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: {
      requestCode: async () => { requestCalls++; return { ok: true }; },
      verifyCode: async ({ code }) => (code === '123456' ? { ok: true, verified: true } : { ok: false, reason: 'invalid-code' }),
      write: silent.write,
    },
  });
  assert.deepEqual(r, { verified: true });
  assert.equal(requestCalls, 2, 'initial send + one resend');
});

test('runEmailVerification: empty line (EOF / Ctrl-C) cancels -> { verified:false, reason:"cancelled" }', async () => {
  const r = await runEmailVerification({
    email: 'a@b.com',
    ask: scriptedAsk(['']),
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: { requestCode: async () => ({ ok: true }), verifyCode: async () => ({ ok: true, verified: true }), write: silent.write },
  });
  assert.deepEqual(r, { verified: false, reason: 'cancelled' });
});

test('runEmailVerification: expired code shows the actionable message and keeps waiting, then a resend+valid code succeeds', async () => {
  const writes = [];
  const r = await runEmailVerification({
    email: 'a@b.com',
    ask: scriptedAsk(['111111', 'r', '123456']),
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: {
      requestCode: async () => ({ ok: true }),
      verifyCode: async ({ code }) => (code === '123456' ? { ok: true, verified: true } : { ok: false, reason: 'expired' }),
      write: (s) => writes.push(s),
    },
  });
  assert.deepEqual(r, { verified: true });
  assert.ok(writes.some((w) => w === `  ${catalogEs.verify.expired}\n`), 'expected the expired message');
});

test('runEmailVerification: technical verify failure bails out -> { verified:false, reason:"technical" }', async () => {
  const r = await runEmailVerification({
    email: 'a@b.com',
    ask: scriptedAsk(['123456']),
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: { requestCode: async () => ({ ok: true }), verifyCode: async () => ({ ok: false, reason: 'network-error' }), write: silent.write },
  });
  assert.deepEqual(r, { verified: false, reason: 'technical' });
});

test('runEmailVerification: too many wrong codes -> { verified:false, reason:"exhausted" }', async () => {
  const r = await runEmailVerification({
    email: 'a@b.com',
    ask: scriptedAsk(['1', '2', '3', '4', '5', '6', '7']),
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: { requestCode: async () => ({ ok: true }), verifyCode: async () => ({ ok: false, reason: 'invalid-code' }), write: silent.write },
  });
  assert.deepEqual(r, { verified: false, reason: 'exhausted' });
});

test('runEmailVerification: never echoes the pasted code in its output', async () => {
  const writes = [];
  await runEmailVerification({
    email: 'a@b.com',
    ask: scriptedAsk(['987654', '123456']),
    catalog: catalogEs,
    requestUrl: 'http://x/request',
    verifyUrl: 'http://x/verify',
    deps: {
      requestCode: async () => ({ ok: true }),
      verifyCode: async ({ code }) => (code === '123456' ? { ok: true, verified: true } : { ok: false, reason: 'invalid-code' }),
      write: (s) => writes.push(s),
    },
  });
  const all = writes.join('');
  assert.equal(all.includes('987654'), false, 'the wrong code must never be printed');
  assert.equal(all.includes('123456'), false, 'the accepted code must never be printed');
});
