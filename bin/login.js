#!/usr/bin/env node
'use strict';

// `login` / `logout` — a registered Talent identifies themselves to the CLI (talents-ai-score, issue 122 / ADR-044).

const { detectReportLang, getCatalog } = require('../src/i18n');
const { getLoginEndpoint, getAuthTokenEndpoint, getDeviceAuthorizeEndpoint, getDeviceTokenEndpoint, getCompleteRegistrationEndpoint } = require('../src/config');
const { requestLogin } = require('../src/auth-client');
const { runDeviceLogin, appendProviderParam } = require('../src/device-login');
const { buildRegistrationContext } = require('../src/signup-client');
const { openPath } = require('../src/open-file');
const {
  saveAuthSession,
  clearAuthSession,
  loadAuthSession,
  sessionStatus,
} = require('../src/auth-session-store');
const { isValidEmail, normalizeEmail, loadConsentState, clearConsentState } = require('../src/share');
const { createStdinAsk } = require('../src/stdin-ask');
const { chooseAuthMethod } = require('../src/auth-method-picker');

// Minimal flag parse: --email, --lang, --google, --linkedin, --provider.
function parseArgs(argv) {
  const opts = { email: null, lang: null, google: false, linkedin: false, provider: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') opts.email = argv[++i];
    else if (a.startsWith('--email=')) opts.email = a.slice('--email='.length);
    else if (a === '--google') opts.google = true;
    else if (a === '--linkedin') opts.linkedin = true;
    else if (a === '--provider' && argv[i + 1] === 'google') { opts.google = true; opts.provider = 'google'; i++; }
    else if (a === '--provider=google') { opts.google = true; opts.provider = 'google'; }
    else if (a === '--provider' && argv[i + 1] === 'linkedin') { opts.linkedin = true; opts.provider = 'linkedin'; i++; }
    else if (a === '--provider=linkedin') { opts.linkedin = true; opts.provider = 'linkedin'; }
    else if (a === '--provider' && argv[i + 1] === 'email') { opts.provider = 'email'; i++; }
    else if (a === '--provider=email') opts.provider = 'email';
    else if (a === '--lang' && (argv[i + 1] === 'es' || argv[i + 1] === 'en')) opts.lang = argv[++i];
    else if (a === '--lang=es') opts.lang = 'es';
    else if (a === '--lang=en') opts.lang = 'en';
  }
  return opts;
}

function hasMethodFlag(opts) {
  return opts.google || opts.linkedin || opts.provider === 'email' || !!opts.email;
}

// The interactive method picker for `login`.
async function chooseLoginMethod({ ask, stdinIsTTY, c, input, output }) {
  return chooseAuthMethod({ flow: 'login', ask, stdinIsTTY, catalog: c, input, output });
}

// The SECRET prompt (issue 102) — falls back to the ordinary line read on a pipe, which `ask()` still services.
async function promptSecret(ask, label) {
  const read = typeof ask.secret === 'function' ? ask.secret.bind(ask) : ask;
  return String(await read(label)).trim();
}

