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
  getSkillsDeclareEndpoint,
  getSkillsResolveAddableEndpoint,
  getSkillsResolveMatchedEndpoint,
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
  saveConfigFile,
  getProfile,
  isTalentProfile,
  VALID_PROFILES,
  ENV_PROFILES,
} = require('../src/config');
const config = require('../src/config');

// With no override anywhere, every derived endpoint now resolves from the baked
// flavor profile (ADR-065 revised). In this checkout the package name is
// `@shakers/shakers-cli`, so the baked flavor is `dev`.
const DEV_CERTS = ENV_PROFILES.dev.certsBase;

// A throwaway, guaranteed-empty config dir so getIngestEndpoint's config-file fallback can never read the developer's real ~/.config/ai-footprint.
function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-config-'));
}

// ISSUE 111 REWROTE THIS CONTRACT, and the stale wording is worth keeping in the diff: this block used to read "env-var-only … unset means nothing configured".

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
  setIngestEndpoint('https://hub.example.com/works/ai-footprint/reports', env, { confirmed: true });
  saveSuperadminSession({ email: 'a@b.com', token: 't', expiresAt: null }, env);
  const cfg = loadConfigFile(env);
  assert.equal(cfg.ingestEndpoint, 'https://hub.example.com/works/ai-footprint/reports');
  assert.equal(cfg.superadminSession.token, 't');
});

test('getSynthesisEndpoint: reads AI_FOOTPRINT_SYNTHESIS_ENDPOINT, trimmed', () => {
  const env = { AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '  https://hub.example.com/works/ai-footprint/agent-synthesis  ' };
  assert.equal(getSynthesisEndpoint(env), 'https://hub.example.com/works/ai-footprint/agent-synthesis');
});

test('getSynthesisEndpoint: an empty/whitespace-only override falls through to the derivation', () => {
  const dir = freshConfigDir();
  // With nothing explicit, it derives from the baked certs base (dev here).
  assert.equal(getSynthesisEndpoint({ AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '', AI_FOOTPRINT_CONFIG_DIR: dir }), `${DEV_CERTS}/usage/agent-synthesis`);
  assert.equal(getSynthesisEndpoint({ AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '   ', AI_FOOTPRINT_CONFIG_DIR: dir }), `${DEV_CERTS}/usage/agent-synthesis`);
  // With an ingest endpoint, a blank override must not shadow it — a blank value
  // is "unset", not "disabled" (ADR-011 retired the kill-switch model).
  const env = { AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '  ', AI_FOOTPRINT_INGEST_ENDPOINT: 'https://h/works/ai-footprint/reports' };
  assert.equal(getSynthesisEndpoint(env), 'https://h/works/ai-footprint/agent-synthesis');
});

// talents-ai-score, ADR-015: roadmap personalization endpoint, same
// no-hardcode/no-default/env-var-only pattern.

test('getRoadmapEndpoint: no env var AND no explicit ingest -> derives from the baked certs base', () => {
  assert.equal(getRoadmapEndpoint({ AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() }), `${DEV_CERTS}/usage/roadmap-personalize`);
});

test('getRoadmapEndpoint (issue 111): derived as an ingest sibling when the override is unset', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/works/ai-footprint/reports' };
  assert.equal(getRoadmapEndpoint(env), 'https://hub.example.com/works/ai-footprint/roadmap-personalize');
});

test('getRoadmapEndpoint: reads AI_FOOTPRINT_ROADMAP_ENDPOINT, trimmed', () => {
  const env = { AI_FOOTPRINT_ROADMAP_ENDPOINT: '  https://hub.example.com/works/ai-footprint/roadmap  ' };
  assert.equal(getRoadmapEndpoint(env), 'https://hub.example.com/works/ai-footprint/roadmap');
});

test('getRoadmapEndpoint: an empty/whitespace-only override falls through to the derivation', () => {
  const dir = freshConfigDir();
  assert.equal(getRoadmapEndpoint({ AI_FOOTPRINT_ROADMAP_ENDPOINT: '', AI_FOOTPRINT_CONFIG_DIR: dir }), `${DEV_CERTS}/usage/roadmap-personalize`);
  assert.equal(getRoadmapEndpoint({ AI_FOOTPRINT_ROADMAP_ENDPOINT: '   ', AI_FOOTPRINT_CONFIG_DIR: dir }), `${DEV_CERTS}/usage/roadmap-personalize`);
});

