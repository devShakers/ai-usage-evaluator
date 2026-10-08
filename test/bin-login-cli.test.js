'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { loadAuthSession, saveAuthSession } = require('../src/auth-session-store');

// Runs the REAL `login`/`logout` binary as a child process against a tiny stub, asserting the status -> message + exit-code + local-session-persistence mapping.

const BIN = path.join(__dirname, '..', 'bin', 'login.js');
const COOKIE = 'better-auth.session_token=sess-xyz';

function baseUrl(server) { return `http://127.0.0.1:${server.address().port}/api/v1`; }
function signInUrl(server) { return `${baseUrl(server)}/auth/sign-in/email`; }
function tokenUrl(server) { return `${baseUrl(server)}/auth/token`; }

// A successful sign-in: sets the session cookie and (optionally) echoes the
// authenticated user's email.
const signInOk = (email) => (body, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'set-cookie': `${COOKIE}; Max-Age=604800; Path=/; HttpOnly` });
  res.end(JSON.stringify({ redirect: false, user: { id: 'u1', email: email || null } }));
};
const tokenReturning = (jwt) => (res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ token: jwt })); };

// Routes GET /auth/token to `onToken` (default: a canned JWT) and every other
// request (the sign-in POST) to `onSignIn`, recording the sign-in body.
function startStub({ onSignIn, onToken } = {}) {
  const seen = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.method === 'GET' && req.url.includes('/auth/token')) {
          (onToken || tokenReturning('jwt-live'))(res, req);
        } else {
          let body = {};
          try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
          seen.push(body);
          onSignIn(body, res, req);
        }
      });
    });
    server.listen(0, '127.0.0.1', () => { server._seen = seen; resolve(server); });
  });
}

function runCli(server, args, { configDir, stdin = '', extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const dir = configDir || fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-login-cli-'));
    const env = {
      ...process.env,
      AI_FOOTPRINT_CONFIG_DIR: dir,
      SHAKERS_CLI_LOGIN_ENDPOINT: server ? signInUrl(server) : '',
      SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: server ? tokenUrl(server) : '',
      SHAKERS_CLI_HUB_BASE: '',
      AI_FOOTPRINT_HUB_BASE: '',
      SHAKERS_CLI_INGEST_ENDPOINT: '',
      AI_FOOTPRINT_INGEST_ENDPOINT: '',
      SHAKERS_CLI_LANG: 'es', // force Spanish UI deterministically (OS display language no longer inferred from LANG)
      LC_ALL: 'es_ES.UTF-8',
      LANG: 'es_ES.UTF-8',
      LANGUAGE: 'es',
      ...extraEnv,
    };
    const child = spawn(process.execPath, [BIN, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, configDir: dir }));
    child.stdin.end(stdin);
  });
}

test('login happy path: sends {email,password}, persists the session (JWT + cookie), tells the Talent what changed', async () => {
  const server = await startStub({ onSignIn: signInOk('talent@example.com'), onToken: tokenReturning('jwt-live') });
  try {
    const r = await runCli(server, [], { stdin: 'talent@example.com\nhunter2\n' });
    assert.equal(r.code, 0);
    assert.deepEqual(server._seen[0], { email: 'talent@example.com', password: 'hunter2' });
    const session = loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: r.configDir });
    assert.equal(session.accessToken, 'jwt-live');
    assert.equal(session.cookie, COOKIE);
    assert.match(r.stdout, /certificarte/);
    assert.equal(/hunter2/.test(r.stdout + r.stderr), false);
  } finally {
    server.close();
  }
});

test('login prefers the RESPONSE email over the typed one when the server sends it', async () => {
  const server = await startStub({ onSignIn: signInOk('canonical@example.com'), onToken: tokenReturning('jwt-live') });
  try {
    const r = await runCli(server, [], { stdin: 'typed@example.com\nhunter2\n' });
    assert.equal(r.code, 0);
    const session = loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: r.configDir });
    assert.equal(session.email, 'canonical@example.com');
  } finally {
    server.close();
  }
});

test('login persists the typed (normalized) email when the server omits it', async () => {
  const server = await startStub({ onSignIn: signInOk(null), onToken: tokenReturning('jwt-live') });
  try {
    const r = await runCli(server, [], { stdin: 'Talent@Example.com\nhunter2\n' });
    assert.equal(r.code, 0);
    const session = loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: r.configDir });
    assert.equal(session.email, 'talent@example.com');
  } finally {
    server.close();
  }
});

test('login --email persists that (normalized) address too', async () => {
  const server = await startStub({ onSignIn: signInOk(null), onToken: tokenReturning('jwt-x') });
  try {
    const r = await runCli(server, ['--email', 'Flagged@Example.com'], { stdin: 'pw\n' });
    assert.equal(r.code, 0);
    const session = loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: r.configDir });
    assert.equal(session.email, 'flagged@example.com');
  } finally {
    server.close();
  }
});

test('a failed login persists NOTHING — no stray email left behind either', async () => {
  const server = await startStub({ onSignIn: (_b, res) => { res.writeHead(401); res.end('{}'); } });
  try {
    const r = await runCli(server, [], { stdin: 'a@b.com\nbad\n' });
    assert.equal(loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: r.configDir }), null);
  } finally {
    server.close();
  }
});

