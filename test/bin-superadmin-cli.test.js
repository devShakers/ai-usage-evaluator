'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const path = require('path');

// ADR-027: the `superadmin` command opens a NON-PROD, password-authenticated session and persists the returned token locally.

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

function runCli(server, args, { configDir, stdin = '' } = {}) {
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
    child.stdin.write(stdin);
    child.stdin.end();
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
    '--lang', 'en', '--email', 'a@b.com',
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
      '--lang', 'en', '--email', 'Admin@Shakers.test',
    ], { stdin: 'secret\n' });
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
    res.end(JSON.stringify({ code: 'usage.superadmin_password_invalid' }));
  });
  try {
    const { code, stderr, configDir } = await runCli(server, [
      '--lang', 'en', '--email', 'admin@shakers.test',
    ], { stdin: 'wrong\n' });
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
      '--lang', 'en', '--email', 'admin@shakers.test',
    ], { stdin: 'x\n' });
    assert.equal(code, 1);
    assert.match(stderr, /disabled outside non-production/);
  } finally {
    server.close();
  }
});

// Security hardening (three-way review): --password no longer exists as a flag at all.
test('--password is NOT a recognized flag — it is ignored, never sent, and never persisted', async () => {
  let received = null;
  const server = await startStub((body, res) => {
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: 't', email: body.email, expiresAt: null }));
  });
  try {
    const { code, stderr, configDir } = await runCli(server, [
      '--lang', 'en', '--email', 'admin@shakers.test', '--password', 'smuggled-in-argv',
    ]); // no stdin piped
    assert.equal(code, 1);
    assert.match(stderr, /Password and email are required/);
    assert.equal(received, null, 'a request must never be sent from an unrecognized --password flag with no real input');
    assert.equal(readSession(configDir), null);
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

// ADR-058, "conmutador de perfil vía superadmin" (dueño, 2026-08-12): a dev/testing convenience — flip between `talent`/`external` without reinstalling.

function seedSession(configDir, extra = {}) {
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ superadminSession: { token: 't', email: 'a@b.com', expiresAt: '2999-01-01T00:00:00.000Z' }, ...extra }),
  );
}

test('an existing VALID superadmin session skips the password re-prompt entirely -- straight to the profile picker', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
  seedSession(configDir);
  const { code, stdout } = await runCli(null, ['--lang', 'en'], { configDir, stdin: '' }); // NOTHING piped
  assert.equal(code, 0);
  assert.equal(stdout.includes('Superadmin password'), false, 'must never re-ask for the password with a valid session on disk');
  assert.match(stdout, /What do you want to do\?/);
  assert.match(stdout, /Switch to Talent profile.*current/s);
  assert.match(stdout, /Switch to External profile/);
});

test('picker: cancelling (empty answer, non-TTY numbered fallback) changes NOTHING -- never hangs', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
  seedSession(configDir);
  fs.writeFileSync(path.join(configDir, 'report-state.json'), '{"x":1}');
  const { code, stdout } = await runCli(null, ['--lang', 'en'], { configDir, stdin: '' });
  assert.equal(code, 0);
  assert.match(stdout, /Cancelled\. Nothing was changed\./);
  assert.equal(readSession(configDir).token, 't', 'the superadmin session itself must survive');
  assert.ok(fs.existsSync(path.join(configDir, 'report-state.json')), 'nothing is purged on cancel');
});

test('picker: picking the CURRENT profile is a no-op -- no write, no purge', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
  seedSession(configDir); // no `profile` key -> defaults to talent
  fs.writeFileSync(path.join(configDir, 'consent.json'), '{"consent":"granted"}');
  const { code, stdout } = await runCli(null, ['--lang', 'en'], { configDir, stdin: '1\n' }); // 1 = Talent = current
  assert.equal(code, 0);
  assert.match(stdout, /already on the Talent profile/);
  assert.ok(fs.existsSync(path.join(configDir, 'consent.json')), 'nothing is purged when the choice is a no-op');
});

