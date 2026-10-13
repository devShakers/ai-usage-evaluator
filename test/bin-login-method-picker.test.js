'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { run, chooseLoginMethod, hasMethodFlag, parseArgs } = require('../bin/login');
const { getCatalog } = require('../src/i18n');
const { loadAuthSession, saveAuthSession } = require('../src/auth-session-store');
const { needle } = require('../test-fixtures/copy-needle');

// talents-ai-score, issue 122 follow-up: the interactive method picker (`login` with no --email/--google/--provider).

const c = getCatalog('es').login;

class FakeInput extends EventEmitter {
  setRawMode() {}
  resume() {}
  pause() {}
}
const nullOutput = { write() {} };

function keys(input, seq) {
  for (const k of seq) input.emit('data', Buffer.from(k));
}

function makeSharedAsk(lines = []) {
  const queue = [...lines];
  const fn = async () => (queue.length ? queue.shift() : '');
  fn.suspend = () => {};
  fn.resume = () => {};
  fn.close = () => {};
  return fn;
}

function withEnv(overrides, fn) {
  const keysToTouch = [
    'SHAKERS_CLI_CONFIG_DIR', 'AI_FOOTPRINT_CONFIG_DIR',
    'SHAKERS_CLI_INGEST_ENDPOINT', 'AI_FOOTPRINT_INGEST_ENDPOINT',
    'SHAKERS_CLI_HUB_BASE', 'SHAKERS_CLI_LOGIN_ENDPOINT',
    'SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT', 'SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT', 'SHAKERS_CLI_AUTH_TOKEN_ENDPOINT',
  ];
  const saved = Object.fromEntries(keysToTouch.map((k) => [k, process.env[k]]));
  for (const k of keysToTouch) delete process.env[k];
  Object.assign(process.env, overrides);
  const prevExit = process.exitCode;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of keysToTouch) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      process.exitCode = prevExit;
    });
}

const instantSleep = () => Promise.resolve();

// Device-flow broker (RFC 8628): authorize (/device/code), token poll (returns
// the SESSION access_token), and GET /auth/token exchanging it for the API JWT.
function startDeviceBroker() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.method === 'GET' && req.url.endsWith('/auth/token')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: 'JWT-via-picker' }));
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/device/code')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ device_code: 'DEV', user_code: 'ABCD-1234', verification_uri: 'https://h/d', verification_uri_complete: 'https://h/d?user_code=ABCD-1234', expires_in: 600, interval: 5 }));
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/device/token')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'SESS', token_type: 'Bearer', isNewUser: false }));
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

// --- parseArgs / hasMethodFlag -----------------------------------------------

test('hasMethodFlag: true for --email, --provider email, --google, --provider google; false for bare login', () => {
  assert.equal(hasMethodFlag(parseArgs([])), false);
  assert.equal(hasMethodFlag(parseArgs(['--email', 'a@b.com'])), true);
  assert.equal(hasMethodFlag(parseArgs(['--provider', 'email'])), true);
  assert.equal(hasMethodFlag(parseArgs(['--provider=email'])), true);
  assert.equal(hasMethodFlag(parseArgs(['--google'])), true);
  assert.equal(hasMethodFlag(parseArgs(['--provider', 'google'])), true);
  assert.equal(hasMethodFlag(parseArgs(['--provider=google'])), true);
});

// --- chooseLoginMethod, in isolation (mirrors interactive-select.test.js) ---

test('chooseLoginMethod: TTY + suspend-capable ask -> raw picker, enter on Email (cursor 0) returns "email"', async () => {
  const input = new FakeInput();
  const ask = makeSharedAsk();
  const p = chooseLoginMethod({ ask, stdinIsTTY: true, c, input, output: nullOutput });
  keys(input, ['\r']);
  assert.equal(await p, 'email');
});

test('chooseLoginMethod: TTY + suspend-capable ask -> down then enter picks Google', async () => {
  const input = new FakeInput();
  const ask = makeSharedAsk();
  const p = chooseLoginMethod({ ask, stdinIsTTY: true, c, input, output: nullOutput });
  keys(input, ['\x1b[B', '\r']);
  assert.equal(await p, 'google');
});

test('chooseLoginMethod: esc cancels the picker -> null (caller aborts, nothing sent)', async () => {
  const input = new FakeInput();
  const ask = makeSharedAsk();
  const p = chooseLoginMethod({ ask, stdinIsTTY: true, c, input, output: nullOutput });
  keys(input, ['\x1b']);
  assert.equal(await p, null);
});

