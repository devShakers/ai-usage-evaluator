'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeDeviceLoginTools } = require('../src/mcp-device-login-tools');
const { buildRegistrationContext } = require('../src/signup-client');

// In-memory pending store + injectable primitives, so the two tools are tested
// without touching disk or the network.
function harness(overrides = {}) {
  let pending = null;
  const saved = { sessions: [], finalized: [] };
  const deps = {
    getDeviceAuthorizeEndpoint: () => 'https://h/authorize',
    getDeviceTokenEndpoint: () => 'https://h/token',
    getAuthTokenEndpoint: () => 'https://h/auth/token',
    getCompleteRegistrationEndpoint: () => 'https://h/complete',
    startDeviceLogin: async () => ({ ok: true, deviceCode: 'DEV-SECRET', userCode: 'ABCD-1234', verificationUri: 'https://h/d', verificationUriComplete: 'https://h/d?user_code=ABCD-1234', expiresIn: 600, interval: 5 }),
    pollDeviceToken: async () => ({ status: 'pending' }),
    finalizeDeviceSession: async (args) => { saved.finalized.push(args); return { ok: true, token: 'API-JWT' }; },
    savePendingDevice: (p) => { pending = { ...p }; },
    loadPendingDevice: () => (pending ? { ...pending } : null),
    clearPendingDevice: () => { pending = null; return true; },
    saveAuthSession: (s) => { saved.sessions.push(s); },
    buildRegistrationContext,
    ...overrides,
  };
  const tools = makeDeviceLoginTools(deps);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  return { byName, getPending: () => pending, saved };
}

test('start (login): returns the URL + user_code (default provider google), NEVER the device_code, persists the grant', async () => {
  const h = harness();
  const out = await h.byName.social_signin_start.handler({});
  assert.equal(out.ok, true);
  assert.equal(out.provider, 'google');
  assert.match(out.verificationUrl, /^https:\/\/h\/d\?/);
  assert.match(out.verificationUrl, /provider=google/);
  assert.equal(out.userCode, 'ABCD-1234');
  assert.equal(out.pollIntervalSeconds, 5);
  assert.ok(out.message.includes(out.verificationUrl), 'the message carries the clickable URL');
  assert.ok(out.message.includes('ABCD-1234'), 'the message carries the user code');
  // The device_code is a secret — it must not leak into the tool result.
  assert.equal(JSON.stringify(out).includes('DEV-SECRET'), false);
  const pending = h.getPending();
  assert.equal(pending.deviceCode, 'DEV-SECRET');
  assert.equal(pending.verificationUrl, out.verificationUrl, 'the URL is persisted so poll can re-surface it');
  assert.equal(pending.userCode, 'ABCD-1234');
  assert.equal(pending.mode, 'login');
  assert.equal(pending.provider, 'google');
});

test('start (linkedin): appends provider=linkedin and persists it for poll', async () => {
  const h = harness();
  const out = await h.byName.social_signin_start.handler({ provider: 'linkedin' });
  assert.equal(out.provider, 'linkedin');
  assert.match(out.verificationUrl, /provider=linkedin/);
  assert.equal(h.getPending().provider, 'linkedin');
});

test('start (register): stores the register context for complete-registration', async () => {
  const h = harness();
  await h.byName.social_signin_start.handler({ mode: 'register', freelanceType: 'FREELANCE', preferredLanguage: 'es' });
  assert.deepEqual(h.getPending().registerContext, { freelanceType: 'FREELANCE', preferredLanguage: 'es' });
});

test('start: no endpoint configured -> structured error, nothing persisted', async () => {
  const h = harness({ getDeviceAuthorizeEndpoint: () => null });
  const out = await h.byName.social_signin_start.handler({});
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-endpoint');
  assert.equal(h.getPending(), null);
});

test('poll: no pending grant -> no-pending', async () => {
  const h = harness();
  const out = await h.byName.social_signin_poll.handler({});
  assert.equal(out.ok, false);
  assert.equal(out.status, 'no-pending');
});

