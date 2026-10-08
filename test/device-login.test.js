'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { runDeviceLogin, startDeviceLogin, pollDeviceToken, finalizeDeviceSession } = require('../src/device-login');

// A scripted broker: authorize once, token replies follow `tokenScript` (an array
// of {status, body}) call by call (last repeats), complete-registration answers
// 200, and GET /auth/token exchanges the session token for the API JWT. `order`
// records the sequence of /complete and /auth/token hits (to pin the ORDER).
function startBroker(tokenScript, { apiJwt = 'API-JWT', interval = 5 } = {}) {
  let i = 0;
  const order = [];
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.method === 'GET' && req.url.endsWith('/auth/token')) {
        order.push('auth/token');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: apiJwt }));
        return;
      }
      if (req.url.endsWith('/complete')) {
        order.push('complete');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'OK' }));
        return;
      }
      if (req.url.endsWith('/device/code')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ device_code: 'DEV', user_code: 'ABCD-1234', verification_uri: 'https://h/d', verification_uri_complete: 'https://h/d?user_code=ABCD-1234', expires_in: 600, interval }));
        return;
      }
      const step = tokenScript[Math.min(i, tokenScript.length - 1)];
      i += 1;
      res.writeHead(step.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(step.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, order, authorizeEndpoint: `${base}/device/code`, tokenEndpoint: `${base}/device/token`, authTokenEndpoint: `${base}/auth/token`, completeRegistrationEndpoint: `${base}/complete` });
    });
  });
}

const instant = () => Promise.resolve();

test('runDeviceLogin: polls past pending, then authorizes; onPrompt gets URL + code', async () => {
  const broker = await startBroker([
    { status: 400, body: { error: 'authorization_pending' } },
    { status: 400, body: { error: 'authorization_pending' } },
    { status: 200, body: { access_token: 'SESS', isNewUser: true, email: 'g@x.com' } },
  ]);
  try {
    let prompt = null;
    const r = await runDeviceLogin(broker, { sleep: instant, onPrompt: (p) => { prompt = p; } });
    assert.deepEqual(r, { ok: true, token: 'API-JWT', sessionToken: 'SESS', isNewUser: true, email: 'g@x.com' });
    assert.equal(prompt.userCode, 'ABCD-1234');
    assert.equal(prompt.verificationUriComplete, 'https://h/d?user_code=ABCD-1234');
  } finally {
    broker.server.close();
  }
});

test('runDeviceLogin: slow_down is tolerated and still authorizes', async () => {
  const broker = await startBroker([
    { status: 400, body: { error: 'slow_down' } },
    { status: 200, body: { access_token: 'SESS' } },
  ]);
  try {
    const r = await runDeviceLogin(broker, { sleep: instant });
    assert.equal(r.ok, true);
    assert.equal(r.token, 'API-JWT');
    assert.equal(r.sessionToken, 'SESS');
    assert.equal(r.isNewUser, false);
  } finally {
    broker.server.close();
  }
});

test('runDeviceLogin: access_denied and expired_token surface named reasons', async () => {
  const denied = await startBroker([{ status: 400, body: { error: 'access_denied' } }]);
  try {
    assert.deepEqual(await runDeviceLogin(denied, { sleep: instant }), { ok: false, reason: 'denied' });
  } finally { denied.server.close(); }

  const expired = await startBroker([{ status: 400, body: { error: 'expired_token' } }]);
  try {
    assert.deepEqual(await runDeviceLogin(expired, { sleep: instant }), { ok: false, reason: 'expired' });
  } finally { expired.server.close(); }
});

test('runDeviceLogin: local deadline stops the loop with reason expired', async () => {
  const broker = await startBroker([{ status: 400, body: { error: 'authorization_pending' } }]);
  try {
    // now() jumps past the deadline on the second check, before any real polling.
    let t = 0;
    const r = await runDeviceLogin(broker, { sleep: instant, now: () => { t += 1_000_000; return t; }, maxWaitMs: 1 });
    assert.deepEqual(r, { ok: false, reason: 'expired' });
  } finally {
    broker.server.close();
  }
});

test('runDeviceLogin: no endpoints -> no-endpoint', async () => {
  assert.deepEqual(await runDeviceLogin({ authorizeEndpoint: null, tokenEndpoint: null, authTokenEndpoint: null }, { sleep: instant }), { ok: false, reason: 'no-endpoint' });
});

test('runDeviceLogin (new user): complete-registration runs BEFORE the JWT exchange', async () => {
  const broker = await startBroker([{ status: 200, body: { access_token: 'SESS', isNewUser: true, email: 'new@x.com' } }]);
  try {
    const r = await runDeviceLogin(
      { ...broker, registrationContext: { freelanceType: 'FREELANCE' } },
      { sleep: instant },
    );
    assert.equal(r.ok, true);
    assert.equal(r.token, 'API-JWT');
    assert.deepEqual(broker.order, ['complete', 'auth/token'], 'the Hub refuses the JWT until registration is completed');
  } finally {
    broker.server.close();
  }
});

