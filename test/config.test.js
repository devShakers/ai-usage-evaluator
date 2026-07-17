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

// skill-code-certification, ADR-001: certify endpoint, same no-hardcode/
// no-default/env-var-only pattern. The DIFFERENCE is in how the caller
// treats null (actionable error vs silent degrade) — that lives in
// bin/certify.js, not here; this getter is a plain reader like the rest.

test('getCertifyEndpoint: unset env var -> null', () => {
  assert.equal(getCertifyEndpoint({}), null);
});

test('getCertifyEndpoint: reads AI_FOOTPRINT_CERTIFY_ENDPOINT, trimmed', () => {
  const env = { AI_FOOTPRINT_CERTIFY_ENDPOINT: '  https://hub.example.com/works/ai-footprint/skill-certification  ' };
  assert.equal(getCertifyEndpoint(env), 'https://hub.example.com/works/ai-footprint/skill-certification');
});

test('getCertifyEndpoint: empty/whitespace-only value -> null', () => {
  assert.equal(getCertifyEndpoint({ AI_FOOTPRINT_CERTIFY_ENDPOINT: '' }), null);
  assert.equal(getCertifyEndpoint({ AI_FOOTPRINT_CERTIFY_ENDPOINT: '   ' }), null);
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
