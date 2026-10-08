'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { hasUsableSession, jwtUsable } = require('../src/session-gate');
const { ensureFreshSession } = require('../src/session-refresh');

const iso = (ms, base = Date.now()) => new Date(base + ms).toISOString();

test('jwtUsable: only a future accessTokenExpiresAt counts', () => {
  const now = Date.now();
  assert.equal(jwtUsable({ accessTokenExpiresAt: iso(60_000, now) }, now), true);
  assert.equal(jwtUsable({ accessTokenExpiresAt: iso(-1000, now) }, now), false);
  assert.equal(jwtUsable({ accessTokenExpiresAt: 'nope' }, now), false);
  assert.equal(jwtUsable({}, now), false);
  assert.equal(jwtUsable(null, now), false);
});

test('an active stored session passes the gate without any refresh', async () => {
  const now = Date.now();
  const ok = await hasUsableSession(process.env, {
    loadAuthSession: () => ({ accessToken: 'jwt', cookie: 'better-auth.session_token=c', expiresAt: iso(7 * 24 * 3600 * 1000, now) }),
    ensureFreshSession: () => { throw new Error('refresh must not be called for an active session'); },
    now,
  });
  assert.equal(ok, true);
});

test('JWT expired + cookie valid: the gate mints a fresh JWT via requestAuthToken and passes', async () => {
  const now = Date.now();
  const state = {
    session: {
      accessToken: 'old', cookie: 'better-auth.session_token=c',
      expiresAt: iso(-1000, now), accessTokenExpiresAt: iso(-1000, now),
    },
  };
  let tokenCalls = 0;
  const refresh = (env, deps) => ensureFreshSession(env, {
    ...deps,
    loadAuthSession: () => state.session,
    saveAuthSession: (s) => { state.session = { ...state.session, ...s, expiresAt: s.cookieExpiresAt || state.session.expiresAt }; },
    getAuthTokenEndpoint: () => 'https://hub/api/v1/auth/token',
    requestAuthToken: async () => { tokenCalls += 1; return { ok: true, accessToken: 'fresh', expiresAt: iso(900 * 1000, now) }; },
  });
  const ok = await hasUsableSession(process.env, {
    loadAuthSession: () => state.session,
    ensureFreshSession: refresh,
    now,
  });
  assert.equal(tokenCalls, 1);
  assert.equal(ok, true);
  assert.equal(state.session.accessToken, 'fresh');
});

test('JWT expired + cookie DEAD (mint fails): the gate rejects', async () => {
  const now = Date.now();
  const session = {
    accessToken: 'old', cookie: 'better-auth.session_token=dead',
    expiresAt: iso(-1000, now), accessTokenExpiresAt: iso(-1000, now),
  };
  let tokenCalls = 0;
  const refresh = (env, deps) => ensureFreshSession(env, {
    ...deps,
    loadAuthSession: () => session,
    saveAuthSession: () => { throw new Error('must not persist a failed refresh'); },
    getAuthTokenEndpoint: () => 'https://hub/api/v1/auth/token',
    requestAuthToken: async () => { tokenCalls += 1; return { ok: false, reason: 'http-error', status: 401 }; },
  });
  const ok = await hasUsableSession(process.env, {
    loadAuthSession: () => session,
    ensureFreshSession: refresh,
    now,
  });
  assert.equal(tokenCalls, 1);
  assert.equal(ok, false);
});

test('an expired session with NO cookie (Google/legacy) rejects and never attempts a refresh', async () => {
  const now = Date.now();
  let refreshCalls = 0;
  const ok = await hasUsableSession(process.env, {
    loadAuthSession: () => ({ accessToken: 'goog-jwt', cookie: null, expiresAt: iso(-1000, now), accessTokenExpiresAt: iso(-1000, now) }),
    ensureFreshSession: () => { refreshCalls += 1; return null; },
    now,
  });
  assert.equal(ok, false);
  assert.equal(refreshCalls, 0);
});

test('no session at all rejects', async () => {
  const ok = await hasUsableSession(process.env, { loadAuthSession: () => null, ensureFreshSession: () => { throw new Error('nope'); } });
  assert.equal(ok, false);
});
