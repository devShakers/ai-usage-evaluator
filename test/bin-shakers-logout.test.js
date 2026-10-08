'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { saveAuthSession, loadAuthSession } = require('../src/auth-session-store');

// Runs the REAL installed entry point `bin/shakers.js` so the logout path exercises the command dispatcher (not just bin/login.js directly).

const BIN = path.join(__dirname, '..', 'bin', 'shakers.js');

function runCli(args, { configDir } = {}) {
  return new Promise((resolve, reject) => {
    const dir = configDir || fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-shakers-logout-'));
    const env = {
      ...process.env,
      AI_FOOTPRINT_CONFIG_DIR: dir,
      SHAKERS_CLI_INGEST_ENDPOINT: '',
      AI_FOOTPRINT_INGEST_ENDPOINT: '',
      SHAKERS_CLI_LOGIN_ENDPOINT: '',
      SHAKERS_CLI_AUTH_TOKEN_ENDPOINT: '',
      SHAKERS_CLI_HUB_BASE: '',
      AI_FOOTPRINT_HUB_BASE: '',
      SHAKERS_CLI_LANG: 'es', // force Spanish UI deterministically (OS display language no longer inferred from LANG)
      LC_ALL: 'es_ES.UTF-8',
      LANG: 'es_ES.UTF-8',
      LANGUAGE: 'es',
    };
    const child = spawn(process.execPath, [BIN, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, configDir: dir }));
    child.stdin.end('');
  });
}

test('`shakers logout` clears session AND consent.json even when the stored session is EXPIRED/invalid (no early-return)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-shakers-logout-'));
  saveAuthSession({ accessToken: 'expired-jwt', expiresAt: new Date(Date.now() - 60_000).toISOString() }, { AI_FOOTPRINT_CONFIG_DIR: dir });
  const consentFile = path.join(dir, 'consent.json');
  fs.writeFileSync(consentFile, JSON.stringify({ email: 'a@account.com', emailVerified: true, consent: 'granted', lastSentAt: null }));

  const r = await runCli(['logout'], { configDir: dir });

  assert.match(r.stdout, /cerrada/);
  assert.equal(loadAuthSession({ AI_FOOTPRINT_CONFIG_DIR: dir }), null);
  assert.equal(fs.existsSync(consentFile), false);
});
