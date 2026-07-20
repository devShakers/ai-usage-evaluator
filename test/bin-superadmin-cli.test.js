'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const path = require('path');

/*
 * skill-code-certification ADR-021: the `superadmin` command provisions a
 * NON-PROD test identity. Runs the real binary as a process (it calls run() on
 * load) against a tiny stub returning canned statuses, asserting the
 * status -> UX/exit mapping. The password is collected + sent, never validated
 * client-side (the backend owns that) — so these only assert wiring.
 */

const BIN = path.join(__dirname, '..', 'bin', 'superadmin.js');

function startStub(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => handler(JSON.parse(raw || '{}'), res));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function ingestBase(server) {
  const { port } = server.address();
  // The command derives the provisioning URL as a sibling of the ingest base.
  return `http://127.0.0.1:${port}/works/ai-footprint/reports`;
}

function runCli(server, args) {
  return new Promise((resolve, reject) => {
    // Isolate the persistent config so a machine-baked endpoint (installer
    // default) can't leak in — the no-endpoint case must see a truly empty one.
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
    const env = {
      ...process.env,
      AI_FOOTPRINT_CONFIG_DIR: configDir,
      AI_FOOTPRINT_INGEST_ENDPOINT: server ? ingestBase(server) : '',
    };
    const child = spawn(process.execPath, [BIN, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('no endpoint configured -> actionable error, exit 1', async () => {
  const { code, stderr } = await runCli(null, [
    '--lang', 'en', '--password', 'x', '--email', 'a@b.com',
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /No endpoint configured/);
});

test('success -> prints the certify next-step and exits 0', async () => {
  let received;
  const server = await startStub((body, res) => {
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ talentId: 't1', email: body.email, reused: false }));
  });
  try {
    const { code, stdout } = await runCli(server, [
      '--lang', 'en', '--password', 'secret', '--email', 'Test@Example.com',
    ]);
    assert.equal(code, 0);
    // password + normalized email are sent to the backend
    assert.equal(received.password, 'secret');
    assert.equal(received.email, 'test@example.com');
    assert.match(stdout, /Test identity ready for test@example\.com/);
    assert.match(stdout, /certify --email test@example\.com/);
  } finally {
    server.close();
  }
});

test('ADR-023: --author-domain and --author-emails are sent, and the authoring line is shown', async () => {
  let received;
  const server = await startStub((body, res) => {
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      talentId: 't1',
      email: body.email,
      reused: false,
      authorizedAuthoring: { domain: 'shakersworks.com', extraEmails: ['c@x.com'] },
    }));
  });
  try {
    const { code, stdout } = await runCli(server, [
      '--lang', 'en', '--password', 'secret', '--email', 'bot@shakers.test',
      '--author-domain', 'shakersworks.com', '--author-emails', 'c@x.com, d@y.com',
    ]);
    assert.equal(code, 0);
    assert.equal(received.authorDomain, 'shakersworks.com');
    assert.deepEqual(received.extraEmails, ['c@x.com', 'd@y.com']);
    assert.match(stdout, /Authorized authoring .*domain @shakersworks\.com/);
  } finally {
    server.close();
  }
});

test('reused -> prints the idempotent message', async () => {
  const server = await startStub((body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ talentId: 't1', email: body.email, reused: true }));
  });
  try {
    const { code, stdout } = await runCli(server, [
      '--lang', 'en', '--password', 'secret', '--email', 'test@example.com',
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /already existed/);
  } finally {
    server.close();
  }
});

test('403 -> wrong-password error, exit 1', async () => {
  const server = await startStub((_body, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'ai-footprint.superadmin_password_invalid' }));
  });
  try {
    const { code, stderr } = await runCli(server, [
      '--lang', 'en', '--password', 'wrong', '--email', 'test@example.com',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /Incorrect superadmin password/);
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
      '--lang', 'en', '--password', 'x', '--email', 'test@example.com',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /disabled outside non-production/);
  } finally {
    server.close();
  }
});

test('409 -> real-account conflict error, exit 1', async () => {
  const server = await startStub((_body, res) => {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'ai-footprint.test_talent_email_conflict' }));
  });
  try {
    const { code, stderr } = await runCli(server, [
      '--lang', 'en', '--password', 'x', '--email', 'real@example.com',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /already belongs to a real/);
  } finally {
    server.close();
  }
});

// --- teardown (ADR-022) ------------------------------------------------------

test('--remove --email -> sends {password,email} to the teardown route, reports removed', async () => {
  let received;
  const server = await startStub((body, res) => {
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ removed: [{ talentId: 't1', email: body.email }], count: 1 }));
  });
  try {
    const { code, stdout } = await runCli(server, [
      '--lang', 'en', '--remove', '--password', 'secret', '--email', 'Test@Example.com',
    ]);
    assert.equal(code, 0);
    assert.equal(received.password, 'secret');
    assert.equal(received.email, 'test@example.com');
    assert.equal(received.all, undefined);
    assert.match(stdout, /Removed 1 test identity\(ies\): test@example\.com/);
  } finally {
    server.close();
  }
});

test('--remove --all -> sends {password, all:true}, reports the emails', async () => {
  let received;
  const server = await startStub((body, res) => {
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      removed: [{ talentId: 'a', email: 'a@test.com' }, { talentId: 'b', email: 'b@test.com' }],
      count: 2,
    }));
  });
  try {
    const { code, stdout } = await runCli(server, [
      '--lang', 'en', '--remove', '--all', '--password', 'secret',
    ]);
    assert.equal(code, 0);
    assert.equal(received.all, true);
    assert.equal(received.email, undefined);
    assert.match(stdout, /Removed 2 test identity\(ies\): a@test\.com, b@test\.com/);
  } finally {
    server.close();
  }
});

test('--remove with count 0 -> clean no-op message, exit 0', async () => {
  const server = await startStub((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ removed: [], count: 0 }));
  });
  try {
    const { code, stdout } = await runCli(server, [
      '--lang', 'en', '--remove', '--email', 'ghost@example.com', '--password', 'secret',
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /no test identity to remove/);
  } finally {
    server.close();
  }
});

test('--remove --email on a REAL account (409) -> refused message, exit 1', async () => {
  const server = await startStub((_body, res) => {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'ai-footprint.test_talent_email_conflict' }));
  });
  try {
    const { code, stderr } = await runCli(server, [
      '--lang', 'en', '--remove', '--email', 'real@example.com', '--password', 'secret',
    ]);
    assert.equal(code, 1);
    assert.match(stderr, /belongs to a REAL \(non-test\) account/);
  } finally {
    server.close();
  }
});