test('chooseLoginMethod: TTY but ask has no suspend/resume -> numbered fallback, still interactive', async () => {
  // No .suspend/.resume: same shape as the standalone stdin-ask.js reader.
  const chunks = [];
  const output = { write: (s) => chunks.push(String(s)) };
  const ask = async () => '2'; // picks the second option (Google)
  const method = await chooseLoginMethod({ ask, stdinIsTTY: true, c, output });
  assert.equal(method, 'google');
  const printed = chunks.join('');
  assert.ok(printed.includes(needle(c.chooseMethodHeading)));
  assert.ok(printed.includes(needle(c.methodEmail)));
  assert.ok(printed.includes(needle(c.methodGoogle)));
});

test('chooseLoginMethod: TTY, no suspend, empty/invalid numbered answer -> null (cancelled)', async () => {
  const ask = async () => '';
  const method = await chooseLoginMethod({ ask, stdinIsTTY: true, c, output: nullOutput });
  assert.equal(method, null);
});

test('chooseLoginMethod: non-TTY -> "email" immediately, no prompt, ask never called', async () => {
  let called = false;
  const ask = async () => { called = true; return ''; };
  const method = await chooseLoginMethod({ ask, stdinIsTTY: false, c, output: nullOutput });
  assert.equal(method, 'email');
  assert.equal(called, false);
});

// --- run(): bare login wiring, TTY override + injected shared ask ----------

test('run(): bare login on a TTY shows the picker and routes EMAIL to the web device flow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-login-picker-'));
  const broker = await startDeviceBroker();
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
        const input = new FakeInput();
        const ask = makeSharedAsk();
        let opened = null;
        const runPromise = run(['--lang', 'es'], { ask, stdinIsTTY: true, input, output: nullOutput, openBrowser: (u) => { opened = u; }, sleep: instantSleep });
        // Give the picker a tick to attach before sending the key.
        await new Promise((r) => setImmediate(r));
        keys(input, ['\r']); // cursor is on "Email" (index 0)
        await runPromise;
        assert.match(opened, /provider=email/, 'email routes through the device flow, not a password form');
        assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }).accessToken, 'JWT-via-picker');
        assert.notEqual(process.exitCode, 1);
      },
    );
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run(): bare login on a TTY shows the picker and routes GOOGLE to the device flow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-login-picker-google-'));
  const broker = await startDeviceBroker();
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
        const input = new FakeInput();
        const ask = makeSharedAsk();
        const runPromise = run(['--lang', 'es'], {
          ask,
          stdinIsTTY: true,
          input,
          output: nullOutput,
          openBrowser: () => {},
          sleep: instantSleep,
        });
        await new Promise((r) => setImmediate(r));
        keys(input, ['\x1b[B', '\r']); // down to "Google", enter
        await runPromise;
        const sessionFile = path.join(dir, 'auth-session.json');
        assert.ok(fs.existsSync(sessionFile));
        assert.equal(JSON.parse(fs.readFileSync(sessionFile, 'utf8')).accessToken, 'JWT-via-picker');
        assert.notEqual(process.exitCode, 1);
      },
    );
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run(): esc on the picker cancels login silently — no request, exit stays clean', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-login-picker-cancel-'));
  try {
    await withEnv({ SHAKERS_CLI_CONFIG_DIR: dir, SHAKERS_CLI_INGEST_ENDPOINT: 'http://127.0.0.1:1/unused' }, async () => {
      process.exitCode = 0;
      const input = new FakeInput();
      const ask = makeSharedAsk(['should-not-be-read']);
      const runPromise = run(['--lang', 'es'], { ask, stdinIsTTY: true, input, output: nullOutput });
      await new Promise((r) => setImmediate(r));
      keys(input, ['\x1b']);
      await runPromise;
      assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }), null);
      assert.notEqual(process.exitCode, 1); // cancelling is not an error
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run(): an ACTIVE session short-circuits BEFORE the picker ever shows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-login-picker-active-'));
  saveAuthSession({ accessToken: 'existing', expiresAt: new Date(Date.now() + 60_000).toISOString() }, { SHAKERS_CLI_CONFIG_DIR: dir });
  try {
    await withEnv({ SHAKERS_CLI_CONFIG_DIR: dir }, async () => {
      const input = new FakeInput();
      // If the picker were shown, it would suspend/resume and wait on `input`;
      // an ask whose `.suspend` throws proves it never gets that far.
      const ask = async () => '';
      ask.suspend = () => { throw new Error('picker must not run when already logged in'); };
      ask.resume = () => {};
      const chunks = [];
      const output = { write: (s) => { chunks.push(String(s)); return true; } };
      await run(['--lang', 'es'], { ask, stdinIsTTY: true, input, output });
      assert.ok(chunks.join('').includes(needle(c.alreadyLoggedIn)));
      assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }).accessToken, 'existing');
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- run(): flags skip the picker, even on a TTY ----------------------------

