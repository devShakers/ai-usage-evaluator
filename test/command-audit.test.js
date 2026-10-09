'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { emitCommandAudit, redactArgs, buildAudit } = require('../src/command-audit');
const { saveAuthSession } = require('../src/auth-session-store');

function tmpConfigEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-audit-'));
  return { SHAKERS_CLI_CONFIG_DIR: dir, ...extra, __dir: dir };
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const baseOf = (server) => `http://127.0.0.1:${server.address().port}/api/v1`;

/* ---------- redactArgs ---------- */

test('redactArgs: empty or non-array argv yields null', () => {
  assert.equal(redactArgs([]), null);
  assert.equal(redactArgs(null), null);
  assert.equal(redactArgs('login'), null);
});

test('redactArgs: scrubs a secret-shaped token out of the sample', () => {
  const out = redactArgs(['login', '--token', `sk-${'a'.repeat(44)}`]);
  assert.ok(out.includes('[REDACTED]'));
  assert.ok(!out.includes('aaaa'));
});

test('redactArgs: caps the sample at 200 chars measured on the scrubbed string', () => {
  const out = redactArgs(['run', 'x'.repeat(500)]);
  assert.ok(out.length <= 200);
});

/* ---------- buildAudit ---------- */

test('buildAudit: anonymous run posts to /cli/command-log, no Authorization, with a machine hint', () => {
  const env = tmpConfigEnv({ SHAKERS_CLI_CERTS_BASE: 'https://certs.example/api/v1' });
  const audit = buildAudit('login', ['login', '--lang', 'en'], env);
  assert.equal(audit.endpoint, 'https://certs.example/api/v1/cli/command-log');
  assert.equal(audit.headers, null);
  assert.equal(audit.body.command, 'login');
  assert.equal(typeof audit.body.clientTimestamp, 'string');
  assert.ok('osUser' in audit.body && 'hostname' in audit.body);
});

test('buildAudit: authenticated run carries a Bearer and drops the machine hint', () => {
  const env = tmpConfigEnv({ SHAKERS_CLI_CERTS_BASE: 'https://certs.example/api/v1' });
  saveAuthSession({ accessToken: 'tok.abc', expiresAt: '2999-01-01T00:00:00.000Z' }, env);
  const audit = buildAudit('certify', ['certify'], env);
  assert.deepEqual(audit.headers, { Authorization: 'Bearer tok.abc' });
  assert.ok(!('osUser' in audit.body));
  assert.ok(!('hostname' in audit.body));
});

test('buildAudit: command defaults to "unknown" and is capped at 100 chars', () => {
  const env = tmpConfigEnv({ SHAKERS_CLI_CERTS_BASE: 'https://certs.example/api/v1' });
  assert.equal(buildAudit(null, [], env).body.command, 'unknown');
  assert.equal(buildAudit('x'.repeat(300), [], env).body.command.length, 100);
});

/* ---------- emitCommandAudit ---------- */

test('emitCommandAudit: posts the record once to /cli/command-log and resolves', async () => {
  const received = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  try {
    const env = tmpConfigEnv({ SHAKERS_CLI_CERTS_BASE: baseOf(server) });
    saveAuthSession({ accessToken: 'tok.xyz', expiresAt: '2999-01-01T00:00:00.000Z' }, env);
    await emitCommandAudit({ command: 'report', argv: ['report'], env });
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/api/v1/cli/command-log');
    assert.equal(received[0].auth, 'Bearer tok.xyz');
    assert.equal(received[0].body.command, 'report');
  } finally {
    server.close();
  }
});

test('emitCommandAudit: a 500 from the backend never rejects (fire-and-forget)', async () => {
  const server = await startServer((req, res) => {
    req.resume();
    res.writeHead(500);
    res.end('nope');
  });
  try {
    const env = tmpConfigEnv({ SHAKERS_CLI_CERTS_BASE: baseOf(server) });
    await assert.doesNotReject(emitCommandAudit({ command: 'login', argv: ['login'], env }));
  } finally {
    server.close();
  }
});

test('emitCommandAudit: an unreachable backend never rejects', async () => {
  const env = tmpConfigEnv({ SHAKERS_CLI_CERTS_BASE: 'http://127.0.0.1:1/api/v1' });
  await assert.doesNotReject(emitCommandAudit({ command: 'login', argv: ['login'], env }));
});
