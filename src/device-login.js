'use strict';

const { requestDeviceAuthorization, requestDeviceToken, requestApiToken } = require('./auth-device-client');

const SLOW_DOWN_STEP_SECONDS = 5;
const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000;

function defaultSleep(ms) {
  // NOT unref'd: the loop's await sleep(...) is the only handle keeping the process alive while it waits.
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// The /cli-login page reads `provider` from the query to pick the social button.
function appendProviderParam(url, provider) {
  if (!url || !provider) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('provider', provider);
    return u.href;
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}provider=${encodeURIComponent(provider)}`;
  }
}

async function startDeviceLogin({ authorizeEndpoint, clientId, scope, timeoutMs } = {}) {
  return requestDeviceAuthorization({ endpoint: authorizeEndpoint, clientId, scope, timeoutMs });
}

async function pollDeviceToken({ deviceCode, tokenEndpoint, clientId, timeoutMs } = {}) {
  return requestDeviceToken({ deviceCode, clientId }, { endpoint: tokenEndpoint, timeoutMs });
}

// ORDER: a NEW user needs complete-registration BEFORE GET /auth/token (else the Hub 500s: no domain user).
async function finalizeDeviceSession(
  { sessionToken, isNewUser, authTokenEndpoint, completeRegistrationEndpoint = null, registrationContext = null, claimCode = null, timeoutMs } = {},
  {
    requestCompleteRegistration = require('./signup-client').requestCompleteRegistration,
    requestApiToken: apiToken = requestApiToken,
  } = {},
) {
  if (!authTokenEndpoint) return { ok: false, reason: 'no-endpoint' };

  let claimed = false;
  if (isNewUser && completeRegistrationEndpoint) {
    const done = await requestCompleteRegistration(registrationContext || {}, { endpoint: completeRegistrationEndpoint, bearerToken: sessionToken, claimCode, timeoutMs });
    if (!done.ok) return { ok: false, reason: done.reason || 'complete-registration-failed' };
    claimed = done.claimed === true;
  }

  const jwt = await apiToken({ accessToken: sessionToken }, { endpoint: authTokenEndpoint, timeoutMs });
  if (!jwt.ok) return { ok: false, reason: 'token-exchange-failed' };
  return claimCode ? { ok: true, token: jwt.token, claimed } : { ok: true, token: jwt.token };
}

async function runDeviceLogin(
  { authorizeEndpoint, tokenEndpoint, authTokenEndpoint, completeRegistrationEndpoint = null, registrationContext = null, clientId, scope, timeoutMs } = {},
  {
    onPrompt = null,
    onWaiting = null,
    sleep = defaultSleep,
    now = () => Date.now(),
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
  } = {},
) {
  if (!authorizeEndpoint || !tokenEndpoint || !authTokenEndpoint) return { ok: false, reason: 'no-endpoint' };

  const authz = await startDeviceLogin({ authorizeEndpoint, clientId, scope, timeoutMs });
  if (!authz.ok) return { ok: false, reason: authz.reason || 'authorize-failed' };

  if (typeof onPrompt === 'function') {
    onPrompt({
      verificationUriComplete: authz.verificationUriComplete,
      verificationUri: authz.verificationUri,
      userCode: authz.userCode,
      expiresIn: authz.expiresIn,
    });
  }

  let intervalSeconds = authz.interval;
  const deadline = now() + Math.min(authz.expiresIn * 1000, maxWaitMs);

  for (;;) {
    if (now() >= deadline) return { ok: false, reason: 'expired' };
    if (typeof onWaiting === 'function') onWaiting();
    await sleep(intervalSeconds * 1000);

    const res = await pollDeviceToken({ deviceCode: authz.deviceCode, tokenEndpoint, clientId, timeoutMs });
    if (res.status === 'authorized') {
      const fin = await finalizeDeviceSession({
        sessionToken: res.accessToken,
        isNewUser: res.isNewUser,
        authTokenEndpoint,
        completeRegistrationEndpoint,
        registrationContext,
        timeoutMs,
      });
      if (!fin.ok) return { ok: false, reason: fin.reason };
      return { ok: true, token: fin.token, sessionToken: res.accessToken, isNewUser: res.isNewUser, email: res.email || null };
    }
    if (res.status === 'pending') continue;
    if (res.status === 'slow_down') {
      intervalSeconds += SLOW_DOWN_STEP_SECONDS;
      continue;
    }
    if (res.status === 'denied') return { ok: false, reason: 'denied' };
    if (res.status === 'expired') return { ok: false, reason: 'expired' };
    return { ok: false, reason: res.reason || 'poll-failed' };
  }
}

module.exports = {
  startDeviceLogin,
  pollDeviceToken,
  finalizeDeviceSession,
  runDeviceLogin,
  appendProviderParam,
  defaultSleep,
  SLOW_DOWN_STEP_SECONDS,
  DEFAULT_MAX_WAIT_MS,
};
