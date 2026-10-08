'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const client = require('../src/mcp-signup-client');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('requestMcpSignup: multipart with the PDF as `file`, every hint, and a multi-line userQuery kept intact; returns the claim code', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res, raw) => {
    seen.type = req.headers['content-type'];
    seen.auth = req.headers.authorization;
    seen.raw = raw;
    reply(res, 200, { status: 'OK', message: 'Claim code issued', data: { claimCode: 'CODE-1', claimCodeExpiresAt: '2026-10-07T12:00:00.000Z' } });
  });
  const r = await client.requestMcpSignup(
    {
      linkedinUrl: 'https://www.linkedin.com/in/ada',
      cv: { filename: 'ada.pdf', contentType: 'application/pdf', data: Buffer.from('%PDF-1.4 ada') },
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      userQuery: 'Line one\nLine two',
      language: 'es',
    },
    { endpoint: `${base}/works-ai/talents/mcp-signup` },
  );
  server.close();
  assert.match(seen.type, /^multipart\/form-data; boundary=/);
  assert.equal(seen.auth, undefined, 'public route: no credential is sent');
  assert.match(seen.raw, /name="file"; filename="ada.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1.4 ada\r\n/);
  assert.match(seen.raw, /name="linkedinUrl"\r\n\r\nhttps:\/\/www.linkedin.com\/in\/ada\r\n/);
  assert.match(seen.raw, /name="email"\r\n\r\nada@example.com\r\n/);
  assert.match(seen.raw, /name="firstName"\r\n\r\nAda\r\n/);
  assert.match(seen.raw, /name="lastName"\r\n\r\nLovelace\r\n/);
  assert.match(seen.raw, /name="userQuery"\r\n\r\nLine one\nLine two\r\n/);
  assert.match(seen.raw, /name="language"\r\n\r\nes\r\n/);
  assert.deepEqual(r, { ok: true, claimCode: 'CODE-1', claimCodeExpiresAt: '2026-10-07T12:00:00.000Z' });
});

test('requestMcpSignup: empty hints are not sent at all', async () => {
  let raw = '';
  const { server, base } = await startServer((req, res, body) => { raw = body; reply(res, 200, { status: 'OK', data: { claimCode: 'C' } }); });
  await client.requestMcpSignup({ linkedinUrl: 'https://www.linkedin.com/in/ada', email: '  ', firstName: '' }, { endpoint: `${base}/s` });
  server.close();
  assert.equal(raw.includes('name="email"'), false);
  assert.equal(raw.includes('name="firstName"'), false);
  assert.equal(raw.includes('name="file"'), false);
});

test('requestMcpSignup: every coded hub error maps to its own reason; none tells an existing account apart', async () => {
  assert.equal('ACCOUNT_EXISTS' in client.CODE_TO_REASON, false);
  const cases = [
    [422, 'MISSING_SOURCE', 'missing-source'],
    [422, 'INVALID_CV', 'invalid-cv'],
    [422, 'INVALID_LINKEDIN_URL', 'invalid-linkedin-url'],
    [429, 'RATE_LIMITED', 'rate-limited'],
    [500, 'SOMETHING_NEW', 'http-500'],
  ];
  for (const [status, code, reason] of cases) {
    const { server, base } = await startServer((req, res) => reply(res, status, { status: 'KO', code, message: 'x', meta: {} }));
    const r = await client.requestMcpSignup({ linkedinUrl: 'https://www.linkedin.com/in/ada' }, { endpoint: `${base}/s` });
    server.close();
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason, `${code} -> ${reason}`);
  }
});

test('requestMcpSignup: a 200 without a claim code is a bad response, never a silent success', async () => {
  const { server, base } = await startServer((req, res) => reply(res, 200, { status: 'OK', data: {} }));
  const r = await client.requestMcpSignup({ linkedinUrl: 'x' }, { endpoint: `${base}/s` });
  server.close();
  assert.deepEqual(r, { ok: false, reason: 'bad-response' });
});

