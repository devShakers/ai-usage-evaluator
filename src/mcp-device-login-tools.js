'use strict';

const { askRegistrationTerms } = require('./mcp-choice');
const { signupCopy } = require('./signup-copy');
const { signupLanguage } = require('./signup-language');
const { NOOP_FUNNEL } = require('./onboarding-funnel');

// MCP: two provider-agnostic tools (start returns URL+user_code to relay VERBATIM; poll finishes). device_code stays in the local store, never in a result.

const START_SCHEMA = {
  type: 'object',
  properties: {
    provider: { type: 'string', enum: ['google', 'linkedin', 'email'], description: "Optional provider. Defaults to 'google'. Same device flow either way; it selects which option the Shakers sign-in page opens — 'email' opens the email sign-in (the talent reuses their open web session or signs in there, never a password in the chat)." },
    mode: { type: 'string', enum: ['login', 'register'], description: "Optional. 'login' signs an existing talent in; 'register' creates the account if new (the profile steps come from the register/onboarding tools afterwards). Defaults to 'login'." },
    freelanceType: { type: 'string', description: 'Optional, register only: FREELANCE | EMPLOYEE | AGENCY | POTENTIAL_FREELANCE. Used to complete a new account.' },
    preferredLanguage: { type: 'string', description: 'Optional, register only: es | en | it | pt | fr.' },
    termsAnswer: { type: 'string', description: 'Register only: the option the talent picked when you printed the terms question this tool returned. Never set it yourself.' },
    newsletterAnswer: { type: 'string', description: 'Register only: the option the talent picked when you printed the newsletter question this tool returned. Never set it yourself.' },
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
    withDeviceParams = require('./device-login').withDeviceParams,
    deviceSessionRecord = require('./device-login').deviceSessionRecord,
    savePendingDevice = require('./device-auth-store').savePendingDevice,
    loadPendingDevice = require('./device-auth-store').loadPendingDevice,
    clearPendingDevice = require('./device-auth-store').clearPendingDevice,
    saveAuthSession = require('./auth-session-store').saveAuthSession,
    buildRegistrationContext = require('./signup-client').buildRegistrationContext,
    buildRegistrationConsent = require('./signup-client').buildRegistrationConsent,
    funnel = NOOP_FUNNEL,
  } = deps;
  const lang = () => signupLanguage(deps.lang || 'en');

  async function start(args = {}, ctx = {}) {
    const mode = args.mode === 'register' ? 'register' : 'login';
    const provider = args.provider === 'linkedin' ? 'linkedin' : args.provider === 'email' ? 'email' : 'google';
    let newsletterConsent = false;
    if (mode === 'register') {
      const terms = await askRegistrationTerms(ctx, { tool: 'social_signin_start', lang: lang(), termsAnswer: args.termsAnswer, newsletterAnswer: args.newsletterAnswer });
      if (terms.reply) return terms.reply;
      if (terms.declined) {
        return { ok: false, status: 'terms-declined', relayVerbatim: signupCopy(lang()).termsDeclined, message: 'Print relayVerbatim word for word. No account was created and nothing was sent.' };
      }
      newsletterConsent = terms.newsletterConsent;
    }
    const authorizeEndpoint = getDeviceAuthorizeEndpoint();
    const tokenEndpoint = getDeviceTokenEndpoint();
    const authTokenEndpoint = getAuthTokenEndpoint();
    if (!authorizeEndpoint || !tokenEndpoint || !authTokenEndpoint) {
      return { ok: false, reason: 'no-endpoint', message: 'No sign-in endpoint configured — set SHAKERS_CLI_HUB_BASE.' };
    }

    if (mode === 'register') funnel.begin();
    funnel.viewed('account_creation', { auth_methods_offered: [provider] });
    const authz = await startDeviceLogin({ authorizeEndpoint });
    if (!authz.ok) {
      funnel.errored('account_creation', authz.reason || 'authorize-failed');
      return { ok: false, reason: authz.reason || 'authorize-failed' };
    }

    const verificationUrl = withDeviceParams(authz.verificationUriComplete, { provider, mode, surface: 'mcp' });
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
          ? { freelanceType: args.freelanceType || null, preferredLanguage: args.preferredLanguage || null, newsletterConsent }
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
      relayVerbatim: signupCopy(lang()).windowLink(verificationUrl, authz.userCode),
      message: 'Print relayVerbatim word for word (it holds the link and the code) — never invent or complete the code. Then call social_signin_poll; if it returns status "pending", wait pollIntervalSeconds and call it again.',
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
      funnel.errored('account_creation', 'device-denied');
      return { ok: false, status: 'denied', message: 'The talent cancelled or did not grant access. No session was started.' };
    }
    if (res.status === 'expired') {
      clearPendingDevice();
      funnel.errored('account_creation', 'device-expired');
      return { ok: false, status: 'expired', message: 'The sign-in request expired. Call social_signin_start to try again.' };
    }
    if (res.status !== 'authorized') {
      funnel.errored('account_creation', res.reason || 'poll-failed');
      return { ok: false, status: 'error', reason: res.reason || 'poll-failed' };
    }

    // finalize enforces the order: NEW user -> complete-registration before the JWT exchange. freelanceType is a transient default.
    const rc = pending.registerContext || {};
    const registrationContext = buildRegistrationContext({
      preferredLanguage: rc.preferredLanguage || undefined,
      newsletterConsent: rc.newsletterConsent === true,
      freelanceType: rc.freelanceType || 'POTENTIAL_FREELANCE',
    });
    const fin = await finalizeDeviceSession({
      sessionToken: res.accessToken,
      isNewUser: res.isNewUser,
      authTokenEndpoint: pending.authTokenEndpoint,
      completeRegistrationEndpoint: getCompleteRegistrationEndpoint(),
      registrationContext,
      consent: pending.mode === 'register' ? buildRegistrationConsent({ newsletterConsent: rc.newsletterConsent === true }) : null,
    });
    if (!fin.ok) {
      funnel.errored('account_creation', fin.reason);
      // The authorization was consumed; a re-poll can't recover — never treat this as logged in.
      clearPendingDevice();
      return { ok: false, status: 'error', reason: fin.reason };
    }
    try {
      saveAuthSession(deviceSessionRecord({ token: fin.token, sessionToken: res.accessToken, sessionExpiresIn: res.expiresIn, email: res.email || pending.email || null }));
    } catch {
      clearPendingDevice();
      return { ok: false, status: 'error', reason: 'session-persist-failed' };
    }

    clearPendingDevice();
    funnel.completed('account_creation', { auth_method: pending.provider || 'google', auth_attempts: 1, is_returning_account: !res.isNewUser });
    if (funnel.active) funnel.identified({ newAccount: !!res.isNewUser });
    return { ok: true, status: 'authorized', method: pending.provider || 'google', email: res.email || null, isNewUser: !!res.isNewUser };
  }

  return [
    {
      name: 'social_signin_start',
      title: 'Sign in to Shakers',
      description: 'Opens a Shakers page in your browser where you sign in with Google, LinkedIn or your email. Your password never goes through the chat.',
      guidance: "Begin sign-in (or registration) via the device flow — provider 'google' (default), 'linkedin' or 'email'. Email goes through the SAME web flow: the talent reuses their open Shakers session or signs in with their email on the page, never a password in the chat. With mode 'register' it first asks the talent to accept the Terms and Privacy Policy and whether they want the newsletter (a dialog, or `say` to print word for word; pass their picks back as termsAnswer and newsletterAnswer, never your own); a decline creates nothing. Returns relayVerbatim with the Shakers link and the code: print it word for word — they open the link, check the code matches and approve in their own browser (you never invent or fill the code). After showing them, call social_signin_poll. Returns { ok, status, provider, verificationUrl, userCode, pollIntervalSeconds, relayVerbatim, ... }.",
      inputSchema: START_SCHEMA,
      handler: start,
    },
    {
      name: 'social_signin_poll',
      title: 'Finish signing in',
      description: 'Checks whether you finished signing in on that page and, if so, keeps you signed in on this computer.',
      guidance: "Check whether the talent has finished the social sign-in started by social_signin_start, and persist the session when they have. Call it after showing the code; if it returns status 'pending', wait pollIntervalSeconds and call it again — the 'pending' response repeats the verificationUrl and userCode so you can keep the clickable link in front of the talent. Returns status 'authorized' (session saved, with isNewUser + method), 'pending', 'denied', or 'expired'.",
      inputSchema: POLL_SCHEMA,
      handler: poll,
    },
  ];
}

module.exports = { makeDeviceLoginTools, START_SCHEMA, POLL_SCHEMA };
