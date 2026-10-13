'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, runLogout } = require('../bin/login');
const { loadAuthSession, saveAuthSession } = require('../src/auth-session-store');

// EMAIL login now travels the SAME web device flow (RFC 8628) as Google/LinkedIn
// (only the `provider` query differs): the Talent reuses their open web session
// or signs in on the /cli-login page, so no password is ever read in the
// terminal. These tests drive the real `run()` against a mock Hub broker.
//
// Every test routes the CLI's own stdout through `capture` so its human-facing
// lines never interleave with node:test's TAP stream.

// Mock Hub broker: device authorize (/device/code), token poll (returns the
// SESSION access_token), and GET /auth/token exchanging it for the API JWT.
function startBroker({ pendingPolls = 0, loginEmail = null, isNewUser = false } = {}) {
  let polls = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.method === 'GET' && req.url.endsWith('/auth/token')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'API-JWT' }));
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/device/code')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          device_code: 'DEV-SECRET',
          user_code: 'ABCD-1234',
          verification_uri: 'https://hub.test/cli-login',
          verification_uri_complete: 'https://hub.test/cli-login?user_code=ABCD-1234',
          expires_in: 600,
          interval: 5,
        }));
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/device/token')) {
        if (polls < pendingPolls) {
          polls += 1;
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'authorization_pending' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'SESS', token_type: 'Bearer', isNewUser, ...(loginEmail ? { email: loginEmail } : {}) }));
        return;
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, authorizeEndpoint: `${base}/device/code`, tokenEndpoint: `${base}/device/token`, authTokenEndpoint: `${base}/auth/token` });
    });
  });
}

function withEnv(overrides, fn) {
  const keys = ['SHAKERS_CLI_CONFIG_DIR', 'AI_FOOTPRINT_CONFIG_DIR', 'SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT', 'SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT', 'SHAKERS_CLI_AUTH_TOKEN_ENDPOINT', 'SHAKERS_CLI_HUB_BASE', 'SHAKERS_CLI_INGEST_ENDPOINT', 'AI_FOOTPRINT_INGEST_ENDPOINT'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, overrides);
  const prevExit = process.exitCode;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      process.exitCode = prevExit;
    });
}

const instantSleep = () => Promise.resolve();

// An injected stdout sink: `run()` writes its human-facing lines here instead of
// the process stdout, so the CLI's output never interleaves with node:test's TAP.
function sink() {
  const chunks = [];
  return { write: (s) => { chunks.push(String(s)); return true; }, text: () => chunks.join('') };
}

// Run the CLI in-process with an injected output sink, recording the URL it would open.
async function runCli(args, { throwOnOpen = false } = {}) {
  const out = sink();
  let opened = null;
  await run(args, {
    output: out,
    openBrowser: throwOnOpen ? () => { throw new Error('browser must not open'); } : (u) => { opened = u; },
    sleep: instantSleep,
  });
  return { out: out.text(), opened };
}

async function runLogoutCli(args) {
  const out = sink();
  await runLogout(args, { output: out });
  return out.text();
}

const deviceEnv = (dir, broker) => ({
  SHAKERS_CLI_CONFIG_DIR: dir,
  SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: broker.authorizeEndpoint,
  SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: broker.tokenEndpoint,
  SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: broker.authTokenEndpoint,
});

