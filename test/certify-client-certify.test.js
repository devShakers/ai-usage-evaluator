'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { buildCertifyRequest, requestCertify, normalizeCertifyResponse } = require('../src/certify-client');

/*
 * skill-code-certification, issue 005: the CERTIFY client. Scrubs every file
 * at the request boundary (ADR-001), clamps score, and returns a
 * discriminated result (informs, never a silent fallback / hang).
 */

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function serverUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/works/ai-footprint/skill-certification`;
}

// --- buildCertifyRequest -----------------------------------------------------

test('buildCertifyRequest: shapes {email, items:[{skillId, technology, files:[{path,content}]}]}', () => {
  const body = buildCertifyRequest('a@b.com', [
    { skillId: 1, skillName: 'React', technology: 'React', files: [{ path: 'a.js', content: 'const x=1' }] },
  ]);
  assert.equal(body.email, 'a@b.com');
  assert.equal(body.items.length, 1);
  assert.deepEqual(Object.keys(body.items[0]).sort(), ['files', 'skillId', 'technology']);
  assert.deepEqual(Object.keys(body.items[0].files[0]).sort(), ['content', 'path']);
});

test('buildCertifyRequest: drops skills with no files (nothing to certify)', () => {
  const body = buildCertifyRequest('a@b.com', [
    { skillId: 1, technology: 'React', files: [] },
    { skillId: 2, technology: 'NestJS', files: [{ path: 'm.ts', content: 'x' }] },
  ]);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].skillId, 2);
});

test('buildCertifyRequest: scrubs secrets in file content at the boundary', () => {
  const body = buildCertifyRequest('a@b.com', [
    { skillId: 1, technology: 'React', files: [{ path: 'a.js', content: 'const k="sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF"' }] },
  ]);
  assert.equal(body.items[0].files[0].content.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF'), false);
  assert.match(body.items[0].files[0].content, /\[REDACTED\]/);
});

// --- normalizeCertifyResponse ------------------------------------------------

test('normalizeCertifyResponse: rebuilds fields, clamps score, coerces improvements', () => {
  const out = normalizeCertifyResponse({
    results: [
      { skillId: 1, skillName: 'React', score: 150, rationale: 'good', improvements: ['x', 2, ''], extra: 'drop' },
      { skillId: 2, skillName: 'NestJS', score: -5, rationale: 'ok' },
    ],
  });
  assert.equal(out.results[0].score, 100);
  assert.deepEqual(out.results[0].improvements, ['x']);
  assert.equal(Object.prototype.hasOwnProperty.call(out.results[0], 'extra'), false);
  assert.equal(out.results[1].score, 0);
  assert.deepEqual(out.results[1].improvements, []);
});

test('normalizeCertifyResponse: non-number score -> null; missing results[] -> null', () => {
  assert.equal(normalizeCertifyResponse({ results: [{ skillId: 1, score: 'high' }] }).results[0].score, null);
  assert.equal(normalizeCertifyResponse({ nope: true }), null);
});

// --- requestCertify: happy + failure modes -----------------------------------

const REQ = { email: 'a@b.com', items: [{ skillId: 1, technology: 'React', files: [{ path: 'a.js', content: 'x' }] }] };

test('requestCertify: happy path returns {ok:true, result:{results}}', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200);
      res.end(JSON.stringify({ results: [{ skillId: 1, skillName: 'React', score: 80, rationale: 'solid', improvements: ['add tests'] }] }));
    });
  });
  try {
    const out = await requestCertify(REQ, { endpoint: serverUrl(server) });
    assert.equal(out.ok, true);
    assert.equal(out.result.results[0].score, 80);
  } finally {
    server.close();
  }
});

test('requestCertify: no endpoint / non-2xx / invalid-json / invalid-shape -> discriminated reasons', async () => {
  assert.deepEqual(await requestCertify(REQ, { endpoint: null }), { ok: false, reason: 'no-endpoint' });

  const s403 = await startServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.writeHead(403); res.end('{}'); }); });
  try { assert.deepEqual(await requestCertify(REQ, { endpoint: serverUrl(s403) }), { ok: false, reason: 'http-403' }); } finally { s403.close(); }

  const sBad = await startServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.writeHead(200); res.end('nope{{{'); }); });
  try { assert.deepEqual(await requestCertify(REQ, { endpoint: serverUrl(sBad) }), { ok: false, reason: 'invalid-json' }); } finally { sBad.close(); }

  const sShape = await startServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.writeHead(200); res.end(JSON.stringify({ oops: 1 })); }); });
  try { assert.deepEqual(await requestCertify(REQ, { endpoint: serverUrl(sShape) }), { ok: false, reason: 'invalid-shape' }); } finally { sShape.close(); }
});

test('requestCertify: timeout -> {ok:false, reason:"timeout"} (never hangs)', async () => {
  const server = await startServer(() => {});
  try {
    const out = await requestCertify(REQ, { endpoint: serverUrl(server), timeoutMs: 50 });
    assert.deepEqual(out, { ok: false, reason: 'timeout' });
  } finally {
    server.close();
  }
});

test('requestCertify: no raw secret survives to the wire (re-scrub at boundary)', async () => {
  let received;
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { received = raw; res.writeHead(200); res.end(JSON.stringify({ results: [] })); });
  });
  try {
    await requestCertify(buildCertifyRequest('a@b.com', [
      { skillId: 1, technology: 'React', files: [{ path: 'a.js', content: 'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF' }] },
    ]), { endpoint: serverUrl(server) });
    assert.equal(received.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF'), false);
  } finally {
    server.close();
  }
});
