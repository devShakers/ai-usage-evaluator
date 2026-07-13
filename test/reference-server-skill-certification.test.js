'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { handle } = require('../reference-server/server');

/*
 * skill-code-certification, issue 006: the reference-server DETERMINISTIC
 * stub for POST /works/ai-footprint/skill-certification. NO LLM, nothing
 * persisted — just exercises the CLI's request/response contract locally.
 * The real endpoint (Anthropic, Talent-match gate, evidence persistence) is
 * shakers-hub-backend.
 */

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

function post(server, body) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      { host: '127.0.0.1', port, path: '/works/ai-footprint/skill-certification', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
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

let server;
test.before(async () => { server = await startStub(); });
test.after(() => server.close());

test('RESOLVE: received technologies come back as certifiable Skills (title-cased, deterministic ids)', async () => {
  const { status, json } = await post(server, { email: 'talent@example.com', technologies: ['react', 'nest-js'] });
  assert.equal(status, 200);
  assert.equal(json.certifiable.length, 2);
  const react = json.certifiable.find((c) => c.technology === 'react');
  assert.equal(react.skillName, 'React');
  assert.equal(typeof react.skillId, 'number');
  assert.deepEqual(json.nonCertifiable, []);
});

test('RESOLVE: deterministic — same input yields the same skillIds', async () => {
  const a = await post(server, { email: 'talent@example.com', technologies: ['React'] });
  const b = await post(server, { email: 'talent@example.com', technologies: ['React'] });
  assert.equal(a.json.certifiable[0].skillId, b.json.certifiable[0].skillId);
});

test('CERTIFY: each item returns {skillId, skillName, score, rationale, improvements[]} derived from the input', async () => {
  const { status, json } = await post(server, {
    email: 'talent@example.com',
    items: [
      { skillId: 12, technology: 'React', files: [{ path: 'a.jsx', content: 'x'.repeat(10) }, { path: 'b.jsx', content: 'y'.repeat(5) }] },
    ],
  });
  assert.equal(status, 200);
  assert.equal(json.results.length, 1);
  const r = json.results[0];
  assert.equal(r.skillId, 12);
  assert.equal(r.skillName, 'React');
  assert.equal(typeof r.score, 'number');
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.equal(typeof r.rationale, 'string');
  assert.ok(Array.isArray(r.improvements) && r.improvements.length > 0);
});

test('CERTIFY: deterministic — same sampled input yields the same score', async () => {
  const payload = { email: 'talent@example.com', items: [{ skillId: 1, technology: 'Go', files: [{ path: 'm.go', content: 'package main' }] }] };
  const a = await post(server, payload);
  const b = await post(server, payload);
  assert.equal(a.json.results[0].score, b.json.results[0].score);
});

test('CERTIFY: rationale never echoes raw code content (references counts only)', async () => {
  const secret = 'SUPER_SECRET_TOKEN_ABC123';
  const { json } = await post(server, {
    email: 'talent@example.com',
    items: [{ skillId: 1, technology: 'React', files: [{ path: 'a.js', content: secret }] }],
  });
  assert.equal(json.results[0].rationale.includes(secret), false);
});

test('invalid/absent email -> 400', async () => {
  const { status } = await post(server, { technologies: ['React'] });
  assert.equal(status, 400);
});

test('neither technologies[] nor items[] -> 400', async () => {
  const { status } = await post(server, { email: 'talent@example.com' });
  assert.equal(status, 400);
});