test('login --provider email: runs the device flow, opens the /cli-login URL with provider=email, persists the session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  const broker = await startBroker({ pendingPolls: 2 });
  try {
    await withEnv(deviceEnv(dir, broker), async () => {
      process.exitCode = 0;
      const { opened } = await runCli(['--provider', 'email', '--lang', 'en']);
      const sessionFile = path.join(dir, 'auth-session.json');
      assert.ok(fs.existsSync(sessionFile), 'a session file must be written');
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      assert.equal(session.accessToken, 'API-JWT');
      assert.equal(session.cookie ?? null, null, 'the device flow carries no cookie (no password sign-in)');
      assert.equal(fs.statSync(sessionFile).mode & 0o777, 0o600);
      assert.match(opened, /^https:\/\/hub\.test\/cli-login\?/, 'the complete verification URL is opened');
      assert.match(opened, /provider=email/, 'the web /cli-login page is told to offer email sign-in');
      assert.notEqual(process.exitCode, 1);
    });
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('login --email <addr>: also routes to the device flow (the address is not used to authenticate)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  const broker = await startBroker();
  try {
    await withEnv(deviceEnv(dir, broker), async () => {
      process.exitCode = 0;
      // No stdin is provided: a password prompt would hang here. It does not, because
      // the email method opens the web device flow instead of reading a password.
      const { opened } = await runCli(['--email', 'typed@example.com', '--lang', 'en']);
      assert.match(opened, /provider=email/, 'the address is ignored; the web /cli-login page handles identity');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'auth-session.json'), 'utf8')).accessToken, 'API-JWT');
      assert.notEqual(process.exitCode, 1);
    });
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('login email: the prompt states no password is needed and shows the code', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  const broker = await startBroker();
  try {
    await withEnv(deviceEnv(dir, broker), async () => {
      process.exitCode = 0;
      const { out } = await runCli(['--provider', 'email', '--lang', 'en']);
      assert.match(out, /no password needed/i, 'the Talent is told no password is needed');
      assert.match(out, /ABCD-1234/, 'the user code is shown');
    });
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('login email: persists the RESPONSE email when the broker sends one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  const broker = await startBroker({ loginEmail: 'talent@example.com' });
  try {
    await withEnv(deviceEnv(dir, broker), async () => {
      process.exitCode = 0;
      await runCli(['--provider', 'email', '--lang', 'en']);
      const session = JSON.parse(fs.readFileSync(path.join(dir, 'auth-session.json'), 'utf8'));
      assert.equal(session.accessToken, 'API-JWT');
      assert.equal(session.email, 'talent@example.com');
      assert.notEqual(process.exitCode, 1);
    });
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('login email: an unreachable device endpoint -> exit 1, no session, browser never opened', async () => {
  // The device endpoints ALWAYS resolve (the baked flavor profile is the default —
  // ADR-065), so there is no "no endpoint" path. Point them at a refused loopback
  // port to prove the CLI fails loudly (exit 1) and never opens a browser or
  // persists a session when the authorize call cannot be reached.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  try {
    await withEnv(
      {
        SHAKERS_CLI_CONFIG_DIR: dir,
        SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: 'http://127.0.0.1:1/auth/device/code',
        SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: 'http://127.0.0.1:1/works/auth/device/token',
        SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: 'http://127.0.0.1:1/auth/token',
      },
      async () => {
        process.exitCode = 0;
        await runCli(['--provider', 'email', '--lang', 'en'], { throwOnOpen: true });
        assert.equal(process.exitCode, 1);
        assert.equal(fs.existsSync(path.join(dir, 'auth-session.json')), false);
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an ACTIVE session is not silently overwritten: email login says so and leaves it intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  saveAuthSession({ accessToken: 'existing', expiresAt: new Date(Date.now() + 60_000).toISOString() }, { SHAKERS_CLI_CONFIG_DIR: dir });
  const broker = await startBroker();
  try {
    await withEnv(deviceEnv(dir, broker), async () => {
      const { out } = await runCli(['--provider', 'email', '--lang', 'es'], { throwOnOpen: true });
      assert.match(out, /Ya has iniciado/);
      assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }).accessToken, 'existing');
    });
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an EXPIRED session is told before the flow, then a fresh email login replaces it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  saveAuthSession({ accessToken: 'stale', expiresAt: new Date(Date.now() - 1000).toISOString() }, { SHAKERS_CLI_CONFIG_DIR: dir });
  const broker = await startBroker();
  try {
    await withEnv(deviceEnv(dir, broker), async () => {
      process.exitCode = 0;
      const { out } = await runCli(['--provider', 'email', '--lang', 'es']);
      assert.match(out, /caducó/);
      assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }).accessToken, 'API-JWT');
    });
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('logout clears the session, and logout with no session says there was nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  saveAuthSession({ accessToken: 'x', expiresAt: null }, { SHAKERS_CLI_CONFIG_DIR: dir });
  await withEnv({ SHAKERS_CLI_CONFIG_DIR: dir }, async () => {
    const out1 = await runLogoutCli(['--lang', 'es']);
    assert.match(out1, /cerrada/);
    assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }), null);
    const out2 = await runLogoutCli(['--lang', 'es']);
    assert.match(out2, /ninguna sesión/);
  });
});

test('logout also wipes consent.json so the next account cannot inherit the previous identity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-elogin-'));
  saveAuthSession({ accessToken: 'token-of-A', expiresAt: null }, { SHAKERS_CLI_CONFIG_DIR: dir });
  const consentFile = path.join(dir, 'consent.json');
  fs.writeFileSync(consentFile, JSON.stringify({ email: 'a@account.com', emailVerified: true, consent: 'granted', lastSentAt: null }));
  await withEnv({ SHAKERS_CLI_CONFIG_DIR: dir }, async () => {
    const out = await runLogoutCli(['--lang', 'es']);
    assert.match(out, /cerrada/);
    assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }), null);
    assert.equal(fs.existsSync(consentFile), false);
  });
});
