'use strict';

// MCP: two provider-agnostic tools (start returns URL+user_code to relay VERBATIM; poll finishes). device_code stays in the local store, never in a result.

const START_SCHEMA = {
  type: 'object',
  properties: {
    provider: { type: 'string', enum: ['google', 'linkedin'], description: "Optional social provider. Defaults to 'google'. Same device flow either way; it selects which social button the sign-in page opens." },
    mode: { type: 'string', enum: ['login', 'register'], description: "Optional. 'login' signs an existing talent in; 'register' creates the account if new (the profile steps come from the register/onboarding tools afterwards). Defaults to 'login'." },
    freelanceType: { type: 'string', description: 'Optional, register only: FREELANCE | EMPLOYEE | AGENCY | POTENTIAL_FREELANCE. Used to complete a new account.' },
    preferredLanguage: { type: 'string', description: 'Optional, register only: es | en | it | pt | fr.' },
  },
};

const POLL_SCHEMA = { type: 'object', properties: {} };

function makeDeviceLoginTools(deps = {}) {
  const {
    getDeviceAuthorizeEndpoint = require('./config').getDeviceAuthorizeEndpoint,
    getDeviceTokenEndpoint = require('./config').getDeviceTokenEndpoint,
    getAuthTokenEndpoint = require('./config').getAuthTokenEndpoint,
    getCompleteRegistrationEndpoint = require('./config').getCompleteRegistrationEndpoint,
    startDeviceLogin = require('./device-login').startDeviceLogin,
    pollDeviceToken = require('./device-login').pollDeviceToken,
    finalizeDeviceSession = require('./device-login').finalizeDeviceSession,
    appendProviderParam = require('./device-login').appendProviderParam,
    savePendingDevice = require('./device-auth-store').savePendingDevice,
    loadPendingDevice = require('./device-auth-store').loadPendingDevice,
    clearPendingDevice = require('./device-auth-store').clearPendingDevice,
    saveAuthSession = require('./auth-session-store').saveAuthSession,
    buildRegistrationContext = require('./signup-client').buildRegistrationContext,
  } = deps;

  async function start(args = {}) {
    const mode = args.mode === 'register' ? 'register' : 'login';
    const provider = args.provider === 'linkedin' ? 'linkedin' : 'google';
    const authorizeEndpoint = getDeviceAuthorizeEndpoint();
    const tokenEndpoint = getDeviceTokenEndpoint();
    const authTokenEndpoint = getAuthTokenEndpoint();
    if (!authorizeEndpoint || !tokenEndpoint || !authTokenEndpoint) {
      return { ok: false, reason: 'no-endpoint', message: 'No sign-in endpoint configured — set SHAKERS_CLI_HUB_BASE.' };
    }

    const authz = await startDeviceLogin({ authorizeEndpoint });
    if (!authz.ok) return { ok: false, reason: authz.reason || 'authorize-failed' };

    const verificationUrl = appendProviderParam(authz.verificationUriComplete, provider);
    const expiresAt = new Date(Date.now() + authz.expiresIn * 1000).toISOString();
    try {
      savePendingDevice({
        deviceCode: authz.deviceCode,
        verificationUrl,
        userCode: authz.userCode,
        tokenEndpoint,
        authTokenEndpoint,
        interval: authz.interval,
        expiresAt,
        mode,
        provider,
        registerContext: mode === 'register'
          ? { freelanceType: args.freelanceType || null, preferredLanguage: args.preferredLanguage || null }
          : null,
      });
    } catch {
      return { ok: false, reason: 'pending-persist-failed' };
    }

    return {
      ok: true,
      status: 'pending',
      provider,
      verificationUrl,
      verificationUri: authz.verificationUri,
      userCode: authz.userCode,
      expiresInSeconds: authz.expiresIn,
      pollIntervalSeconds: authz.interval,
      message: `Show the talent this link and code so they can authorize in their own browser — relay both verbatim, do not invent or complete the code:\n\n${verificationUrl}\n\nCode: ${authz.userCode}\n\nThen call social_signin_poll; if it returns status "pending", wait pollIntervalSeconds and call it again.`,
    };
  }

  async function poll() {
    const pending = loadPendingDevice();
    if (!pending || !pending.deviceCode) {
      return { ok: false, status: 'no-pending', message: 'No social sign-in is in progress — call social_signin_start first.' };
    }

    const res = await pollDeviceToken({ deviceCode: pending.deviceCode, tokenEndpoint: pending.tokenEndpoint });

    const linkBlock = pending.verificationUrl
      ? `\n\n${pending.verificationUrl}\n\nCode: ${pending.userCode || ''}`
      : '';

    if (res.status === 'pending') {
      return {
        ok: true,
        status: 'pending',
        pollIntervalSeconds: pending.interval,
        verificationUrl: pending.verificationUrl,
        userCode: pending.userCode,
        message: `Not authorized yet. Keep showing the talent this link and code so they can finish in their browser:${linkBlock}\n\nThen wait pollIntervalSeconds and call social_signin_poll again.`,
      };
    }
    if (res.status === 'slow_down') {
      const interval = pending.interval + 5;
      try { savePendingDevice({ ...pending, interval }); } catch { /* keep the old interval */ }
      return {
        ok: true,
        status: 'pending',
        pollIntervalSeconds: interval,
        verificationUrl: pending.verificationUrl,
        userCode: pending.userCode,
        message: `Polling too fast — wait pollIntervalSeconds and call social_signin_poll again. Keep the talent's link and code visible:${linkBlock}`,
      };
    }
    if (res.status === 'denied') {
      clearPendingDevice();
      return { ok: false, status: 'denied', message: 'The talent cancelled or did not grant access. No session was started.' };
    }
    if (res.status === 'expired') {
      clearPendingDevice();
      return { ok: false, status: 'expired', message: 'The sign-in request expired. Call social_signin_start to try again.' };
    }
    if (res.status !== 'authorized') {
      return { ok: false, status: 'error', reason: res.reason || 'poll-failed' };
    }

    // finalize enforces the order: NEW user -> complete-registration before the JWT exchange. freelanceType is a transient default.
    const rc = pending.registerContext || {};
    const registrationContext = buildRegistrationContext({
      preferredLanguage: rc.preferredLanguage || undefined,
      newsletterConsent: false,
      freelanceType: rc.freelanceType || 'POTENTIAL_FREELANCE',
    });
    const fin = await finalizeDeviceSession({
      sessionToken: res.accessToken,
      isNewUser: res.isNewUser,
      authTokenEndpoint: pending.authTokenEndpoint,
      completeRegistrationEndpoint: getCompleteRegistrationEndpoint(),
      registrationContext,
    });
    if (!fin.ok) {
      // The authorization was consumed; a re-poll can't recover — never treat this as logged in.
      clearPendingDevice();
      return { ok: false, status: 'error', reason: fin.reason };
    }
    try {
      saveAuthSession({ accessToken: fin.token, hubAccessToken: fin.token, email: res.email || pending.email || null });
    } catch {
      clearPendingDevice();
      return { ok: false, status: 'error', reason: 'session-persist-failed' };
    }

    clearPendingDevice();
    return { ok: true, status: 'authorized', method: pending.provider || 'google', email: res.email || null, isNewUser: !!res.isNewUser };
  }

  return [
    {
      name: 'social_signin_start',
      description: "Begin social sign-in (or registration) via the device flow — provider 'google' (default) or 'linkedin'. Returns a verificationUrl and a userCode: show BOTH to the talent verbatim — they open the URL and enter the code in their own browser (they never type anything in the chat, and you never invent or fill the code). Pass mode 'register' to create the account if it is new. After showing them, call social_signin_poll. Returns { ok, status, provider, verificationUrl, userCode, pollIntervalSeconds, ... }.",
      inputSchema: START_SCHEMA,
      handler: start,
    },
    {
      name: 'social_signin_poll',
      description: "Check whether the talent has finished the social sign-in started by social_signin_start, and persist the session when they have. Call it after showing the code; if it returns status 'pending', wait pollIntervalSeconds and call it again — the 'pending' response repeats the verificationUrl and userCode so you can keep the clickable link in front of the talent. Returns status 'authorized' (session saved, with isNewUser + method), 'pending', 'denied', or 'expired'.",
      inputSchema: POLL_SCHEMA,
      handler: poll,
    },
  ];
}

module.exports = { makeDeviceLoginTools, START_SCHEMA, POLL_SCHEMA };
