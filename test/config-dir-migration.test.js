'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getConfigDir,
  defaultConfigDir,
  legacyConfigDir,
  migrateLegacyConfigDir,
  rewriteConfigEndpoints,
} = require('../src/config-dir');

// ADR-045: the config dir moved ~/.config/ai-footprint -> ~/.config/shakers and the override env AI_FOOTPRINT_CONFIG_DIR -> SHAKERS_CLI_CONFIG_DIR (compat).

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-cfgmig-'));
}

/* ---------------- the resolver (compat) ---------------- */

test('getConfigDir: new default is ~/.config/shakers under the resolved home', () => {
  const home = tmpHome();
  assert.equal(getConfigDir({ SHAKERS_CLI_HOME_DIR: home }), path.join(home, '.config', 'shakers'));
});

test('getConfigDir: SHAKERS_CLI_CONFIG_DIR wins, and legacy AI_FOOTPRINT_CONFIG_DIR still works', () => {
  assert.equal(getConfigDir({ SHAKERS_CLI_CONFIG_DIR: '/x/new' }), '/x/new');
  assert.equal(getConfigDir({ AI_FOOTPRINT_CONFIG_DIR: '/x/old' }), '/x/old');
  // New wins when both are set.
  assert.equal(getConfigDir({ SHAKERS_CLI_CONFIG_DIR: '/x/new', AI_FOOTPRINT_CONFIG_DIR: '/x/old' }), '/x/new');
});

/* ---------------- the URL rewrite (endpoint rename) ---------------- */

test('rewriteConfigEndpoints: only string VALUES are rewritten, structure untouched, bad JSON passes through', () => {
  const before = JSON.stringify({
    ingestEndpoint: 'https://hub/api/v1/ai-footprint/reports',
    loginEndpoint: 'https://hub/api/v1/auth/login/email',
    note: 'plain text with no url',
  });
  const after = JSON.parse(rewriteConfigEndpoints(before));
  assert.equal(after.ingestEndpoint, 'https://hub/api/v1/usage/reports');
  assert.equal(after.loginEndpoint, 'https://hub/api/v1/auth/login/email', 'auth path is NOT renamed');
  assert.equal(after.note, 'plain text with no url');
  // Unparseable input is returned verbatim (fail-safe).
  assert.equal(rewriteConfigEndpoints('{ not json'), '{ not json');
});

/* ---------------- the migration ---------------- */

test('migrateLegacyConfigDir: copies the whole legacy dir once and rewrites config.json URLs', () => {
  const home = tmpHome();
  const env = { SHAKERS_CLI_HOME_DIR: home };
  const legacy = legacyConfigDir(env);
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(
    path.join(legacy, 'config.json'),
    JSON.stringify({ ingestEndpoint: 'https://hub/api/v1/ai-footprint/reports' }),
  );
  fs.writeFileSync(path.join(legacy, 'consent.json'), JSON.stringify({ consent: 'granted', email: 'a@b.c' }));
  // The session file is a 0600 bearer capability — mode must survive the copy.
  fs.writeFileSync(path.join(legacy, 'auth-session.json'), JSON.stringify({ accessToken: 'jwt', version: 1 }), { mode: 0o600 });
  fs.chmodSync(path.join(legacy, 'auth-session.json'), 0o600);

  const res = migrateLegacyConfigDir(env);
  assert.equal(res.migrated, true);

  const dest = defaultConfigDir(env);
  // config.json copied AND rewritten to the new endpoint segment.
  const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8'));
  assert.equal(cfg.ingestEndpoint, 'https://hub/api/v1/usage/reports');
  // consent copied verbatim (nobody re-consents).
  const consent = JSON.parse(fs.readFileSync(path.join(dest, 'consent.json'), 'utf8'));
  assert.equal(consent.consent, 'granted');
  assert.equal(consent.email, 'a@b.c');
  // session copied AND the 0600 mode preserved (nobody re-logs-in, no leak).
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'auth-session.json'), 'utf8')).accessToken, 'jwt');
  assert.equal(fs.statSync(path.join(dest, 'auth-session.json')).mode & 0o777, 0o600);

  // Idempotent: a second boot does nothing (the one-time marker is present).
  const again = migrateLegacyConfigDir(env);
  assert.equal(again.migrated, false);
  assert.equal(again.reason, 'already-migrated');
});