test('login --email skips the email prompt and only reads the password', async () => {
  const server = await startStub({ onSignIn: signInOk(null), onToken: tokenReturning('jwt-x') });
  try {
    const r = await runCli(server, ['--email', 'flagged@example.com'], { stdin: 'pw\n' });
    assert.equal(r.code, 0);
    assert.equal(server._seen[0].email, 'flagged@example.com');
    assert.equal(server._seen[0].password, 'pw');
  } finally {
    server.close();
  }
});

test('401 -> invalid-credentials message, non-zero exit, NOTHING persisted', async () => {
  const server = await startStub({ onSignIn: (_b, res) => { res.writeHead(401); res.end('{}'); } });
  try {
    const r = await runCli(server, [], { stdin: 'a@b.com\nbad\n' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Credenciales/);
    assert.equal(loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: r.configDir }), null);
  } finally {
    server.close();
  }
});

test('409 -> the Google/LinkedIn account gets an ACTIONABLE message, not a mute 401', async () => {
  const server = await startStub({ onSignIn: (_b, res) => { res.writeHead(409); res.end('{}'); } });
  try {
    const r = await runCli(server, [], { stdin: 'g@b.com\npw\n' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Google|LinkedIn/);
    assert.match(r.stderr, /web/);
  } finally {
    server.close();
  }
});

test('503 -> upstream message, distinct from bad credentials', async () => {
  const server = await startStub({ onSignIn: (_b, res) => { res.writeHead(503); res.end('{}'); } });
  try {
    const r = await runCli(server, [], { stdin: 'a@b.com\npw\n' });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /servidor de identidad/);
  } finally {
    server.close();
  }
});

test('an unreachable endpoint -> actionable error, never a silent no-op', async () => {
  // The login endpoint now ALWAYS resolves (the baked flavor profile is the
  // default — ADR-065 revised), so there is no longer a "no endpoint" path. Point
  // it at a refused loopback port to prove that when the endpoint cannot be
  // reached the CLI still fails loudly (exit 1), never a silent success. Offline:
  // 127.0.0.1:1 refuses the connection immediately.
  const r = await runCli(null, [], {
    stdin: 'a@b.com\npw\n',
    extraEnv: {
      SHAKERS_CLI_LOGIN_ENDPOINT: 'http://127.0.0.1:1/api/v1/auth/sign-in/email',
      SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:1/api/v1/auth/token',
    },
  });
  assert.equal(r.code, 1);
  assert.notEqual(r.stderr.trim(), '', 'the failure is reported, not silent');
});

test('an ACTIVE session is not silently overwritten: login says so and points at logout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-login-cli-'));
  saveAuthSession({ accessToken: 'existing', expiresAt: new Date(Date.now() + 60_000).toISOString() }, { AI_FOOTPRINT_CONFIG_DIR: dir });
  const server = await startStub({ onSignIn: signInOk(null), onToken: tokenReturning('new') });
  try {
    const r = await runCli(server, [], { stdin: 'a@b.com\npw\n', configDir: dir });
    assert.match(r.stdout, /Ya has iniciado/);
    assert.equal(loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: dir }).accessToken, 'existing');
  } finally {
    server.close();
  }
});

test('an EXPIRED session is told before prompting, then a fresh login replaces it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-login-cli-'));
  saveAuthSession({ accessToken: 'stale', expiresAt: new Date(Date.now() - 1000).toISOString() }, { AI_FOOTPRINT_CONFIG_DIR: dir });
  const server = await startStub({ onSignIn: signInOk(null), onToken: tokenReturning('fresh') });
  try {
    const r = await runCli(server, [], { stdin: 'a@b.com\npw\n', configDir: dir });
    assert.match(r.stdout, /caducó/);
    assert.equal(loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: dir }).accessToken, 'fresh');
  } finally {
    server.close();
  }
});

test('logout clears the session, and logout with no session says there was nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-login-cli-'));
  saveAuthSession({ accessToken: 'x', expiresAt: null }, { AI_FOOTPRINT_CONFIG_DIR: dir });
  const r1 = await runCli(null, ['logout'], { configDir: dir });
  assert.match(r1.stdout, /cerrada/);
  assert.equal(loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: dir }), null);
  const r2 = await runCli(null, ['logout'], { configDir: dir });
  assert.match(r2.stdout, /ninguna sesión/);
});

test('logout also wipes consent.json so the next account cannot inherit the previous identity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-login-cli-'));
  saveAuthSession({ accessToken: 'token-of-A', expiresAt: null }, { AI_FOOTPRINT_CONFIG_DIR: dir });
  const consentFile = path.join(dir, 'consent.json');
  fs.writeFileSync(consentFile, JSON.stringify({ email: 'a@account.com', emailVerified: true, consent: 'granted', lastSentAt: null }));
  const r = await runCli(null, ['logout'], { configDir: dir });
  assert.match(r.stdout, /cerrada/);
  assert.equal(loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: dir }), null);
  assert.equal(fs.existsSync(consentFile), false);
});
