'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getCertsBase,
  getHubBase,
  getImportProfileEndpoint,
  getIngestEndpoint,
  getOnboardingInterviewsEndpoint,
  getTalentProfileUrl,
  sanitizeStaleBakedEndpoints,
  loadConfigFile,
  ENV_PROFILES,
} = require('../src/config');

// In this checkout the package name is `@shakers/shakers-cli`, so the baked
// flavor is `dev` unless SHAKERS_CLI_ENV overrides it.
const DEV = ENV_PROFILES.dev;
const STAGING = ENV_PROFILES.staging;

const runConfigCmd = require('../bin/config').run;

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shk-cfg-'));
}
function envIn(dir, extra = {}) {
  return { SHAKERS_CLI_CONFIG_DIR: dir, ...extra };
}
function writeConfig(dir, obj) {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(obj));
}

test('getCertsBase: env > config.json > derived-from-explicit-ingest > baked profile', () => {
  const dir = freshDir();
  // (a) no override anywhere -> baked flavor (dev in this checkout), never null.
  assert.equal(getCertsBase(envIn(dir)), DEV.certsBase);
  writeConfig(dir, { certsBase: 'http://localhost:9000/api/v1/' });
  assert.equal(getCertsBase(envIn(dir)), 'http://localhost:9000/api/v1');
  assert.equal(getCertsBase(envIn(dir, { SHAKERS_CLI_CERTS_BASE: 'https://certs.prod/api/v1' })), 'https://certs.prod/api/v1');
  const dir2 = freshDir();
  assert.equal(
    getCertsBase(envIn(dir2, { SHAKERS_CLI_INGEST_ENDPOINT: 'https://c.example/api/v1/usage/reports' })),
    'https://c.example/api/v1',
  );
});

test('getIngestEndpoint: explicit wins, else derived from certsBase, else from baked certsBase', () => {
  const dir = freshDir();
  // No override -> derives from the baked certs base (dev here).
  assert.equal(getIngestEndpoint(envIn(dir)), `${DEV.certsBase}/usage/reports`);
  writeConfig(dir, { certsBase: 'http://localhost:3004/api/v1' });
  assert.equal(getIngestEndpoint(envIn(dir)), 'http://localhost:3004/api/v1/usage/reports');
  assert.equal(
    getIngestEndpoint(envIn(dir, { SHAKERS_CLI_INGEST_ENDPOINT: 'https://x/api/v1/usage/reports' })),
    'https://x/api/v1/usage/reports',
  );
});

test('interviews resolve from the certs base', () => {
  const dir = freshDir();
  writeConfig(dir, { certsBase: 'http://localhost:3004/api/v1' });
  assert.equal(getOnboardingInterviewsEndpoint(envIn(dir)), 'http://localhost:3004/api/v1/interviews');
});

test('getHubBase and getTalentProfileUrl fall back to the baked profile when unset', () => {
  const dir = freshDir();
  // (a) nothing set -> baked flavor (dev in this checkout).
  assert.equal(getHubBase(envIn(dir)), DEV.hubBase);
  assert.equal(getTalentProfileUrl(envIn(dir)), DEV.profileUrl);
  // (b) an explicit override in config.json wins over the baked profile.
  writeConfig(dir, { hubBase: 'http://localhost:3001/api/v1', profileUrl: 'http://localhost:3000/talent/profile/' });
  assert.equal(getHubBase(envIn(dir)), 'http://localhost:3001/api/v1');
  assert.equal(getTalentProfileUrl(envIn(dir)), 'http://localhost:3000/talent/profile');
});

test('(c) env wins over config.json and the baked profile', () => {
  const dir = freshDir();
  writeConfig(dir, { hubBase: 'http://localhost:3001/api/v1' });
  assert.equal(getHubBase(envIn(dir, { SHAKERS_CLI_HUB_BASE: 'https://hub.prod/api/v1' })), 'https://hub.prod/api/v1');
  assert.equal(getCertsBase(envIn(dir, { SHAKERS_CLI_CERTS_BASE: 'https://certs.prod/api/v1' })), 'https://certs.prod/api/v1');
  assert.equal(getTalentProfileUrl(envIn(dir, { SHAKERS_CLI_PROFILE_URL: 'https://p.prod/login' })), 'https://p.prod/login');
});

test('derived endpoints follow the baked hub base with zero config', () => {
  const dir = freshDir();
  assert.equal(getImportProfileEndpoint(envIn(dir)), `${DEV.hubBase}/works/me/import-profile`);
  assert.equal(getOnboardingInterviewsEndpoint(envIn(dir)), `${DEV.certsBase}/interviews`);
});

