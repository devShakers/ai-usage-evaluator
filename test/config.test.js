'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getIngestEndpoint,
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getCertifyEndpoint,
  getEmailVerificationRequestUrl,
  getEmailVerificationVerifyUrl,
  validateEndpoint,
  setIngestEndpoint,
  resolveIngestEndpoint,
  loadConfigFile,
  configFilePath,
  getSuperadminSessionEndpoint,
  loadSuperadminSession,
  saveSuperadminSession,
  clearSuperadminSession,
} = require('../src/config');

// A throwaway, guaranteed-empty config dir so getIngestEndpoint's config-file
// fallback can never read the developer's real ~/.config/ai-footprint. Every
// env used below that must resolve to "no endpoint" carries one of these.
function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-config-'));
}

/*
 * talents-ai-score, ADR-010/011: the agent-synthesis endpoint follows the
 * exact same no-hardcode, no-default, env-var-only pattern as the existing
 * ingestion endpoint (getIngestEndpoint) — unset means "nothing configured",
 * never a compiled-in fallback, never a kill-switch flag (ADR-011 retires
 * flags entirely).
 */

test('getSynthesisEndpoint: unset env var -> null', () => {
  assert.equal(getSynthesisEndpoint({}), null);
});

// --- ADR-027 superadmin session (endpoint derivation + persistence) ----------

test('getSuperadminSessionEndpoint: derived as a sibling of the ingest endpoint', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/works/ai-footprint/reports' };
  assert.equal(
    getSuperadminSessionEndpoint(env),
    'https://hub.example.com/works/ai-footprint/superadmin/session',
  );
});

test('superadmin session persistence: save -> load round-trips; clear removes it', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  assert.equal(loadSuperadminSession(env), null);

  saveSuperadminSession(
    { email: 'admin@shakers.test', token: 'p.sig', expiresAt: '2999-01-01T00:00:00.000Z' },
    env,
  );
  const s = loadSuperadminSession(env);
  assert.equal(s.token, 'p.sig');
  assert.equal(s.email, 'admin@shakers.test');

  clearSuperadminSession(env);
  assert.equal(loadSuperadminSession(env), null);
});

test('loadSuperadminSession: an EXPIRED session reads back as null (treated as no session)', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  saveSuperadminSession(
    { email: 'admin@shakers.test', token: 'p.sig', expiresAt: '2000-01-01T00:00:00.000Z' },
    env,
  );
  assert.equal(loadSuperadminSession(env), null);
});

test('saving the superadmin session preserves an existing ingest endpoint in config.json', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  setIngestEndpoint('https://hub.example.com/works/ai-footprint/reports', env);
  saveSuperadminSession({ email: 'a@b.com', token: 't', expiresAt: null }, env);
  const cfg = loadConfigFile(env);
  assert.equal(cfg.ingestEndpoint, 'https://hub.example.com/works/ai-footprint/reports');
  assert.equal(cfg.superadminSession.token, 't');
});

test('getSynthesisEndpoint: reads AI_FOOTPRINT_SYNTHESIS_ENDPOINT, trimmed', () => {
  const env = { AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '  https://hub.example.com/works/ai-footprint/agent-synthesis  ' };
  assert.equal(getSynthesisEndpoint(env), 'https://hub.example.com/works/ai-footprint/agent-synthesis');
});

test('getSynthesisEndpoint: empty/whitespace-only value -> null', () => {
  assert.equal(getSynthesisEndpoint({ AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '' }), null);
  assert.equal(getSynthesisEndpoint({ AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '   ' }), null);
});

// talents-ai-score, ADR-015: roadmap personalization endpoint, same
// no-hardcode/no-default/env-var-only pattern.

test('getRoadmapEndpoint: unset env var -> null', () => {
  assert.equal(getRoadmapEndpoint({}), null);
});

test('getRoadmapEndpoint: reads AI_FOOTPRINT_ROADMAP_ENDPOINT, trimmed', () => {
  const env = { AI_FOOTPRINT_ROADMAP_ENDPOINT: '  https://hub.example.com/works/ai-footprint/roadmap  ' };
  assert.equal(getRoadmapEndpoint(env), 'https://hub.example.com/works/ai-footprint/roadmap');
});

test('getRoadmapEndpoint: empty/whitespace-only value -> null', () => {
  assert.equal(getRoadmapEndpoint({ AI_FOOTPRINT_ROADMAP_ENDPOINT: '' }), null);
  assert.equal(getRoadmapEndpoint({ AI_FOOTPRINT_ROADMAP_ENDPOINT: '   ' }), null);
});