async function resolveEmail(opts, c, ask) {
  if (opts.email) return String(opts.email).trim();
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = String(await ask(c.emailPrompt)).trim();
    if (raw === '') return null; // EOF / empty line / cancel
    if (isValidEmail(raw)) return raw;
    process.stdout.write(`  ${c.emailInvalid}\n`);
  }
  return null;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, openBrowser = undefined, stdinIsTTY: ttyOverride = undefined, input = undefined, output = undefined, sleep = undefined } = {},
) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const c = getCatalog(lang).login;

  if (opts.google) return runSocial('google', c, { openBrowser, sleep, lang });
  if (opts.linkedin) return runSocial('linkedin', c, { openBrowser, sleep, lang });

  // No method flag: offer the picker (ADR-041/046 — Email, Google and LinkedIn; LinkedIn pending Hub OAuth provisioning).
  if (!hasMethodFlag(opts)) {
    const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;
    if (stdinIsTTY) {
      if (sessionStatus(loadAuthSession()) === 'active') {
        process.stdout.write(`\n  ${c.alreadyLoggedIn}\n\n`);
        return;
      }
      const pickerAsk = injectedAsk || createStdinAsk();
      let method;
      try {
        method = await chooseLoginMethod({ ask: pickerAsk, stdinIsTTY, c, input, output });
      } finally {
        if (!injectedAsk) pickerAsk.close();
      }
      if (method === null) return; // esc/ctrl-c: cancelled, nothing sent
      if (method === 'google' || method === 'linkedin') return runSocial(method, c, { openBrowser, sleep, lang });
      // method === 'email' falls through to the unchanged flow below.
    }
  }

  const endpoint = getLoginEndpoint();
  if (!endpoint) {
    process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }

  // ADR-044: an ACTIVE session is not silently overwritten — the Talent is told, and pointed at `logout` to switch accounts.
  const status = sessionStatus(loadAuthSession());
  if (status === 'active') {
    process.stdout.write(`\n  ${c.alreadyLoggedIn}\n\n`);
    return;
  }
  process.stdout.write(`\n  ${status === 'expired' ? c.sessionExpiredIntro : c.intro}\n`);

  const ask = injectedAsk || createStdinAsk();
  try {
    const email = await resolveEmail(opts, c, ask);
    if (!email || !isValidEmail(email)) {
      process.stderr.write(`\n  ${c.needInput}\n\n`);
      process.exitCode = 1;
      return;
    }
    const password = await promptSecret(ask, c.passwordPrompt);
    if (!password) {
      process.stderr.write(`\n  ${c.needInput}\n\n`);
      process.exitCode = 1;
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    // better-auth email login: sign-in captures the session cookie, then a hub
    // JWT is minted from it (auth-client.js). `endpoint` is the sign-in URL.
    const result = await requestLogin(
      { email: normalizedEmail, password },
      { signInEndpoint: endpoint, tokenEndpoint: getAuthTokenEndpoint() },
    );
    handleResult(result, c, normalizedEmail);
  } finally {
    if (!injectedAsk) ask.close();
  }
}

// Shared success path: persist the session (atomic 0600 store) and report.
function persistAndReport(result, c, email = null) {
  if (email) {
    const prior = loadConsentState();
    if (prior && prior.email && normalizeEmail(prior.email) !== normalizeEmail(email)) {
      clearConsentState();
    }
  }
  try {
    // `cookie`/`cookieExpiresAt` are present for the email (better-auth) flow and
    // absent for Google (auth-works JWT) — saveAuthSession picks the right model.
    saveAuthSession({
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      accessTokenExpiresAt: result.expiresAt,
      cookie: result.cookie || null,
      cookieExpiresAt: result.cookieExpiresAt || null,
      email,
      hubAccessToken: result.hubAccessToken || null,
    });
  } catch {
    process.stderr.write(`\n  ${c.errorPersist}\n\n`);
    process.exitCode = 1;
    return false;
  }
  process.stdout.write(`\n  ${c.success}\n`);
  if (result.expiresAt) process.stdout.write(`  ${c.expiresAt(result.expiresAt)}\n`);
  process.stdout.write('\n');
  return true;
}

// `typedEmail` is what the CALLER typed/passed as `--email` for THIS attempt.
function handleResult(result, c, typedEmail = null) {
  if (result.ok) return void persistAndReport(result, c, result.email || typedEmail);

  // One message per contract reason (ADR-044) — each names the cause (issue 109).
  const messageFor = {
    'invalid-credentials': c.errorInvalidCredentials,
    'no-email-password': c.errorNoEmailPassword,
    upstream: c.errorUpstream,
    // Creds were good but the hub JWT could not be minted from the cookie.
    'token-fetch-failed': c.errorUpstream,
    timeout: c.errorUnreachable,
    'network-error': c.errorUnreachable,
    'invalid-url': c.errorConfig,
    'no-endpoint': c.errorNoEndpoint,
    'bad-response': c.errorGeneric,
    'http-error': c.errorGeneric,
    'local-error': c.errorGeneric,
  };
  process.stderr.write(`\n  ${messageFor[result.reason] || c.errorGeneric}\n\n`);
  process.exitCode = 1;
}