// skill-code-certification, ADR-001 + endpoint-config unification: certify
// resolves from the explicit AI_FOOTPRINT_CERTIFY_ENDPOINT override first, then
// derives as a sibling of the resolved ingest endpoint (env > config.json), so
// a single ingest config drives certify too. `unset` here means: no certify
// var AND no ingest configured -> null (bin/certify.js turns that into an
// actionable error). Isolated config dir so the derivation can't read the
// dev's real ~/.config/ai-footprint.


// talents-ai-score, ADR-054/055: `start`'s "Añadir skills" route — certs' own RELAY of the talent-facing hub endpoints.

test('getSkillsDeclareEndpoint: derives ../works/talents/me/skills/declare from the ingest endpoint', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/api/v1/usage/reports' };
  assert.equal(getSkillsDeclareEndpoint(env), 'https://hub.example.com/api/v1/works/talents/me/skills/declare');
});

test('getSkillsResolveAddableEndpoint: no override AND no explicit ingest -> derives from the baked certs base', () => {
  assert.equal(getSkillsResolveAddableEndpoint({ AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() }), `${DEV_CERTS}/works/talents/me/skills/resolve-addable`);
});

test('getSkillsResolveAddableEndpoint: derives ../works/talents/me/skills/resolve-addable from the ingest endpoint', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/api/v1/usage/reports' };
  assert.equal(getSkillsResolveAddableEndpoint(env), 'https://hub.example.com/api/v1/works/talents/me/skills/resolve-addable');
});

test('getSkillsDeclareEndpoint/getSkillsResolveAddableEndpoint: explicit env override wins, trimmed', () => {
  const env = {
    AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT: '  https://certs.example.com/skills/declare  ',
    AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT: '  https://certs.example.com/skills/resolve-addable  ',
    AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/api/v1/usage/reports',
  };
  assert.equal(getSkillsDeclareEndpoint(env), 'https://certs.example.com/skills/declare');
  assert.equal(getSkillsResolveAddableEndpoint(env), 'https://certs.example.com/skills/resolve-addable');
});

test('getSkillsDeclareEndpoint/getSkillsResolveAddableEndpoint: derives from the config-file ingest endpoint when no env var is set', () => {
  const dir = freshConfigDir();
  setIngestEndpoint('http://localhost:3001/api/v1/usage/reports', { AI_FOOTPRINT_CONFIG_DIR: dir });
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  assert.equal(getSkillsDeclareEndpoint(env), 'http://localhost:3001/api/v1/works/talents/me/skills/declare');
  assert.equal(getSkillsResolveAddableEndpoint(env), 'http://localhost:3001/api/v1/works/talents/me/skills/resolve-addable');
});

// talents-ai-score, ADR-059 follow-up (dueño, 2026-08-12): `resolve-matched` — same shape as `resolve-addable`, but returns EVERY matched technology regardless of declared status.
test('getSkillsResolveMatchedEndpoint: no override AND no explicit ingest -> derives from the baked certs base', () => {
  assert.equal(getSkillsResolveMatchedEndpoint({ AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() }), `${DEV_CERTS}/works/talents/me/skills/resolve-matched`);
});

test('getSkillsResolveMatchedEndpoint: derives ../works/talents/me/skills/resolve-matched from the ingest endpoint', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/api/v1/usage/reports' };
  assert.equal(getSkillsResolveMatchedEndpoint(env), 'https://hub.example.com/api/v1/works/talents/me/skills/resolve-matched');
});

test('getSkillsResolveMatchedEndpoint: explicit env override wins, trimmed', () => {
  const env = {
    AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT: '  https://certs.example.com/skills/resolve-matched  ',
    AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/api/v1/usage/reports',
  };
  assert.equal(getSkillsResolveMatchedEndpoint(env), 'https://certs.example.com/skills/resolve-matched');
});

