'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  readCache,
  writeCache,
  isSuppressed,
  maybeNotify,
  triggerBackgroundCheck,
  CHECK_INTERVAL_MS,
} = require('../src/update-notifier');
const { getCatalog } = require('../src/i18n');

function tmpEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-notif-'));
  return { SHAKERS_CLI_CONFIG_DIR: dir, ...extra };
}

/* ---------- isSuppressed ---------- */

test('isSuppressed: opt-out env var, CI, non-TTY, --json and the update command all suppress', () => {
  const tty = { stdoutIsTTY: true, env: {} };
  assert.equal(isSuppressed({ ...tty, env: { SHAKERS_CLI_NO_UPDATE_NOTIFIER: '1' } }), true);
  assert.equal(isSuppressed({ ...tty, env: { CI: 'true' } }), true);
  assert.equal(isSuppressed({ env: {}, stdoutIsTTY: false }), true);
  assert.equal(isSuppressed({ ...tty, argv: ['run', '--json'] }), true);
  assert.equal(isSuppressed({ ...tty, command: 'update' }), true);
});

test('isSuppressed: an interactive TTY run of a normal command is NOT suppressed', () => {
  assert.equal(isSuppressed({ env: {}, stdoutIsTTY: true, argv: ['run'], command: 'ai-usage' }), false);
});

/* ---------- readCache / writeCache ---------- */

test('writeCache then readCache round-trips { lastCheck, latest }', () => {
  const env = tmpEnv();
  assert.equal(writeCache({ lastCheck: 123, latest: '9.9.9' }, env), true);
  assert.deepEqual(readCache(env), { lastCheck: 123, latest: '9.9.9' });
});

test('readCache: a missing or corrupt cache is null, never a throw', () => {
  const env = tmpEnv();
  assert.equal(readCache(env), null);
  fs.mkdirSync(env.SHAKERS_CLI_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.SHAKERS_CLI_CONFIG_DIR, 'update-check.json'), '{bad json');
  assert.equal(readCache(env), null);
});

/* ---------- maybeNotify ---------- */

test('maybeNotify: prints the notice when the cached latest beats the installed version', () => {
  const env = tmpEnv();
  writeCache({ lastCheck: Date.now(), latest: '2.0.0' }, env);
  let printed = '';
  const ret = maybeNotify({ currentVersion: '1.0.0', lang: 'en', env, out: (s) => (printed += s) });
  const t = getCatalog('en').cli.updateNotifier;
  assert.equal(ret, t.available('1.0.0', '2.0.0'));
  assert.ok(printed.includes(t.howTo));
});

test('maybeNotify: no notice when already up to date, when there is no cache, or no current version', () => {
  const env = tmpEnv();
  writeCache({ lastCheck: Date.now(), latest: '1.0.0' }, env);
  assert.equal(maybeNotify({ currentVersion: '1.0.0', lang: 'en', env, out: () => {} }), null);
  assert.equal(maybeNotify({ currentVersion: '1.0.0', lang: 'en', env: tmpEnv(), out: () => {} }), null);
  assert.equal(maybeNotify({ currentVersion: null, lang: 'en', env, out: () => {} }), null);
});

/* ---------- triggerBackgroundCheck (no-spawn branches) ---------- */

test('triggerBackgroundCheck: no package name returns false without spawning', () => {
  assert.equal(triggerBackgroundCheck({ env: tmpEnv() }), false);
});

test('triggerBackgroundCheck: a cache younger than the interval returns false without spawning', () => {
  const env = tmpEnv();
  writeCache({ lastCheck: Date.now() - CHECK_INTERVAL_MS / 2, latest: '1.0.0' }, env);
  assert.equal(triggerBackgroundCheck({ name: '@shakers/cli', env }), false);
});
