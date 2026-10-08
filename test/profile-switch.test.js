'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { switchProfile, reportStatePath, consentStatePath } = require('../src/profile-switch');
const { authSessionPath } = require('../src/auth-session-store');
const { loadConfigFile } = require('../src/config');

// talents-ai-score, ADR-058 — "conmutador de perfil vía superadmin" (dueño, 2026-08-12).

function freshEnv() {
  return { AI_FOOTPRINT_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'profile-switch-')) };
}

test('switchProfile: an invalid target is refused, nothing written', () => {
  const env = freshEnv();
  const res = switchProfile('bogus', env);
  assert.deepEqual(res, { ok: false, reason: 'invalid-profile' });
  assert.equal(loadConfigFile(env).profile, undefined);
});

test('switchProfile: writes `profile` into config.json, preserving every OTHER key untouched', () => {
  const env = freshEnv();
  const { saveConfigFile } = require('../src/config');
  saveConfigFile({ ingestEndpoint: 'http://x', superadminSession: { token: 't', email: 'a@b.com', expiresAt: null } }, env);

  const res = switchProfile('external', env);
  assert.equal(res.ok, true);
  assert.equal(res.from, 'talent', 'no profile key yet -> reported as coming from talent (the default)');
  assert.equal(res.to, 'external');

  const config = loadConfigFile(env);
  assert.equal(config.profile, 'external');
  assert.equal(config.ingestEndpoint, 'http://x');
  assert.equal(config.superadminSession.token, 't');
});

test('switchProfile: `from` reflects an EXISTING explicit profile, not always "talent"', () => {
  const env = freshEnv();
  const { saveConfigFile } = require('../src/config');
  saveConfigFile({ profile: 'external' }, env);
  const res = switchProfile('talent', env);
  assert.equal(res.from, 'external');
  assert.equal(res.to, 'talent');
});

test('switchProfile: purges report-state.json, consent.json and auth-session.json', () => {
  const env = freshEnv();
  fs.writeFileSync(reportStatePath(env), '{"x":1}');
  fs.writeFileSync(consentStatePath(env), '{"consent":"granted"}');
  fs.writeFileSync(authSessionPath(env), '{"accessToken":"tok"}');

  const res = switchProfile('external', env);
  assert.deepEqual(res.purged, { reportState: true, consent: true, authSession: true });
  assert.equal(fs.existsSync(reportStatePath(env)), false);
  assert.equal(fs.existsSync(consentStatePath(env)), false);
  assert.equal(fs.existsSync(authSessionPath(env)), false);
});

test('switchProfile: purge is best-effort -- files that never existed are NOT an error', () => {
  const env = freshEnv();
  // Nothing seeded at all.
  const res = switchProfile('talent', env);
  assert.equal(res.ok, true);
  assert.deepEqual(res.purged, { reportState: false, consent: false, authSession: false });
});

test('switchProfile: NEVER touches ingestEndpoint or superadminSession, even across MULTIPLE switches', () => {
  const env = freshEnv();
  const { saveConfigFile } = require('../src/config');
  saveConfigFile({ ingestEndpoint: 'http://localhost:3004/api/v1/usage/reports', superadminSession: { token: 'stable', email: 'a@b.com', expiresAt: '2999-01-01T00:00:00.000Z' } }, env);

  switchProfile('external', env);
  switchProfile('talent', env);
  switchProfile('external', env);

  const config = loadConfigFile(env);
  assert.equal(config.profile, 'external');
  assert.equal(config.ingestEndpoint, 'http://localhost:3004/api/v1/usage/reports');
  assert.equal(config.superadminSession.token, 'stable');
});

test('switchProfile: has NO gate of its own -- it switches even with no superadminSession at all (the gate lives at the bin/superadmin.js call site)', () => {
  const env = freshEnv();
  const res = switchProfile('external', env);
  assert.equal(res.ok, true);
  assert.equal(loadConfigFile(env).profile, 'external');
});
