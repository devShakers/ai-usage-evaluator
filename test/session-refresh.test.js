'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureFreshSession, jwtStillFresh } = require('../src/session-refresh');

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

// A deps harness: an in-memory session the fake load/save read and write, plus a
// counting requestAuthToken so we can assert whether a refresh actually fired.
function harness(initialSession, { tokenResult } = {}) {
  const state = { session: initialSession, saved: null, tokenCalls: 0 };
  const deps = {
    loadAuthSession: () => state.session,
    saveAuthSession: (s) => { state.saved = s; state.session = { ...s, accessTokenExpiresAt: s.accessTokenExpiresAt || null, cookie: s.cookie || null, expiresAt: s.cookieExpiresAt || s.expiresAt || null }; },
    getAuthTokenEndpoint: () => 'https://hub/api/v1/auth/token',
    requestAuthToken: async () => { state.tokenCalls += 1; return tokenResult || { ok: true, accessToken: 'fresh-jwt', expiresAt: iso(900 * 1000) }; },
  };
  return { deps, state };
}

test('jwtStillFresh: future beyond margin is fresh; near/expired/unparseable is not', () => {
  const now = Date.now();
  assert.equal(jwtStillFresh(new Date(now + 5 * 60 * 1000).toISOString(), now, 120 * 1000), true);
  assert.equal(jwtStillFresh(new Date(now + 30 * 1000).toISOString(), now, 120 * 1000), false);
  assert.equal(jwtStillFresh(new Date(now - 1000).toISOString(), now, 120 * 1000), false);
  assert.equal(jwtStillFresh('whenever', now, 120 * 1000), false);
  assert.equal(jwtStillFresh(null, now, 120 * 1000), false);
});

test('no session -> null, no token call', async () => {
  const { deps, state } = harness(null);
  assert.equal(await ensureFreshSession(process.env, deps), null);
  assert.equal(state.tokenCalls, 0);
});

test('a Google/legacy session (no cookie) is returned unchanged, never refreshed', async () => {
  const session = { accessToken: 'goog-jwt', expiresAt: iso(7 * 24 * 3600 * 1000), accessTokenExpiresAt: iso(7 * 24 * 3600 * 1000), cookie: null };
  const { deps, state } = harness(session);
  const out = await ensureFreshSession(process.env, deps);
  assert.equal(out, session);
  assert.equal(state.tokenCalls, 0);
});

test('a cookie session with a still-fresh JWT is reused, no refresh', async () => {
  const session = { accessToken: 'jwt', cookie: 'better-auth.session_token=c', expiresAt: iso(7 * 24 * 3600 * 1000), accessTokenExpiresAt: iso(10 * 60 * 1000) };
  const { deps, state } = harness(session);
  const out = await ensureFreshSession(process.env, deps);
  assert.equal(out, session);
  assert.equal(state.tokenCalls, 0);
});

test('a cookie session with a stale JWT is refreshed from the cookie and re-persisted', async () => {
  const session = { accessToken: 'old-jwt', cookie: 'better-auth.session_token=c', expiresAt: iso(7 * 24 * 3600 * 1000), accessTokenExpiresAt: iso(30 * 1000) };
  const { deps, state } = harness(session);
  const out = await ensureFreshSession(process.env, deps);
  assert.equal(state.tokenCalls, 1);
  assert.equal(state.saved.accessToken, 'fresh-jwt');
  assert.equal(state.saved.hubAccessToken, 'fresh-jwt');
  assert.equal(state.saved.cookie, 'better-auth.session_token=c');
  assert.equal(out.accessToken, 'fresh-jwt');
});

test('a cookie session with no cached JWT at all triggers a mint', async () => {
  const session = { accessToken: null, cookie: 'better-auth.session_token=c', expiresAt: iso(7 * 24 * 3600 * 1000), accessTokenExpiresAt: null };
  const { deps, state } = harness(session);
  await ensureFreshSession(process.env, deps);
  assert.equal(state.tokenCalls, 1);
  assert.equal(state.saved.accessToken, 'fresh-jwt');
});

test('a failed refresh returns the existing (stale) session, never throws', async () => {
  const session = { accessToken: 'old-jwt', cookie: 'better-auth.session_token=c', expiresAt: iso(7 * 24 * 3600 * 1000), accessTokenExpiresAt: iso(30 * 1000) };
  const { deps, state } = harness(session, { tokenResult: { ok: false, reason: 'network-error' } });
  const out = await ensureFreshSession(process.env, deps);
  assert.equal(state.tokenCalls, 1);
  assert.equal(state.saved, null);
  assert.equal(out, session);
});

test('no token endpoint configured -> session returned as-is, no token call', async () => {
  const session = { accessToken: 'old-jwt', cookie: 'better-auth.session_token=c', expiresAt: iso(7 * 24 * 3600 * 1000), accessTokenExpiresAt: iso(30 * 1000) };
  const { deps, state } = harness(session);
  deps.getAuthTokenEndpoint = () => null;
  const out = await ensureFreshSession(process.env, deps);
  assert.equal(state.tokenCalls, 0);
  assert.equal(out, session);
});
