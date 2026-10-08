'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../bin/login');

// Mock Hub broker: device authorize (/device/code), token poll (returns the
// SESSION access_token), and GET /auth/token exchanging it for the API JWT.
// `pendingPolls` token calls return authorization_pending first, exercising the
// poll loop. `loginEmail` mirrors the identity the broker returns.
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
          verification_uri: 'https://hub.test/device',
          verification_uri_complete: 'https://hub.test/device?user_code=ABCD-1234',
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
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      resolve({ server, authorizeEndpoint: `${base}/device/code`, tokenEndpoint: `${base}/device/token`, authTokenEndpoint: `${base}/auth/token` });
    });
  });
}

function withEnv(overrides, fn) {
  const keys = ['SHAKERS_CLI_CONFIG_DIR', 'SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT', 'SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT', 'SHAKERS_CLI_AUTH_TOKEN_ENDPOINT', 'SHAKERS_CLI_HUB_BASE', 'SHAKERS_CLI_INGEST_ENDPOINT', 'AI_FOOTPRINT_INGEST_ENDPOINT', 'AI_FOOTPRINT_CONFIG_DIR'];
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

test('login --google: runs the device flow, polls past pending, and persists the session (atomic 0600)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-glogin-'));
  const broker = await startBroker({ pendingPolls: 2 });
  try {
    await withEnv(
      {
        SHAKERS_CLI_CONFIG_DIR: dir,
        SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: broker.authorizeEndpoint,
        SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: broker.tokenEndpoint,
        SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: broker.authTokenEndpoint,
      },
      async () => {
        process.exitCode = 0;
        let opened = null;
        await run(['--google', '--lang', 'en'], { openBrowser: (u) => { opened = u; }, sleep: instantSleep });
        const sessionFile = path.join(dir, 'auth-session.json');
        assert.ok(fs.existsSync(sessionFile), 'a session file must be written');
        const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
        assert.equal(saved.accessToken, 'API-JWT');
        assert.equal(saved.email, null);
        assert.equal('email' in saved, true, 'email must be an explicit null, not simply absent');
        assert.equal(fs.statSync(sessionFile).mode & 0o777, 0o600);
        assert.match(opened, /^https:\/\/hub\.test\/device\?/, 'the complete verification URL is opened/printed');
        assert.match(opened, /provider=google/, 'the provider is appended for the /cli-login page');
        assert.notEqual(process.exitCode, 1);
      },
    );
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('login --google: persists the RESPONSE email when the broker sends one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-glogin-'));
  const broker = await startBroker({ loginEmail: 'talent@example.com' });
  try {
    await withEnv(
      {
        SHAKERS_CLI_CONFIG_DIR: dir,
        SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: broker.authorizeEndpoint,
        SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: broker.tokenEndpoint,
        SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: broker.authTokenEndpoint,
      },
      async () => {
        process.exitCode = 0;
        await run(['--google', '--lang', 'en'], { openBrowser: () => {}, sleep: instantSleep });
        const saved = JSON.parse(fs.readFileSync(path.join(dir, 'auth-session.json'), 'utf8'));
        assert.equal(saved.accessToken, 'API-JWT');
        assert.equal(saved.email, 'talent@example.com');
        assert.notEqual(process.exitCode, 1);
      },
    );
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('login --google: no device endpoint configured -> exit 1, no session written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-glogin-'));
  try {
    await withEnv({ SHAKERS_CLI_CONFIG_DIR: dir }, async () => {
      process.exitCode = 0;
      await run(['--google', '--lang', 'en'], { openBrowser: () => { throw new Error('must not open'); }, sleep: instantSleep });
      assert.equal(process.exitCode, 1);
      assert.equal(fs.existsSync(path.join(dir, 'auth-session.json')), false);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