// skill-code-certification, ADR-001 + endpoint-config unification: certify
// resolves from the explicit AI_FOOTPRINT_CERTIFY_ENDPOINT override first, then
// derives as a sibling of the resolved ingest endpoint (env > config.json), so
// a single ingest config drives certify too. `unset` here means: no certify
// var AND no ingest configured -> null (bin/certify.js turns that into an
// actionable error). Isolated config dir so the derivation can't read the
// dev's real ~/.config/ai-footprint.

test('getCertifyEndpoint: no certify var and no ingest -> null', () => {
  assert.equal(getCertifyEndpoint({ AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() }), null);
});

test('getCertifyEndpoint: explicit AI_FOOTPRINT_CERTIFY_ENDPOINT wins, trimmed', () => {
  const env = {
    AI_FOOTPRINT_CERTIFY_ENDPOINT: '  https://certify.example.com/skill-certification  ',
    AI_FOOTPRINT_INGEST_ENDPOINT: 'https://ingest.example.com/works/ai-footprint/reports',
  };
  assert.equal(getCertifyEndpoint(env), 'https://certify.example.com/skill-certification');
});

test('getCertifyEndpoint: empty/whitespace certify var falls through to ingest derivation', () => {
  const env = {
    AI_FOOTPRINT_CERTIFY_ENDPOINT: '   ',
    AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/api/v1/works/ai-footprint/reports',
  };
  assert.equal(getCertifyEndpoint(env), 'https://hub.example.com/api/v1/works/ai-footprint/skill-certification');
});

test('getCertifyEndpoint: derives sibling skill-certification from the ingest env var', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'http://localhost:3001/api/v1/works/ai-footprint/reports' };
  assert.equal(getCertifyEndpoint(env), 'http://localhost:3001/api/v1/works/ai-footprint/skill-certification');
});

test('getCertifyEndpoint: derives from the config-file ingest endpoint when no env var is set', () => {
  const dir = freshConfigDir();
  setIngestEndpoint('http://localhost:3001/api/v1/works/ai-footprint/reports', { AI_FOOTPRINT_CONFIG_DIR: dir });
  assert.equal(
    getCertifyEndpoint({ AI_FOOTPRINT_CONFIG_DIR: dir }),
    'http://localhost:3001/api/v1/works/ai-footprint/skill-certification',
  );
});

// skill-code-certification / ADR-006: the email-verification URLs introduce NO
// new env var — they are DERIVED as siblings of the ingest endpoint (email
// verification gates persistence, which targets the ingest URL; in the Hub
// both live in the same ai-footprint module).

test('getEmailVerification*Url: unset ingest env var -> null (nowhere to persist, nothing to verify for)', () => {
  // Isolated empty config dir so the config-file fallback can't leak a real
  // endpoint from the dev's home into this assertion.
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  assert.equal(getEmailVerificationRequestUrl(env), null);
  assert.equal(getEmailVerificationVerifyUrl(env), null);
});

test('getEmailVerification*Url: derives siblings of the ingest endpoint (last path segment replaced)', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/works/ai-footprint/reports' };
  assert.equal(
    getEmailVerificationRequestUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/request',
  );
  assert.equal(
    getEmailVerificationVerifyUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/verify',
  );
});

test('getEmailVerification*Url: robust to a trailing slash on the ingest endpoint', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/works/ai-footprint/reports/' };
  assert.equal(
    getEmailVerificationRequestUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/request',
  );
  assert.equal(
    getEmailVerificationVerifyUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/verify',
  );
});

test('getEmailVerification*Url: trims surrounding whitespace like the other getters', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: '  https://hub.example.com/works/ai-footprint/reports  ' };
  assert.equal(
    getEmailVerificationRequestUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/request',
  );
});

/*
 * Endpoint-config task: persistent config file + endpoint safety.
 *
 * Precedence: AI_FOOTPRINT_INGEST_ENDPOINT (env) > config.json > none. No
 * compiled-in default. A non-local host must be https (the endpoint decides
 * where sampled code is sent) — bounded scope: only that rule, no allowlist.
 */

test('validateEndpoint: accepts https to any host', () => {
  const r = validateEndpoint('https://hub.example.com/api/v1/works/ai-footprint/reports');
  assert.equal(r.ok, true);
  assert.equal(r.value, 'https://hub.example.com/api/v1/works/ai-footprint/reports');
  assert.equal(r.isLocal, false);
});

test('validateEndpoint: accepts http ONLY for localhost/127.0.0.1/::1', () => {
  assert.equal(validateEndpoint('http://localhost:8787/works/ai-footprint/reports').ok, true);
  assert.equal(validateEndpoint('http://127.0.0.1:3001/reports').ok, true);
  assert.equal(validateEndpoint('http://[::1]:3001/reports').ok, true);
});