test('migrateLegacyConfigDir: the REAL install->run path — install wrote a default config.json first, migration must still bring consent/session and let the OLD config win', () => {
  const home = tmpHome();
  const env = { SHAKERS_CLI_HOME_DIR: home };
  const legacy = legacyConfigDir(env);
  const dest = defaultConfigDir(env);

  // 1) install.sh writes a DEFAULT config.json into the NEW dir before first boot.
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'config.json'), '{\n  "ingestEndpoint": "http://localhost:3004/api/v1/usage/reports"\n}\n', { mode: 0o600 });

  // 2) The Talent's REAL pre-upgrade state lives in the OLD dir: a CUSTOM
  //    endpoint (not the default) plus consent and a login session.
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ ingestEndpoint: 'https://mine.example.com/api/v1/ai-footprint/reports' }));
  fs.writeFileSync(path.join(legacy, 'consent.json'), JSON.stringify({ consent: 'granted', email: 'talent@example.com' }));
  fs.writeFileSync(path.join(legacy, 'auth-session.json'), JSON.stringify({ accessToken: 'jwt', version: 1 }), { mode: 0o600 });
  fs.chmodSync(path.join(legacy, 'auth-session.json'), 0o600);

  // 3) First `shakers` boot after install.
  const res = migrateLegacyConfigDir(env);
  assert.equal(res.migrated, true);

  // consent + session were BROUGHT even though the new dir already existed (this
  // is exactly what the old dir-existence guard skipped -> the orphaned-state bug).
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'consent.json'), 'utf8')).consent, 'granted', 'consent must be migrated, not left orphaned');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'auth-session.json'), 'utf8')).accessToken, 'jwt', 'login session must be migrated (no re-login)');
  assert.equal(fs.statSync(path.join(dest, 'auth-session.json')).mode & 0o777, 0o600);

  // The Talent's OLD custom endpoint WINS over install's default, rewritten.
  const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8'));
  assert.equal(cfg.ingestEndpoint, 'https://mine.example.com/api/v1/usage/reports', 'the pre-upgrade custom endpoint must survive the upgrade, not be replaced by install default');

  // Strictly once: a later edit in the new dir is not clobbered by a re-run.
  fs.writeFileSync(path.join(dest, 'config.json'), JSON.stringify({ ingestEndpoint: 'https://edited.example.com/api/v1/usage/reports' }));
  const again = migrateLegacyConfigDir(env);
  assert.equal(again.migrated, false);
  assert.equal(again.reason, 'already-migrated');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8')).ingestEndpoint, 'https://edited.example.com/api/v1/usage/reports', 'a post-migration edit must not be re-clobbered');
});

test('migrateLegacyConfigDir: an explicit override is never migrated (the test seam)', () => {
  const home = tmpHome();
  const legacy = legacyConfigDir({ SHAKERS_CLI_HOME_DIR: home });
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'config.json'), '{}');
  // Override present -> the caller chose the location; do not migrate.
  const res = migrateLegacyConfigDir({ SHAKERS_CLI_HOME_DIR: home, SHAKERS_CLI_CONFIG_DIR: path.join(home, 'explicit') });
  assert.equal(res.migrated, false);
  assert.equal(res.reason, 'override');
  assert.equal(fs.existsSync(defaultConfigDir({ SHAKERS_CLI_HOME_DIR: home })), false);
});

test('migrateLegacyConfigDir: a fresh install (no legacy dir) is a clean no-op', () => {
  const home = tmpHome();
  const res = migrateLegacyConfigDir({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(res.migrated, false);
  assert.equal(res.reason, 'no-legacy');
  // Migration must not create the new dir out of nothing — first WRITE does that.
  assert.equal(fs.existsSync(defaultConfigDir({ SHAKERS_CLI_HOME_DIR: home })), false);
});