test('run(): --email skips the picker even with stdinIsTTY:true (picker would throw if reached)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-login-flag-email-'));
  const broker = await startDeviceBroker();
  try {
    await withEnv(
      { SHAKERS_CLI_CONFIG_DIR: dir, SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: broker.authorizeEndpoint, SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: broker.tokenEndpoint, SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: broker.authTokenEndpoint },
      async () => {
        process.exitCode = 0;
        const ask = makeSharedAsk();
        ask.suspend = () => { throw new Error('picker must not run when --email is given'); };
        let opened = null;
        await run(['--email', 'flagged@example.com', '--lang', 'es'], { ask, stdinIsTTY: true, openBrowser: (u) => { opened = u; }, sleep: instantSleep });
        assert.match(opened, /provider=email/);
        assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }).accessToken, 'JWT-via-picker');
        assert.notEqual(process.exitCode, 1);
      },
    );
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run(): --provider email skips the picker and goes straight to the web device flow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-login-provider-email-'));
  const broker = await startDeviceBroker();
  try {
    await withEnv(
      { SHAKERS_CLI_CONFIG_DIR: dir, SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: broker.authorizeEndpoint, SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: broker.tokenEndpoint, SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: broker.authTokenEndpoint },
      async () => {
        process.exitCode = 0;
        const ask = makeSharedAsk();
        ask.suspend = () => { throw new Error('picker must not run when --provider email is given'); };
        let opened = null;
        await run(['--provider', 'email', '--lang', 'es'], { ask, stdinIsTTY: true, openBrowser: (u) => { opened = u; }, sleep: instantSleep });
        assert.match(opened, /provider=email/);
        assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }).accessToken, 'JWT-via-picker');
        assert.notEqual(process.exitCode, 1);
      },
    );
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run(): --google skips the picker regardless of stdinIsTTY (goes straight to the device flow)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-login-flag-google-'));
  const broker = await startDeviceBroker();
  try {
    await withEnv(
      { SHAKERS_CLI_CONFIG_DIR: dir, SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: broker.authorizeEndpoint, SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: broker.tokenEndpoint, SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: broker.authTokenEndpoint },
      async () => {
        process.exitCode = 0;
        // No `ask` at all: the --google branch returns before any ask/picker
        // is ever created, exactly as before this feature existed.
        await run(['--google', '--lang', 'es'], { stdinIsTTY: true, openBrowser: () => {}, sleep: instantSleep });
        const sessionFile = path.join(dir, 'auth-session.json');
        assert.ok(fs.existsSync(sessionFile));
        assert.equal(JSON.parse(fs.readFileSync(sessionFile, 'utf8')).accessToken, 'JWT-via-picker');
      },
    );
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run(): non-TTY caller with no flags never sees the picker and defaults to the email device flow', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-login-non-tty-'));
  const broker = await startDeviceBroker();
  try {
    await withEnv(
      { SHAKERS_CLI_CONFIG_DIR: dir, SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: broker.authorizeEndpoint, SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: broker.tokenEndpoint, SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: broker.authTokenEndpoint },
      async () => {
        process.exitCode = 0;
        const ask = makeSharedAsk();
        ask.suspend = () => { throw new Error('picker must not run on a non-TTY caller'); };
        let opened = null;
        await run(['--lang', 'es'], { ask, stdinIsTTY: false, openBrowser: (u) => { opened = u; }, sleep: instantSleep });
        assert.match(opened, /provider=email/);
        assert.equal(loadAuthSession({ SHAKERS_CLI_CONFIG_DIR: dir }).accessToken, 'JWT-via-picker');
        assert.notEqual(process.exitCode, 1);
      },
    );
  } finally {
    broker.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