test('getSkillsResolveMatchedEndpoint: derives from the config-file ingest endpoint when no env var is set', () => {
  const dir = freshConfigDir();
  setIngestEndpoint('http://localhost:3001/api/v1/usage/reports', { AI_FOOTPRINT_CONFIG_DIR: dir });
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  assert.equal(getSkillsResolveMatchedEndpoint(env), 'http://localhost:3001/api/v1/works/talents/me/skills/resolve-matched');
});

test('getSkillsResolveMatchedEndpoint is DISTINCT from getSkillsResolveAddableEndpoint -- never the same URL', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/api/v1/usage/reports' };
  assert.notEqual(getSkillsResolveMatchedEndpoint(env), getSkillsResolveAddableEndpoint(env));
});

test('getEmailVerification*Url: unset ingest env var -> derives siblings of the baked ingest endpoint', () => {
  // Isolated empty config dir: with no explicit override the ingest endpoint now
  // derives from the baked certs base (dev here), so the siblings resolve too.
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  assert.equal(getEmailVerificationRequestUrl(env), `${DEV_CERTS}/usage/email-verification/request`);
  assert.equal(getEmailVerificationVerifyUrl(env), `${DEV_CERTS}/usage/email-verification/verify`);
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

// Endpoint-config task: persistent config file + endpoint safety.

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
  setIngestEndpoint('https://from-file.example.com/reports', { AI_FOOTPRINT_CONFIG_DIR: dir }, { confirmed: true });
  const env = {
    AI_FOOTPRINT_CONFIG_DIR: dir,
    AI_FOOTPRINT_INGEST_ENDPOINT: 'https://from-env.example.com/reports',
  };
  assert.equal(getIngestEndpoint(env), 'https://from-env.example.com/reports');
});

test('getIngestEndpoint: falls back to config.json when env is unset', () => {
  const dir = freshConfigDir();
  setIngestEndpoint('https://from-file.example.com/reports', { AI_FOOTPRINT_CONFIG_DIR: dir }, { confirmed: true });
  assert.equal(getIngestEndpoint({ AI_FOOTPRINT_CONFIG_DIR: dir }), 'https://from-file.example.com/reports');
});

test('getIngestEndpoint: no env, no config file -> derives from the baked certs base', () => {
  assert.equal(getIngestEndpoint({ AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() }), `${DEV_CERTS}/usage/reports`);
});

test('getIngestEndpoint: ignores a hand-edited insecure remote endpoint in config.json, falling back to baked', () => {
  const dir = freshConfigDir();
  // Write directly (bypass the validating setter) to simulate a hand edit.
  fs.writeFileSync(configFilePath({ AI_FOOTPRINT_CONFIG_DIR: dir }), JSON.stringify({ ingestEndpoint: 'http://evil.example.com/reports' }));
  // The insecure value is ignored; the ingest now derives from the baked certs base instead of null.
  assert.equal(getIngestEndpoint({ AI_FOOTPRINT_CONFIG_DIR: dir }), `${DEV_CERTS}/usage/reports`);
});

test('setIngestEndpoint: persists a valid endpoint and refuses an insecure remote one', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  const ok = setIngestEndpoint('https://hub.example.com/reports', env, { confirmed: true });
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

  setIngestEndpoint('https://hub.example.com/reports', env, { confirmed: true });
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

test('audit: a single ingestEndpoint in config.json drives footprint + OTP to the same base', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  // A local certs on a dev machine: localhost, so it passes https-for-non-local.
  // (The old hub `/works/ai-footprint/reports` default is ignored now: no service has it.)
  setIngestEndpoint('http://localhost:3014/api/v1/usage/reports', env);

  assert.equal(getIngestEndpoint(env), 'http://localhost:3014/api/v1/usage/reports');
  assert.equal(getEmailVerificationRequestUrl(env), 'http://localhost:3014/api/v1/usage/email-verification/request');
  assert.equal(getEmailVerificationVerifyUrl(env), 'http://localhost:3014/api/v1/usage/email-verification/verify');
});

// talents-ai-score, ADR-020/021: FALLBACK hop (shakers-hub-backend) of the two-backend chain.