test('picker: switching profile writes `profile` in config.json AND purges report-state/consent/auth-session, but KEEPS ingestEndpoint + superadminSession', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      ingestEndpoint: 'http://localhost:3004/api/v1/usage/reports',
      superadminSession: { token: 't', email: 'a@b.com', expiresAt: '2999-01-01T00:00:00.000Z' },
    }),
  );
  fs.writeFileSync(path.join(configDir, 'report-state.json'), '{"x":1}');
  fs.writeFileSync(path.join(configDir, 'consent.json'), '{"consent":"granted"}');
  fs.writeFileSync(path.join(configDir, 'auth-session.json'), '{"accessToken":"tok"}');

  const { code, stdout } = await runCli(null, ['--lang', 'en'], { configDir, stdin: '2\n' }); // 2 = External
  assert.equal(code, 0);
  assert.match(stdout, /Profile switched to External/);
  assert.match(stdout, /takes effect immediately, no restart needed/i);
  assert.equal(stdout.includes('restart the shell'), false);

  const config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.profile, 'external');
  assert.equal(config.ingestEndpoint, 'http://localhost:3004/api/v1/usage/reports', 'the endpoint must survive the switch');
  assert.equal(config.superadminSession.token, 't', 'the superadmin session must survive the switch');

  assert.equal(fs.existsSync(path.join(configDir, 'report-state.json')), false);
  assert.equal(fs.existsSync(path.join(configDir, 'consent.json')), false);
  assert.equal(fs.existsSync(path.join(configDir, 'auth-session.json')), false);
});

test('picker: switching the OTHER direction (external -> talent) also works, from a seeded profile:"external"', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-cli-'));
  seedSession(configDir, { profile: 'external' });
  const { code, stdout } = await runCli(null, ['--lang', 'en'], { configDir, stdin: '1\n' }); // 1 = Talent
  assert.equal(code, 0);
  assert.match(stdout, /Profile switched to Talent/);
  const config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.profile, 'talent');
});

test('WITHOUT a superadmin session, a WRONG password never reaches the profile picker', async () => {
  const server = await startStub((_body, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'usage.superadmin_password_invalid' }));
  });
  try {
    const { code, stdout, stderr } = await runCli(server, ['--lang', 'en', '--email', 'admin@shakers.test'], { stdin: 'wrong\n' });
    assert.equal(code, 1);
    assert.match(stderr, /Incorrect superadmin password/);
    assert.equal(stdout.includes('What do you want to do?'), false, 'the picker must never be reached without a valid session');
  } finally {
    server.close();
  }
});

test('opening a FRESH session successfully leads straight into the profile picker -- byte-identical open-session copy first', async () => {
  const server = await startStub((body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: 'payload.sig', email: body.email, expiresAt: '2999-01-01T00:00:00.000Z' }));
  });
  try {
    const { code, stdout, configDir } = await runCli(server, ['--lang', 'en', '--email', 'admin@shakers.test'], {
      stdin: 'secret\n2\n', // password, then pick External
    });
    assert.equal(code, 0);
    // The EXISTING open-session copy still shows, unchanged, BEFORE the picker.
    assert.match(stdout, /Superadmin session opened/);
    assert.match(stdout, /certify --email <anyone>/);
    // ...followed by the NEW picker, and the switch actually happened.
    assert.match(stdout, /What do you want to do\?/);
    assert.match(stdout, /Profile switched to External/);
    const config = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    assert.equal(config.profile, 'external');
    assert.equal(config.superadminSession.token, 'payload.sig');
  } finally {
    server.close();
  }
});

test('--inspect mode NEVER reaches the profile picker (unrelated, stateless per-call auth)', async () => {
  const server = await startStub((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ certifications: [] }));
  });
  try {
    const { code, stdout } = await runCli(server, ['--lang', 'en', '--inspect', '--email', 'a@b.com'], { stdin: 'pw\n' });
    assert.equal(code, 0);
    assert.equal(stdout.includes('What do you want to do?'), false);
  } finally {
    server.close();
  }
});
