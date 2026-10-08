'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerWithSocialAccount } = require('../src/onboarding-flow');

// registerWithSocialAccount: the flow step behind Google register in the CLI,
// driven by the device flow (RFC 8628). It builds the registration context and
// hands the endpoints to runDeviceLogin, which owns the ORDER (complete-
// registration before the JWT exchange for a new user) — see device-login.test.

function deps(overrides = {}) {
  return {
    getDeviceAuthorizeEndpoint: () => 'https://hub/api/v1/auth/device/code',
    getDeviceTokenEndpoint: () => 'https://hub/api/v1/works/auth/device/token',
    getAuthTokenEndpoint: () => 'https://hub/api/v1/auth/token',
    getCompleteRegistrationEndpoint: () => 'https://hub/api/v1/works/auth/complete-registration',
    runDeviceLogin: async () => ({ ok: true, token: 'JWT', sessionToken: 'SESS', isNewUser: true, email: 'g@shakers.com' }),
    saveAuthSession: () => {},
    buildRegistrationContext: require('../src/signup-client').buildRegistrationContext,
    ...overrides,
  };
}

test('new user -> passes the endpoints + freelance/language context to runDeviceLogin, persists the JWT, kind registered', async () => {
  let saved = null;
  let passed = null;
  const res = await registerWithSocialAccount(
    deps({
      saveAuthSession: (s) => { saved = s; },
      runDeviceLogin: async (endpoints) => { passed = endpoints; return { ok: true, token: 'JWT', sessionToken: 'SESS', isNewUser: true, email: 'g@shakers.com' }; },
    }),
    { language: 'es' },
  );
  assert.deepEqual(res, { ok: true, kind: 'registered', email: 'g@shakers.com' });
  assert.equal(saved.accessToken, 'JWT');
  assert.equal(saved.hubAccessToken, 'JWT', 'the exchanged API JWT is the hub token too');
  assert.equal(passed.completeRegistrationEndpoint, 'https://hub/api/v1/works/auth/complete-registration');
  assert.equal(passed.authTokenEndpoint, 'https://hub/api/v1/auth/token');
  // freelanceType is not asked; a transient default is sent, corrected later.
  assert.equal(passed.registrationContext.freelanceType, 'POTENTIAL_FREELANCE');
  assert.equal(passed.registrationContext.preferredLanguage, 'ES');
});

test('existing account (isNewUser false) -> signed in, kind account-already-exists', async () => {
  const res = await registerWithSocialAccount(
    deps({ runDeviceLogin: async () => ({ ok: true, token: 'JWT', sessionToken: 'SESS', isNewUser: false, email: 'a@b.com' }) }),
    { language: 'es' },
  );
  assert.deepEqual(res, { ok: true, kind: 'account-already-exists', email: 'a@b.com' });
});

test('surfaces the URL + user_code to onPrompt with &provider= appended (default google)', async () => {
  let prompted = null;
  await registerWithSocialAccount(
    deps({
      runDeviceLogin: async (_endpoints, { onPrompt }) => {
        onPrompt({ verificationUriComplete: 'https://hub/device?code=ABCD-1234', userCode: 'ABCD-1234' });
        return { ok: true, token: 'JWT', sessionToken: 'SESS', isNewUser: true, email: 'g@shakers.com' };
      },
    }),
    { language: 'es' },
    { onAuthUrl: (url, code) => { prompted = { url, code }; } },
  );
  assert.equal(prompted.code, 'ABCD-1234');
  assert.match(prompted.url, /provider=google/);
});

test('provider linkedin is appended to the URL and reflected in the flow', async () => {
  let prompted = null;
  const res = await registerWithSocialAccount(
    deps({
      runDeviceLogin: async (_endpoints, { onPrompt }) => {
        onPrompt({ verificationUriComplete: 'https://hub/device?code=WXYZ-9999', userCode: 'WXYZ-9999' });
        return { ok: true, token: 'JWT', sessionToken: 'SESS', isNewUser: true, email: 'l@shakers.com' };
      },
    }),
    { provider: 'linkedin', language: 'es' },
    { onAuthUrl: (url) => { prompted = url; } },
  );
  assert.equal(res.ok, true);
  assert.match(prompted, /provider=linkedin/);
});

test('a failed device flow surfaces its named reason, persists nothing', async () => {
  let saved = false;
  const res = await registerWithSocialAccount(
    deps({ saveAuthSession: () => { saved = true; }, runDeviceLogin: async () => ({ ok: false, reason: 'denied' }) }),
    { language: 'es' },
  );
  assert.deepEqual(res, { ok: false, reason: 'denied' });
  assert.equal(saved, false);
});

test('no device endpoints configured -> no-endpoint, nothing sent', async () => {
  const res = await registerWithSocialAccount(
    deps({ getDeviceAuthorizeEndpoint: () => null, getDeviceTokenEndpoint: () => null }),
    { language: 'es' },
  );
  assert.deepEqual(res, { ok: false, reason: 'no-endpoint' });
});