test('(d) a config.json seeded by a PREVIOUS flavor is cleaned at boot, resolving the baked flavor', () => {
  // A staging-baked binary (SHAKERS_CLI_ENV=staging) inheriting a config.json left
  // behind by a prior dev install: the dev endpoints must be stripped as stale seeds.
  const dir = freshDir();
  writeConfig(dir, { certsBase: DEV.certsBase, hubBase: DEV.hubBase, profileUrl: DEV.profileUrl, lang: 'es' });
  const env = envIn(dir, { SHAKERS_CLI_ENV: 'staging' });
  assert.equal(sanitizeStaleBakedEndpoints(env), true, 'the stale dev endpoints are removed');
  const after = loadConfigFile(env);
  assert.equal(after.certsBase, undefined);
  assert.equal(after.hubBase, undefined);
  assert.equal(after.profileUrl, undefined);
  assert.equal(after.lang, 'es', 'non-endpoint keys are preserved');
  // Now the getters resolve the baked staging profile, not the stale dev one.
  assert.equal(getHubBase(env), STAGING.hubBase);
  assert.equal(getCertsBase(env), STAGING.certsBase);
  assert.equal(getTalentProfileUrl(env), STAGING.profileUrl);
  assert.equal(sanitizeStaleBakedEndpoints(env), false, 'second run is a no-op');
});

test('(e) a genuine user override (matching no known profile) is preserved by the boot sweep', () => {
  const dir = freshDir();
  writeConfig(dir, { hubBase: 'https://hub.prod/api/v1', certsBase: DEV.certsBase });
  const env = envIn(dir, { SHAKERS_CLI_ENV: 'staging' });
  assert.equal(sanitizeStaleBakedEndpoints(env), true);
  const after = loadConfigFile(env);
  assert.equal(after.hubBase, 'https://hub.prod/api/v1', 'real override untouched');
  assert.equal(after.certsBase, undefined, 'the stale dev seed is removed');
  assert.equal(getHubBase(env), 'https://hub.prod/api/v1');
  assert.equal(getCertsBase(env), STAGING.certsBase);
});

test('boot sweep leaves a config matching the BAKED flavor alone (not a foreign seed)', () => {
  const dir = freshDir();
  // dev-baked binary with dev endpoints in config: these match the baked flavor,
  // so they are not "stale" and must not be removed.
  writeConfig(dir, { hubBase: DEV.hubBase, certsBase: DEV.certsBase });
  const env = envIn(dir); // baked = dev in this checkout
  assert.equal(sanitizeStaleBakedEndpoints(env), false);
  assert.equal(loadConfigFile(env).hubBase, DEV.hubBase);
});

test('config command: set persists a base, get and list read it back', async () => {
  const dir = freshDir();
  const lines = [];
  const out = (s) => lines.push(s);
  await runConfigCmd(['set', 'hubBase', 'http://localhost:3001/api/v1'], { env: envIn(dir), out });
  assert.equal(loadConfigFile(envIn(dir)).hubBase, 'http://localhost:3001/api/v1');
  lines.length = 0;
  await runConfigCmd(['get', 'hubBase'], { env: envIn(dir), out });
  assert.match(lines.join(''), /localhost:3001/);
});

test('config command: unknown key is rejected (secrets can never be stored here)', async () => {
  const dir = freshDir();
  const lines = [];
  await runConfigCmd(['set', 'apiKey', 'sk-secret'], { env: envIn(dir), out: (s) => lines.push(s) });
  assert.match(lines.join(''), /unknown key|clave desconocida/);
  assert.equal(loadConfigFile(envIn(dir)).apiKey, undefined, 'a non-settable (secret) key is never written');
  process.exitCode = 0;
});

test('config command: a remote http endpoint is refused', async () => {
  const dir = freshDir();
  const lines = [];
  await runConfigCmd(['set', 'certsBase', 'http://evil.example.com/api'], { env: envIn(dir), out: (s) => lines.push(s) });
  assert.match(lines.join(''), /invalid value|valor invalido/);
  assert.equal(loadConfigFile(envIn(dir)).certsBase, undefined);
  process.exitCode = 0;
});

test('a migrated legacy hub ingest is ignored and the endpoints derive from certsBase', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-cfg-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    ingestEndpoint: 'http://localhost:3001/api/v1/works/usage/reports',
    certsBase: 'https://certs.example.com/api/v1',
  }));
  const env = { SHAKERS_CLI_CONFIG_DIR: dir };
  const cfg = require('../src/config');
  assert.equal(cfg.getIngestEndpoint(env), 'https://certs.example.com/api/v1/usage/reports');
  assert.equal(cfg.getAgentEvaluationEndpoint(env), 'https://certs.example.com/api/v1/usage/agent-evaluation');
});

test('the loopback ingest the old installer baked is ignored for the certsBase', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-cfg-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    ingestEndpoint: 'http://localhost:3004/api/v1/usage/reports',
    certsBase: 'https://certs.example.com/api/v1',
  }));
  const cfg = require('../src/config');
  assert.equal(cfg.getAgentEvaluationEndpoint({ SHAKERS_CLI_CONFIG_DIR: dir }), 'https://certs.example.com/api/v1/usage/agent-evaluation');
});

test('an explicit certs ingest is still honoured', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-cfg-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ingestEndpoint: 'https://other.example.com/api/v1/usage/reports' }));
  const cfg = require('../src/config');
  assert.equal(cfg.getIngestEndpoint({ SHAKERS_CLI_CONFIG_DIR: dir }), 'https://other.example.com/api/v1/usage/reports');
});
