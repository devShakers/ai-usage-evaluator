'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestInterviewFinalization } = require('../src/onboarding-status-client');

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/api/v1/interviews` }));
  });
}

test('requestInterviewFinalization: GETs the interview finalization with the certs Bearer and reads data.status', async () => {
  const seen = [];
  const { server, base } = await serve((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { status: 'PROCESSING' } }));
  });
  try {
    const r = await requestInterviewFinalization({ interviewId: 'iv-1', accessToken: 'certs-jwt' }, { base });
    assert.deepEqual(r, { ok: true, status: 'PROCESSING' });
    assert.deepEqual(seen, [{ method: 'GET', url: '/api/v1/interviews/iv-1/finalization', auth: 'Bearer certs-jwt' }]);
  } finally {
    server.close();
  }
});

test('requestInterviewFinalization: an HTTP error or a body without a status is a named reason', async () => {
  const { server, base } = await serve((req, res) => {
    res.writeHead(req.url.includes('forbidden') ? 403 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: {} }));
  });
  try {
    assert.deepEqual(await requestInterviewFinalization({ interviewId: 'forbidden', accessToken: 'x' }, { base }), { ok: false, reason: 'http-403' });
    assert.deepEqual(await requestInterviewFinalization({ interviewId: 'iv-2', accessToken: 'x' }, { base }), { ok: false, reason: 'bad-response' });
    assert.deepEqual(await requestInterviewFinalization({ interviewId: 'iv-2' }, {}), { ok: false, reason: 'no-endpoint' });
  } finally {
    server.close();
  }
});