test('poll: pending stays pending; slow_down bumps the interval and keeps polling', async () => {
  const h = harness({ pollDeviceToken: async () => ({ status: 'pending' }) });
  await h.byName.social_signin_start.handler({});
  const p = await h.byName.social_signin_poll.handler({});
  assert.equal(p.status, 'pending');
  assert.equal(p.pollIntervalSeconds, 5);
  assert.match(p.verificationUrl, /provider=google/, 'pending re-surfaces the URL');
  assert.equal(p.userCode, 'ABCD-1234');
  assert.ok(p.message.includes(p.verificationUrl), 'the pending message repeats the clickable URL');

  const h2 = harness({ pollDeviceToken: async () => ({ status: 'slow_down' }) });
  await h2.byName.social_signin_start.handler({});
  const s = await h2.byName.social_signin_poll.handler({});
  assert.equal(s.status, 'pending');
  assert.equal(s.pollIntervalSeconds, 10, 'interval bumped by 5');
  assert.equal(h2.getPending().interval, 10, 'the bumped interval is persisted');
  assert.ok(s.message.includes(s.verificationUrl), 'slow_down message keeps the clickable URL');
});

test('poll (login authorized): finalizes with the session token + endpoints, persists the API JWT, clears the grant', async () => {
  const h = harness({ pollDeviceToken: async () => ({ status: 'authorized', accessToken: 'SESS', isNewUser: false, email: 'g@x.com' }) });
  await h.byName.social_signin_start.handler({});
  const out = await h.byName.social_signin_poll.handler({});
  assert.deepEqual(out, { ok: true, status: 'authorized', method: 'google', email: 'g@x.com', isNewUser: false });
  assert.equal(h.saved.sessions.length, 1);
  assert.deepEqual(h.saved.sessions[0], { accessToken: 'API-JWT', hubAccessToken: 'API-JWT', email: 'g@x.com' }, 'the stored session is the exchanged API JWT');
  const f = h.saved.finalized[0];
  assert.equal(f.sessionToken, 'SESS');
  assert.equal(f.isNewUser, false);
  assert.equal(f.authTokenEndpoint, 'https://h/auth/token');
  assert.equal(f.completeRegistrationEndpoint, 'https://h/complete');
  assert.equal(h.getPending(), null, 'grant cleared after success');
});

test('poll (register authorized + isNewUser): finalizes as a new user with the freelance/language context', async () => {
  const h = harness({ pollDeviceToken: async () => ({ status: 'authorized', accessToken: 'SESS', isNewUser: true, email: 'new@x.com' }) });
  await h.byName.social_signin_start.handler({ mode: 'register', freelanceType: 'FREELANCE', preferredLanguage: 'es' });
  const out = await h.byName.social_signin_poll.handler({});
  assert.equal(out.status, 'authorized');
  assert.equal(out.isNewUser, true);
  assert.equal(h.saved.sessions[0].accessToken, 'API-JWT');
  const f = h.saved.finalized[0];
  assert.equal(f.sessionToken, 'SESS');
  assert.equal(f.isNewUser, true);
  assert.equal(f.registrationContext.freelanceType, 'FREELANCE');
  assert.equal(f.registrationContext.preferredLanguage, 'ES');
});

test('poll: a finalize failure is surfaced as an error, no session saved, grant cleared', async () => {
  const h = harness({
    pollDeviceToken: async () => ({ status: 'authorized', accessToken: 'SESS', isNewUser: true, email: 'new@x.com' }),
    finalizeDeviceSession: async () => ({ ok: false, reason: 'token-exchange-failed' }),
  });
  await h.byName.social_signin_start.handler({ mode: 'register' });
  const out = await h.byName.social_signin_poll.handler({});
  assert.equal(out.ok, false);
  assert.equal(out.status, 'error');
  assert.equal(out.reason, 'token-exchange-failed');
  assert.equal(h.saved.sessions.length, 0, 'a finalize failure is never treated as logged in');
  assert.equal(h.getPending(), null, 'the consumed grant is cleared');
});

test('poll: denied and expired clear the pending grant', async () => {
  for (const status of ['denied', 'expired']) {
    const h = harness({ pollDeviceToken: async () => ({ status }) });
    // eslint-disable-next-line no-await-in-loop
    await h.byName.social_signin_start.handler({});
    // eslint-disable-next-line no-await-in-loop
    const out = await h.byName.social_signin_poll.handler({});
    assert.equal(out.ok, false);
    assert.equal(out.status, status);
    assert.equal(h.getPending(), null);
  }
});