/*
 * ADR-033: the agent-certification flow was removed. The skill-code
 * certify/interview flow is ALSO retired now that `certify` is a dimension
 * LiveKit interview — so `getSkillCertificationSessionsEndpoint` must be gone
 * too, alongside every `getAgentCertification*` getter.
 */

test('agent- and skill-certification interview endpoints are retired, not just unexported', () => {
  for (const name of [
    'getAgentCertificationSessionsEndpoint',
    'getAgentCertificationSessionsEndpointFallback',
    'getAgentCertificationFollowupsEndpoint',
    'getAgentCertificationFollowupsEndpointFallback',
    'getAgentCertificationVerdictEndpoint',
    'getAgentCertificationVerdictEndpointFallback',
    'getSkillCertificationSessionsEndpoint',
    'getCertifyEndpoint',
    'getCertificationInterviewsEndpoint',
  ]) {
    assert.equal(name in config, false, `${name} must be retired`);
  }
});

test('validateEndpoint: isAllowlisted is true for loopback and false for an arbitrary https host', () => {
  assert.equal(validateEndpoint('http://localhost:3001/reports').isAllowlisted, true);
  assert.equal(validateEndpoint('http://127.0.0.1:3001/reports').isAllowlisted, true);
  assert.equal(validateEndpoint('http://[::1]:3001/reports').isAllowlisted, true);
  assert.equal(validateEndpoint('https://hub.example.com/reports').isAllowlisted, false);
});

test('validateEndpoint: isAllowlisted is false for every remote host — no production domain is assigned yet', () => {
  assert.equal(validateEndpoint('https://shakersworks.com/reports').isAllowlisted, false);
  assert.equal(validateEndpoint('https://api.shakersworks.com/reports').isAllowlisted, false);
  assert.equal(validateEndpoint('https://certifications.shakers.tools/reports').isAllowlisted, false);
  assert.equal(validateEndpoint('https://shakersworks.com.evil.example.com/reports').isAllowlisted, false);
  assert.equal(validateEndpoint('https://notshakersworks.com/reports').isAllowlisted, false);
});

test('setIngestEndpoint: refuses to persist a non-allowlisted host without confirmed:true', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  const r = setIngestEndpoint('https://hub.example.com/reports', env);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'needs-confirmation');
  assert.equal(r.host, 'hub.example.com');
  assert.equal(loadConfigFile(env).ingestEndpoint, undefined, 'nothing must be written without confirmation');
});

test('setIngestEndpoint: persists a non-allowlisted host once confirmed:true is passed', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  const r = setIngestEndpoint('https://hub.example.com/reports', env, { confirmed: true });
  assert.equal(r.ok, true);
  assert.equal(loadConfigFile(env).ingestEndpoint, 'https://hub.example.com/reports');
});

test('setIngestEndpoint: loopback never needs confirmation; a Shakers domain does, same as any other remote host', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  assert.equal(setIngestEndpoint('http://localhost:3001/reports', env).ok, true);
  const r = setIngestEndpoint('https://api.shakersworks.com/reports', env);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'needs-confirmation');
});

// ADR-042 / issue 125 — THE RETIRED FALLBACK KEY, AND THE POLICY FOR A CONFIG THAT STILL CARRIES IT.
test('ADR-042: the retired fallback key in config.json is IGNORED — no getter reads it, and it cannot affect the primary', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    ingestEndpoint: 'http://localhost:3004/api/v1/ai-footprint/reports',
    ingestEndpointFallback: 'http://localhost:3001/api/v1/works/ai-footprint/reports',
  }));

  // The primary resolves exactly as if the stale key were not there.
  assert.equal(getIngestEndpoint(env), 'http://localhost:3004/api/v1/ai-footprint/reports');
  assert.equal(resolveIngestEndpoint(env).source, 'config-file');

  // NOT VACUOUS: the whole config module is swept for any export that would resolve to the retired hub URL.
  const leaked = [];
  for (const [name, fn] of Object.entries(config)) {
    if (typeof fn !== 'function' || !/^(get|resolve)/.test(name)) continue;
    let out;
    try { out = fn(env); } catch { continue; }
    const asText = typeof out === 'string' ? out : (out && typeof out.endpoint === 'string' ? out.endpoint : '');
    if (asText.includes(':3001')) leaked.push(name);
  }
  assert.deepEqual(leaked, [], `these still read the retired fallback: ${leaked.join(', ')}`);
});

