'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { handle } = require('../reference-server/server');

/*
 * skill-code-certification / ADR-006: the reference-server DETERMINISTIC stub
 * for the email-ownership OTP routes. NO real email is sent and NO TTL store
 * exists — the stub accepts one FIXED code (123456) so the CLI's wait-mode
 * contract is reproducibly exercisable locally. The real endpoints (HubSpot
 * transactional send, Redis TTL/single-use, rate limiting) are shakers-hub-
 * backend.
 */

const STUB_CODE = '123456';

function startStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function post(server, path, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : null }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const REQUEST = '/works/ai-footprint/email-verification/request';
const VERIFY = '/works/ai-footprint/email-verification/verify';

let server;
test.before(async () => { server = await startStub(); });
test.after(() => server.close());

test('request: well-formed email -> 200 { sent:true } (anti-enumeration: same answer regardless of Talent existence)', async () => {
  const a = await post(server, REQUEST, { email: 'talent@example.com' });
  const b = await post(server, REQUEST, { email: 'stranger@example.com' });
  assert.equal(a.status, 200);
  assert.deepEqual(a.json, { sent: true });
  assert.equal(b.status, 200);
  assert.deepEqual(b.json, { sent: true });
});

test('request: invalid/absent email -> 400', async () => {
  const { status } = await post(server, REQUEST, { email: 'not-an-email' });
  assert.equal(status, 400);
});

test('verify: the fixed stub code -> 200 { verified:true }', async () => {
  const { status, json } = await post(server, VERIFY, { email: 'talent@example.com', code: STUB_CODE });
  assert.equal(status, 200);
  assert.deepEqual(json, { verified: true });
});

test('verify: a wrong code -> 200 { verified:false, reason:"invalid-code" }', async () => {
  const { status, json } = await post(server, VERIFY, { email: 'talent@example.com', code: '000000' });
  assert.equal(status, 200);
  assert.deepEqual(json, { verified: false, reason: 'invalid-code' });
});

test('verify: missing code -> 400', async () => {
  const { status } = await post(server, VERIFY, { email: 'talent@example.com' });
  assert.equal(status, 400);
});
