'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestDeviceAuthorization, requestDeviceToken, requestApiToken } = require('../src/auth-device-client');

// A one-shot local server that replies with a fixed status + JSON body.
function serveOnce(status, body) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

async function withServer(status, body, fn) {
  const { server, url } = await serveOnce(status, body);
  try { return await fn(url); } finally { server.close(); }
}

test('requestDeviceAuthorization: parses a flat RFC 8628 body', async () => {
  await withServer(200, {
    device_code: 'DEV', user_code: 'ABCD-1234', verification_uri: 'https://h/d',
    verification_uri_complete: 'https://h/d?user_code=ABCD-1234', expires_in: 600, interval: 3,
  }, async (url) => {
    const r = await requestDeviceAuthorization({ endpoint: url });
    assert.deepEqual(r, {
      ok: true, deviceCode: 'DEV', userCode: 'ABCD-1234', verificationUri: 'https://h/d',
      verificationUriComplete: 'https://h/d?user_code=ABCD-1234', expiresIn: 600, interval: 3,
    });
  });
});

test('requestDeviceAuthorization: accepts a {status,data} envelope and fills defaults', async () => {
  await withServer(200, { status: 'OK', data: { device_code: 'DEV', user_code: 'CODE', verification_uri: 'https://h/d' } }, async (url) => {
    const r = await requestDeviceAuthorization({ endpoint: url });
    assert.equal(r.ok, true);
    assert.equal(r.verificationUriComplete, 'https://h/d', 'falls back to the plain URI');
    assert.equal(r.interval, 5, 'default interval');
    assert.equal(r.expiresIn, 600, 'default expiry');
  });
});

test('requestDeviceAuthorization: missing fields -> bad-response; 503 -> upstream; no endpoint -> no-endpoint', async () => {
  await withServer(200, { device_code: 'DEV' }, async (url) => {
    assert.deepEqual(await requestDeviceAuthorization({ endpoint: url }), { ok: false, reason: 'bad-response', status: 200 });
  });
  await withServer(503, { error: 'x' }, async (url) => {
    assert.deepEqual(await requestDeviceAuthorization({ endpoint: url }), { ok: false, reason: 'upstream', status: 503 });
  });
  assert.deepEqual(await requestDeviceAuthorization({ endpoint: null }), { ok: false, reason: 'no-endpoint' });
});

test('requestDeviceToken: 200 -> authorized carries the SESSION access_token (+ isNewUser, email)', async () => {
  await withServer(200, { access_token: 'SESS', token_type: 'Bearer', expires_in: 3600, isNewUser: true, email: 'g@x.com' }, async (url) => {
    assert.deepEqual(await requestDeviceToken({ deviceCode: 'DEV' }, { endpoint: url }), {
      status: 'authorized', accessToken: 'SESS', tokenType: 'Bearer', expiresIn: 3600, isNewUser: true, email: 'g@x.com',
    });
  });
});

test('requestDeviceToken: maps the RFC 8628 error codes', async () => {
  const cases = [
    ['authorization_pending', 'pending'],
    ['slow_down', 'slow_down'],
    ['access_denied', 'denied'],
    ['expired_token', 'expired'],
  ];
  for (const [error, expected] of cases) {
    // eslint-disable-next-line no-await-in-loop
    await withServer(400, { error }, async (url) => {
      const r = await requestDeviceToken({ deviceCode: 'DEV' }, { endpoint: url });
      assert.equal(r.status, expected, `${error} -> ${expected}`);
    });
  }
});

test('requestDeviceToken: access_denied may arrive as 401; unknown code -> error; missing inputs guarded', async () => {
  await withServer(401, { error: 'access_denied' }, async (url) => {
    assert.equal((await requestDeviceToken({ deviceCode: 'DEV' }, { endpoint: url })).status, 'denied');
  });
  await withServer(200, { nope: 1 }, async (url) => {
    assert.equal((await requestDeviceToken({ deviceCode: 'DEV' }, { endpoint: url })).status, 'error');
  });
  await withServer(400, { error: 'invalid_grant' }, async (url) => {
    const r = await requestDeviceToken({ deviceCode: 'DEV' }, { endpoint: url });
    assert.equal(r.status, 'error');
    assert.equal(r.reason, 'invalid_grant');
  });
  assert.equal((await requestDeviceToken({ deviceCode: 'DEV' }, { endpoint: null })).status, 'error');
  assert.equal((await requestDeviceToken({ deviceCode: null }, { endpoint: 'http://x' })).reason, 'no-device-code');
});

test('requestApiToken: GET with the session token as Bearer -> the API JWT; guards + errors', async () => {
  let seenAuth = null;
  const server = http.createServer((req, res) => {
    seenAuth = req.headers.authorization;
    req.resume();
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ token: 'API-JWT' })); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/auth/token`;
    assert.deepEqual(await requestApiToken({ accessToken: 'SESS' }, { endpoint: url }), { ok: true, token: 'API-JWT' });
    assert.equal(seenAuth, 'Bearer SESS', 'the session token is sent as a Bearer, not a cookie');
  } finally {
    server.close();
  }
  assert.deepEqual(await requestApiToken({ accessToken: 'SESS' }, { endpoint: null }), { ok: false, reason: 'no-endpoint' });
  assert.deepEqual(await requestApiToken({ accessToken: null }, { endpoint: 'http://x' }), { ok: false, reason: 'no-access-token' });
});