// `login --google` / `--linkedin` — one device flow (RFC 8628); only the `provider` query on the URL differs.
async function runSocial(provider, c, { openBrowser = openPath, sleep = undefined, lang = 'en' } = {}) {
  const authorizeEndpoint = getDeviceAuthorizeEndpoint();
  const tokenEndpoint = getDeviceTokenEndpoint();
  const authTokenEndpoint = getAuthTokenEndpoint();
  if (!authorizeEndpoint || !tokenEndpoint || !authTokenEndpoint) {
    process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }
  // A new social account also needs complete-registration before the JWT (freelanceType is a transient default).
  const completeRegistrationEndpoint = getCompleteRegistrationEndpoint();
  const registrationContext = buildRegistrationContext({ preferredLanguage: lang, newsletterConsent: false, freelanceType: 'POTENTIAL_FREELANCE' });
  const providerName = provider === 'linkedin' ? c.methodLinkedin : c.methodGoogle;

  // Same as email: an ACTIVE session is not silently overwritten.
  const status = sessionStatus(loadAuthSession());
  if (status === 'active') {
    process.stdout.write(`\n  ${c.alreadyLoggedIn}\n\n`);
    return;
  }
  process.stdout.write(`\n  ${status === 'expired' ? c.sessionExpiredIntro : c.deviceIntro(providerName)}\n`);

  const result = await runDeviceLogin(
    { authorizeEndpoint, tokenEndpoint, authTokenEndpoint, completeRegistrationEndpoint, registrationContext },
    {
      ...(sleep ? { sleep } : {}),
      onPrompt: ({ verificationUriComplete, userCode }) => {
        const url = appendProviderParam(verificationUriComplete, provider);
        process.stdout.write(`\n  ${c.deviceVisit}\n  ${url}\n\n  ${c.deviceCodeLabel(userCode)}\n\n  ${c.deviceWaiting}\n`);
        try { openBrowser(url); } catch { /* the printed URL covers it */ }
      },
    },
  );
  handleSocialResult(result, c);
}

function handleSocialResult(result, c) {
  if (result.ok) {
    // Map the device-flow JWT to the shared persist shape (no cookie).
    return void persistAndReport(
      { accessToken: result.token, hubAccessToken: result.token, email: result.email || null },
      c,
      result.email || null,
    );
  }

  const messageFor = {
    expired: c.deviceErrorExpired,
    denied: c.deviceErrorDenied,
    'authorize-failed': c.deviceErrorGeneric,
    'poll-failed': c.deviceErrorGeneric,
    'token-exchange-failed': c.errorUpstream,
    'complete-registration-failed': c.errorUpstream,
    upstream: c.errorUpstream,
    timeout: c.errorUnreachable,
    'network-error': c.errorUnreachable,
    'invalid-url': c.errorConfig,
    'no-endpoint': c.errorNoEndpoint,
    'bad-response': c.deviceErrorGeneric,
    'http-error': c.deviceErrorGeneric,
    'local-error': c.deviceErrorGeneric,
  };
  process.stderr.write(`\n  ${messageFor[result.reason] || c.deviceErrorGeneric}\n\n`);
  process.exitCode = 1;
}

// `logout` — local only (no endpoint, no network): forget the stored session.
async function runLogout(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const c = getCatalog(lang).login;
  const had = loadAuthSession() !== null;
  clearAuthSession();
  clearConsentState();
  process.stdout.write(`\n  ${had ? c.loggedOut : c.notLoggedIn}\n\n`);
}

module.exports = { run, runLogout, chooseLoginMethod, parseArgs, hasMethodFlag };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'logout') runLogout(argv.slice(1));
  else run(argv);
}