test('ADR-042: the retired key is DETECTED so --show-endpoint can say it is unused, and detection is not a mutation', () => {
  const dir = freshConfigDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  const file = path.join(dir, 'config.json');

  // Absent -> nothing to say.
  fs.writeFileSync(file, JSON.stringify({ ingestEndpoint: 'http://localhost:3004/reports' }));
  assert.equal(config.hasRetiredFallbackConfig(env), false);

  // Present -> say it once.
  const withKey = JSON.stringify({
    ingestEndpoint: 'http://localhost:3004/reports',
    ingestEndpointFallback: 'http://localhost:3001/reports',
  });
  fs.writeFileSync(file, withKey);
  assert.equal(config.hasRetiredFallbackConfig(env), true);
  // READ-ONLY, and that is a stated part of the policy: this CLI does not rewrite
  // a talent's config unless they asked. Byte-for-byte unchanged after the check.
  assert.equal(fs.readFileSync(file, 'utf8'), withKey);

  // An empty/blank value is not "present" — nothing to warn about.
  for (const blank of ['', '   ']) {
    fs.writeFileSync(file, JSON.stringify({ ingestEndpoint: 'http://localhost:3004/reports', ingestEndpointFallback: blank }));
    assert.equal(config.hasRetiredFallbackConfig(env), false);
  }
});

test('setIngestEndpoint (saveConfigFile): writes config.json with mode 0600 from creation, not just via the follow-up chmod', () => {
  const dir = freshConfigDir();
  const realWriteFileSync = fs.writeFileSync;
  let capturedOptions;
  fs.writeFileSync = (...args) => {
    if (String(args[0]).endsWith('config.json')) capturedOptions = args[2];
    return realWriteFileSync(...args);
  };
  try {
    setIngestEndpoint('http://localhost:3001/reports', { AI_FOOTPRINT_CONFIG_DIR: dir });
  } finally {
    fs.writeFileSync = realWriteFileSync;
  }
  assert.ok(capturedOptions && capturedOptions.mode === 0o600, 'writeFileSync must be called with { mode: 0o600 }');
  // End-state sanity: the file really is 0600 on disk (belt-and-braces chmod).
  const stat = fs.statSync(configFilePath({ AI_FOOTPRINT_CONFIG_DIR: dir }));
  assert.equal(stat.mode & 0o777, 0o600);
});

/* ---------- distribution profile (talents-ai-score, ADR-058 fase 1) ---------- */

test('getProfile/isTalentProfile: NO config file at all -> defaults to talent, not external', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  assert.equal(getProfile(env), 'talent');
  assert.equal(isTalentProfile(env), true);
});

test('getProfile/isTalentProfile: an EXISTING config.json with no `profile` key -> still talent', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  saveConfigFile({ ingestEndpoint: 'http://localhost:3004/api/v1/usage/reports' }, env);
  assert.equal(getProfile(env), 'talent');
  assert.equal(isTalentProfile(env), true);
});

test('getProfile/isTalentProfile: profile:"external" in config.json is honoured', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  saveConfigFile({ profile: 'external' }, env);
  assert.equal(getProfile(env), 'external');
  assert.equal(isTalentProfile(env), false);
});

test('getProfile/isTalentProfile: profile:"talent" in config.json is honoured', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  saveConfigFile({ profile: 'talent' }, env);
  assert.equal(getProfile(env), 'talent');
  assert.equal(isTalentProfile(env), true);
});

test('getProfile: a garbage/malformed `profile` value is treated like an absent one (talent), never a crash', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  for (const bogus of ['TALENT', 'External', 'staff', '', 42, null, {}]) {
    saveConfigFile({ profile: bogus }, env);
    assert.equal(getProfile(env), 'talent', `profile=${JSON.stringify(bogus)} must fall back to talent`);
  }
});

test('VALID_PROFILES is exactly {external, talent}', () => {
  assert.deepEqual([...VALID_PROFILES].sort(), ['external', 'talent']);
});