test('finalizeDeviceSession: new user -> complete FIRST (Bearer session), then exchange', async () => {
  const order = [];
  let completeOpts = null;
  const fin = await finalizeDeviceSession(
    { sessionToken: 'SESS', isNewUser: true, authTokenEndpoint: 'https://h/auth/token', completeRegistrationEndpoint: 'https://h/complete', registrationContext: { freelanceType: 'FREELANCE' } },
    {
      requestCompleteRegistration: async (ctx, opts) => { order.push('complete'); completeOpts = opts; return { ok: true }; },
      requestApiToken: async ({ accessToken }) => { order.push('token'); assert.equal(accessToken, 'SESS'); return { ok: true, token: 'API-JWT' }; },
    },
  );
  assert.deepEqual(fin, { ok: true, token: 'API-JWT' });
  assert.deepEqual(order, ['complete', 'token']);
  assert.equal(completeOpts.bearerToken, 'SESS', 'complete-registration is Bearer-authenticated with the session token');
});

test('finalizeDeviceSession: existing user -> exchange only, no complete', async () => {
  const order = [];
  const fin = await finalizeDeviceSession(
    { sessionToken: 'SESS', isNewUser: false, authTokenEndpoint: 'https://h/auth/token', completeRegistrationEndpoint: 'https://h/complete' },
    {
      requestCompleteRegistration: async () => { order.push('complete'); return { ok: true }; },
      requestApiToken: async () => { order.push('token'); return { ok: true, token: 'API-JWT' }; },
    },
  );
  assert.equal(fin.token, 'API-JWT');
  assert.deepEqual(order, ['token'], 'an existing account already has a domain user');
});

test('finalizeDeviceSession: complete fails -> no exchange, named reason; exchange 500 -> token-exchange-failed (not logged in)', async () => {
  let tokenCalled = false;
  const failComplete = await finalizeDeviceSession(
    { sessionToken: 'SESS', isNewUser: true, authTokenEndpoint: 'https://h/auth/token', completeRegistrationEndpoint: 'https://h/complete', registrationContext: {} },
    {
      requestCompleteRegistration: async () => ({ ok: false, reason: 'complete-registration-http-500' }),
      requestApiToken: async () => { tokenCalled = true; return { ok: true, token: 'API-JWT' }; },
    },
  );
  assert.deepEqual(failComplete, { ok: false, reason: 'complete-registration-http-500' });
  assert.equal(tokenCalled, false, 'the JWT is never fetched when registration did not complete');

  const failToken = await finalizeDeviceSession(
    { sessionToken: 'SESS', isNewUser: false, authTokenEndpoint: 'https://h/auth/token' },
    { requestApiToken: async () => ({ ok: false, reason: 'http-error', status: 500 }) },
  );
  assert.deepEqual(failToken, { ok: false, reason: 'token-exchange-failed' });
});

test('runDeviceLogin with the REAL defaultSleep waits the interval — does not resolve instantly (regression: unref exit)', async () => {
  // interval:1 -> the loop sleeps ~1s before the first poll. With the OLD unref'd
  // sleep the process could exit mid-await; here the promise must stay unsettled
  // for well past a tick, then resolve normally.
  const broker = await startBroker([{ status: 200, body: { access_token: 'SESS', isNewUser: false } }], { interval: 1 });
  try {
    const p = runDeviceLogin(broker, {}); // NO sleep injected -> exercises the real defaultSleep
    const raced = await Promise.race([
      p.then(() => 'resolved'),
      new Promise((r) => { setTimeout(() => r('still-waiting'), 60); }),
    ]);
    assert.equal(raced, 'still-waiting', 'the loop must still be sleeping before the first poll, not exit/resolve instantly');
    const result = await p;
    assert.equal(result.ok, true);
    assert.equal(result.token, 'API-JWT');
  } finally {
    broker.server.close();
  }
});

test('startDeviceLogin / pollDeviceToken are the shared primitives the MCP tools reuse', async () => {
  const broker = await startBroker([{ status: 200, body: { access_token: 'SESS', isNewUser: false } }]);
  try {
    const authz = await startDeviceLogin({ authorizeEndpoint: broker.authorizeEndpoint });
    assert.equal(authz.ok, true);
    assert.equal(authz.deviceCode, 'DEV');
    const poll = await pollDeviceToken({ deviceCode: authz.deviceCode, tokenEndpoint: broker.tokenEndpoint });
    assert.equal(poll.status, 'authorized');
    assert.equal(poll.accessToken, 'SESS');
  } finally {
    broker.server.close();
  }
});

test('finalizeDeviceSession: a new user with a claimCode registers claiming it and reports claimed', async () => {
  let seenOpts = null;
  const fin = await finalizeDeviceSession(
    { sessionToken: 'SESS', isNewUser: true, authTokenEndpoint: 'https://hub/auth/token', completeRegistrationEndpoint: 'https://hub/complete', registrationContext: { freelanceType: 'POTENTIAL_FREELANCE' }, claimCode: 'CODE-1' },
    {
      requestCompleteRegistration: async (ctx, opts) => { seenOpts = opts; return { ok: true, claimed: true }; },
      requestApiToken: async () => ({ ok: true, token: 'API-JWT' }),
    },
  );
  assert.equal(seenOpts.claimCode, 'CODE-1');
  assert.equal(seenOpts.bearerToken, 'SESS');
  assert.deepEqual(fin, { ok: true, token: 'API-JWT', claimed: true });
});
