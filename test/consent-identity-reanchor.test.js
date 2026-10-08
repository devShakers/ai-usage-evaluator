'use strict';

// Regression for the consent↔session identity desync: a reused grant (skip/--json)
// must re-anchor the ingest email to the active session's login-proven email, so the
// report is never sent under a stale prior-account email (the "AI profile se está
// generando" forever incident). See resolveAiConsent in src/usage-run-steps.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getCatalog } = require('../src/i18n');
const { resolveAiConsent } = require('../src/usage-run-steps');
const { loadConsentState } = require('../src/share-consent-state');

const catalog = getCatalog('en');

async function withTempConfigDir(fn) {
  const prev = process.env.SHAKERS_CLI_CONFIG_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-consent-'));
  process.env.SHAKERS_CLI_CONFIG_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) delete process.env.SHAKERS_CLI_CONFIG_DIR;
    else process.env.SHAKERS_CLI_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function seedConsent(dir, state) {
  fs.writeFileSync(path.join(dir, 'consent.json'), JSON.stringify(state, null, 2));
}

const grantedFor = (email) => ({ consent: 'granted', email, emailVerified: true, lastSentAt: '2026-10-01T00:00:00.000Z' });

test('reused grant re-anchors to the session email when logged in as a different account', async () => {
  await withTempConfigDir(async (dir) => {
    seedConsent(dir, grantedFor('old-account@x.com'));
    const gate = { loggedIn: true, email: 'logged-in@y.com', profile: 'talent' };
    const granted = await resolveAiConsent({ opts: {}, catalog, gate, injectedAsk: null });
    assert.equal(granted, true);
    const state = loadConsentState();
    assert.equal(state.email, 'logged-in@y.com');
    assert.equal(state.emailVerified, true);
    assert.equal(state.consent, 'granted');
    // throttle timestamp preserved across the re-anchor.
    assert.equal(state.lastSentAt, '2026-10-01T00:00:00.000Z');
  });
});

test('reused grant re-anchors on the --json path too', async () => {
  await withTempConfigDir(async (dir) => {
    seedConsent(dir, grantedFor('old-account@x.com'));
    const gate = { loggedIn: true, email: 'logged-in@y.com', profile: 'talent' };
    const granted = await resolveAiConsent({ opts: { json: true }, catalog, gate, injectedAsk: null });
    assert.equal(granted, true);
    assert.equal(loadConsentState().email, 'logged-in@y.com');
  });
});

test('no re-anchor when the session email matches the stored consent (differs only by case)', async () => {
  await withTempConfigDir(async (dir) => {
    seedConsent(dir, grantedFor('same@y.com'));
    const gate = { loggedIn: true, email: 'SAME@Y.com', profile: 'talent' };
    const granted = await resolveAiConsent({ opts: {}, catalog, gate, injectedAsk: null });
    assert.equal(granted, true);
    assert.equal(loadConsentState().email, 'same@y.com');
  });
});

test('no re-anchor for an anonymous (not logged-in) run — consent email is left untouched', async () => {
  await withTempConfigDir(async (dir) => {
    seedConsent(dir, grantedFor('old-account@x.com'));
    const gate = { loggedIn: false, email: null, profile: 'talent' };
    const granted = await resolveAiConsent({ opts: {}, catalog, gate, injectedAsk: null });
    assert.equal(granted, true);
    assert.equal(loadConsentState().email, 'old-account@x.com');
  });
});

test('a denied decision is not re-anchored and does not grant', async () => {
  await withTempConfigDir(async (dir) => {
    seedConsent(dir, { consent: 'denied', email: 'old-account@x.com', emailVerified: true });
    const gate = { loggedIn: true, email: 'logged-in@y.com', profile: 'talent' };
    const granted = await resolveAiConsent({ opts: {}, catalog, gate, injectedAsk: null });
    assert.equal(granted, false);
    assert.equal(loadConsentState().email, 'old-account@x.com');
  });
});