test('requestMyImportStatus: GET with the talent\'s hub token; a running import has no sources yet', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res) => {
    seen.method = req.method;
    seen.auth = req.headers.authorization;
    reply(res, 200, { status: 'OK', data: { profileImportStatus: 'RUNNING', errorCode: null, sources: [] } });
  });
  const r = await client.requestMyImportStatus({ hubAccessToken: 'HUB' }, { endpoint: `${base}/works/me/import-profile/status` });
  server.close();
  assert.deepEqual(seen, { method: 'GET', auth: 'Bearer HUB' });
  assert.deepEqual(r, { ok: true, state: 'running', sources: {} });
});

test('requestMyImportStatus: a finished import reports each sign-up source it imported or failed, failed ones with their code', async () => {
  const bodies = [
    [{ source: 'cv', status: 'imported' }, { source: 'linkedin', status: 'failed', code: 'source.not_found', retryable: false }, { source: 'github', status: 'imported' }],
    [{ source: 'cv', status: 'imported' }, { source: 'linkedin', status: 'not_requested' }],
  ];
  const { server, base } = await startServer((req, res) => reply(res, 200, { status: 'OK', data: { profileImportStatus: 'DONE', errorCode: null, sources: bodies.shift() } }));
  const r = await client.requestMyImportStatus({ hubAccessToken: 'HUB' }, { endpoint: `${base}/s` });
  const notAsked = await client.requestMyImportStatus({ hubAccessToken: 'HUB' }, { endpoint: `${base}/s` });
  server.close();
  assert.deepEqual(r, { ok: true, state: 'done', sources: { cv: { state: 'done' }, linkedin: { state: 'failed', code: 'source.not_found' } } });
  assert.deepEqual(notAsked.sources, { cv: { state: 'done' } }, 'a source nobody sent is not reported as imported');
});

test('requestMyImportStatus: a failed import carries its code; none requested is none; no token sends nothing', async () => {
  const bodies = [
    { profileImportStatus: 'FAILED', errorCode: 'works-ai.timeout', sources: [] },
    { profileImportStatus: null, errorCode: null, sources: [] },
  ];
  const { server, base } = await startServer((req, res) => reply(res, 200, { status: 'OK', data: bodies.shift() }));
  const failed = await client.requestMyImportStatus({ hubAccessToken: 'HUB' }, { endpoint: `${base}/s` });
  const none = await client.requestMyImportStatus({ hubAccessToken: 'HUB' }, { endpoint: `${base}/s` });
  server.close();
  assert.deepEqual(failed, { ok: true, state: 'failed', code: 'works-ai.timeout', sources: {} });
  assert.deepEqual(none, { ok: true, state: 'none', sources: {} });
  assert.deepEqual(await client.requestMyImportStatus({}, { endpoint: `${base}/s` }), { ok: false, reason: 'no-session' });
});

test('requestOneTimeToken: GET with the email session cookie, or the device session token as Bearer', async () => {
  const seen = [];
  const { server, base } = await startServer((req, res) => {
    seen.push({ method: req.method, cookie: req.headers.cookie, auth: req.headers.authorization });
    reply(res, 200, { token: 'OTT' });
  });
  const viaCookie = await client.requestOneTimeToken({ cookie: 'better-auth.session_token=abc.sig' }, { endpoint: `${base}/auth/one-time-token/generate` });
  const viaBearer = await client.requestOneTimeToken({ sessionToken: 'SESS' }, { endpoint: `${base}/auth/one-time-token/generate` });
  server.close();
  assert.deepEqual(seen[0], { method: 'GET', cookie: 'better-auth.session_token=abc.sig', auth: undefined });
  assert.deepEqual(seen[1], { method: 'GET', cookie: undefined, auth: 'Bearer SESS' });
  assert.deepEqual(viaCookie, { ok: true, token: 'OTT' });
  assert.deepEqual(viaBearer, { ok: true, token: 'OTT' });
});

test('requestOneTimeToken: no session means no request', async () => {
  assert.deepEqual(await client.requestOneTimeToken({}, { endpoint: 'http://127.0.0.1:1/x' }), { ok: false, reason: 'no-session' });
});
