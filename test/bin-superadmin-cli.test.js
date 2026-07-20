'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const path = require('path');

/*
 * ADR-027: the `superadmin` command opens a NON-PROD, password-authenticated
 * session and persists the returned token locally. Runs the real binary as a
 * process against a tiny stub returning canned statuses, asserting the
 * status -> UX/exit mapping + local token persistence. The password is
 * collected + sent, never validated client-side (the backend owns that).
 */

const BIN = path.join(__dirname, '..', 'bin', 'superadmin.js');

function startStub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => handler(JSON.parse(raw || '{}'), res, req));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function ingestBase(server) {
  const { port } = server.address();
  // The command derives the session URL as a sibling of the ingest base.
  return `http://127.0.0.1:${port}/works/ai-footprint/reports`;
}

function runCli(server, args, { configDir } = {}) {
  return new Promise((resolve, reject) => {
    const dir = configDir || fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
    const env = {
      ...process.env,
      AI_FOOTPRINT_CONFIG_DIR: dir,
      AI_FOOTPRINT_INGEST_ENDPOINT: server ? ingestBase(server) : '',
    };
    const child = spawn(process.execPath, [BIN, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, configDir: dir }));
  });
}

function readSession(configDir) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    return cfg.superadminSession || null;
  } catch {
    return null;
  }
}

test('no endpoint configured -> actionable error, exit 1', async () => {
  const { code, stderr } = await runCli(null, [
    '--lang', 'en', '--password', 'x', '--email', 'a@b.com',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /No endpoint configured/);
});

test('open session -> sends {password,email}, persists the token, prints next step, exit 0', async () => {
  let received;
  const server = await startStub((body, res) => {
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      token: 'payload.sig',
      email: body.email,
      expiresAt: '2999-01-01T00:00:00.000Z',
    }));
  });
  try {
    const { code, stdout, configDir } = await runCli(server, [
      '--lang', 'en', '--password', 'secret', '--email', 'Admin@Shakers.test',
    ]);
    assert.equal(code, 0);
    assert.equal(received.password, 'secret');
    assert.equal(received.email, 'admin@shakers.test');
    assert.match(stdout, /Superadmin session opened/);
    assert.match(stdout, /certify --email <anyone>/);
    // Token persisted locally for certify to pick up.
    const s = readSession(configDir);
    assert.equal(s.token, 'payload.sig');
    assert.equal(s.email, 'admin@shakers.test');
    assert.equal(s.expiresAt, '2999-01-01T00:00:00.000Z');
  } finally {
    server.close();
  }
});

test('403 -> wrong-password error, exit 1, no token persisted', async () => {
  const server = await startStub((_body, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'ai-footprint.superadmin_password_invalid' }));
  });
  try {
    const { code, stderr, configDir } = await runCli(server, [
      '--lang', 'en', '--password', 'wrong', '--email', 'admin@shakers.test',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /Incorrect superadmin password/);
    assert.equal(readSession(configDir), null);
  } finally {
    server.close();
  }
});

test('404 -> disabled-in-prod error, exit 1', async () => {
  const server = await startStub((_body, res) => {
    res.writeHead(404);
    res.end('{}');
  });
  try {
    const { code, stderr } = await runCli(server, [
      '--lang', 'en', '--password', 'x', '--email', 'admin@shakers.test',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /disabled outside non-production/);
  } finally {
    server.close();
  }
});

test('--logout -> clears the stored session locally (no endpoint call), exit 0', async () => {
  // Seed a persisted session, then log out.
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ superadminSession: { token: 't', email: 'a@b.com', expiresAt: null } }),
  );
  const { code, stdout } = await runCli(null, ['--lang', 'en', '--logout'], { configDir });
  assert.equal(code, 0);
  assert.match(stdout, /session forgotten/i);
  assert.equal(readSession(configDir), null);
});