test('validateEndpoint: rejects http to a non-local host (insecure-remote)', () => {
  const r = validateEndpoint('http://hub.example.com/reports');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insecure-remote');
});

test('validateEndpoint: rejects garbage and non-http(s) protocols', () => {
  assert.equal(validateEndpoint('not-a-url').reason, 'invalid-url');
  assert.equal(validateEndpoint('ftp://host/x').reason, 'bad-protocol');
  assert.equal(validateEndpoint('   ').reason, 'empty');
  assert.equal(validateEndpoint(null).reason, 'empty');
});

test('getIngestEndpoint: env var wins over config.json', () => {
  const dir = freshConfigDir();
  setIngestEndpoint('https://from-file.example.com/reports', { AI_FOOTPRINT_CONFIG_DIR: dir });
  const env = {
    AI_FOOTPRINT_CONFIG_DIR: dir,
    AI_FOOTPRINT_INGEST_ENDPOINT: 'https://from-env.example.com/reports',
  };
  assert.equal(getIngestEndpoint(env), 'https://from-env.example.com/reports');
});

test('getIngestEndpoint: falls back to config.json when env is unset', () => {
  const dir = freshConfigDir();
  setIngestEndpoint('https://from-file.example.com/reports', { AI_FOOTPRINT_CONFIG_DIR: dir });
  assert.equal(getIngestEndpoint({ AI_FOOTPRINT_CONFIG_DIR: dir }), 'https://from-file.example.com/reports');
});

test('getIngestEndpoint: no env, no config file -> null', () => {
  assert.equal(getIngestEndpoint({ AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() }), null);
});

test('getIngestEndpoint: ignores a hand-edited insecure remote endpoint in config.json', () => {
  const dir = freshConfigDir();
  // Write directly (bypass the validating setter) to simulate a hand edit.
  fs.writeFileSync(configFilePath({ AI_FOOTPRINT_CONFIG_DIR: dir }), JSON.stringify({ ingestEndpoint: 'http://evil.example.com/reports' }));
  assert.equal(getIngestEndpoint({ AI_FOOTPRINT_CONFIG_DIR: dir }), null);
});

test('setIngestEndpoint: persists a valid endpoint and refuses an insecure remote one', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  const ok = setIngestEndpoint('https://hub.example.com/reports', env);
  assert.equal(ok.ok, true);
  assert.equal(loadConfigFile(env).ingestEndpoint, 'https://hub.example.com/reports');

  const bad = setIngestEndpoint('http://hub.example.com/reports', env);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'insecure-remote');
  // The prior good value must survive a rejected set.
  assert.equal(loadConfigFile(env).ingestEndpoint, 'https://hub.example.com/reports');
});

test('resolveIngestEndpoint: reports the source (env / config-file / config-file-invalid / none)', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  assert.deepEqual(resolveIngestEndpoint(env), { endpoint: null, source: 'none' });

  setIngestEndpoint('https://hub.example.com/reports', env);
  const fromFile = resolveIngestEndpoint(env);
  assert.equal(fromFile.source, 'config-file');
  assert.equal(fromFile.endpoint, 'https://hub.example.com/reports');

  const fromEnv = resolveIngestEndpoint({ ...env, AI_FOOTPRINT_INGEST_ENDPOINT: 'https://env.example.com/reports' });
  assert.equal(fromEnv.source, 'env');
  assert.equal(fromEnv.endpoint, 'https://env.example.com/reports');

  fs.writeFileSync(configFilePath(env), JSON.stringify({ ingestEndpoint: 'http://evil.example.com/reports' }));
  const invalid = resolveIngestEndpoint(env);
  assert.equal(invalid.source, 'config-file-invalid');
  assert.equal(invalid.endpoint, null);
});

test('audit: a single ingestEndpoint in config.json drives footprint + OTP + certify to the same base', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  // The installer's baked default — localhost, so it passes https-for-non-local.
  setIngestEndpoint('http://localhost:3001/api/v1/works/ai-footprint/reports', env);

  assert.equal(getIngestEndpoint(env), 'http://localhost:3001/api/v1/works/ai-footprint/reports');
  assert.equal(getEmailVerificationRequestUrl(env), 'http://localhost:3001/api/v1/works/ai-footprint/email-verification/request');
  assert.equal(getEmailVerificationVerifyUrl(env), 'http://localhost:3001/api/v1/works/ai-footprint/email-verification/verify');
  assert.equal(getCertifyEndpoint(env), 'http://localhost:3001/api/v1/works/ai-footprint/skill-certification');
});
