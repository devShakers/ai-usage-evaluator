#!/usr/bin/env node
'use strict';

// `login` / `logout` — a registered Talent identifies themselves to the CLI.

const { detectReportLang, getCatalog } = require('../src/i18n');
const { getAuthTokenEndpoint, getDeviceAuthorizeEndpoint, getDeviceTokenEndpoint, getCompleteRegistrationEndpoint } = require('../src/config');
const { runDeviceLogin, withDeviceParams, deviceSessionRecord } = require('../src/device-login');
const { buildRegistrationContext } = require('../src/signup-client');
const { openPath } = require('../src/open-file');
const { endSession } = require('../src/session-refresh');
const { clearLocalReports } = require('../src/report-store');
const {
  saveAuthSession,
  loadAuthSession,
  sessionStatus,
} = require('../src/auth-session-store');
const { normalizeEmail, loadConsentState, clearConsentState } = require('../src/share');
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

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, openBrowser = undefined, stdinIsTTY: ttyOverride = undefined, input = undefined, output = undefined, sleep = undefined } = {},
) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const c = getCatalog(lang).login;

  // Every method signs in through the real web device flow (RFC 8628): the
  // Talent reuses an existing web session or signs in on the `/cli-login` page,
  // so no password is ever read in the terminal. Email now travels the same
  // path Google/LinkedIn already use; only the `provider` query differs.
  let method = null;
  if (opts.google) method = 'google';
  else if (opts.linkedin) method = 'linkedin';
  else if (opts.provider === 'email' || !!opts.email) method = 'email';

  if (!method) {
    const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;
    // An ACTIVE session is not silently overwritten, and the picker never shows.
    if (sessionStatus(loadAuthSession()) === 'active') {
      (output || process.stdout).write(`\n  ${c.alreadyLoggedIn}\n\n`);
      return;
    }
    if (stdinIsTTY) {
      // The picker offers Email, Google and LinkedIn.
      const pickerAsk = injectedAsk || createStdinAsk();
      try {
        method = await chooseLoginMethod({ ask: pickerAsk, stdinIsTTY, c, input, output });
      } finally {
        if (!injectedAsk) pickerAsk.close();
      }
      if (method === null) return; // esc/ctrl-c: cancelled, nothing sent
    } else {
      method = 'email'; // non-interactive default (matches the picker's own non-TTY default)
    }
  }

  return runDeviceFlow(method, c, { openBrowser, sleep, lang, output });
}

// Shared success path: persist the session (atomic 0600 store) and report.
// `output` lets a caller (and tests) redirect the human-facing lines; errors stay on stderr.
function persistAndReport(result, c, email = null, output = process.stdout) {
  if (email) {
    const prior = loadConsentState();
    if (prior && prior.email && normalizeEmail(prior.email) !== normalizeEmail(email)) {
      clearConsentState();
    }
  }
  try {
    saveAuthSession({
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      accessTokenExpiresAt: result.expiresAt,
      sessionToken: result.sessionToken || null,
      sessionExpiresAt: result.sessionExpiresAt || null,
      email,
      hubAccessToken: result.hubAccessToken || null,
    });
  } catch {
    process.stderr.write(`\n  ${c.errorPersist}\n\n`);
    process.exitCode = 1;
    return false;
  }
  output.write(`\n  ${c.success}\n`);
  if (result.expiresAt) output.write(`  ${c.expiresAt(result.expiresAt)}\n`);
  output.write(`\n  ${c.deviceGranted}\n\n`);
  return true;
}

// `login` for one method — one device flow (RFC 8628); only the `provider` query
// on the `/cli-login` URL differs (google | linkedin | email). Email reuses an
// existing web session or signs in on the page, with no password in the terminal.
async function runDeviceFlow(provider, c, { openBrowser = openPath, sleep = undefined, lang = 'en', output = process.stdout } = {}) {
  const authorizeEndpoint = getDeviceAuthorizeEndpoint();
  const tokenEndpoint = getDeviceTokenEndpoint();
  const authTokenEndpoint = getAuthTokenEndpoint();
  if (!authorizeEndpoint || !tokenEndpoint || !authTokenEndpoint) {
    process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }
  // A new account also needs complete-registration before the JWT (freelanceType is a transient default).
  const completeRegistrationEndpoint = getCompleteRegistrationEndpoint();
  const registrationContext = buildRegistrationContext({ preferredLanguage: lang, newsletterConsent: false, freelanceType: 'POTENTIAL_FREELANCE' });
  const providerName = provider === 'linkedin' ? c.methodLinkedin : provider === 'email' ? c.methodEmail : c.methodGoogle;

  // An ACTIVE session is not silently overwritten.
  const status = sessionStatus(loadAuthSession());
  if (status === 'active') {
    output.write(`\n  ${c.alreadyLoggedIn}\n\n`);
    return;
  }
  const intro = status === 'expired'
    ? c.sessionExpiredIntro
    : (provider === 'email' ? c.emailDeviceIntro : c.deviceIntro(providerName));
  output.write(`\n  ${intro}\n`);

  const result = await runDeviceLogin(
    { authorizeEndpoint, tokenEndpoint, authTokenEndpoint, completeRegistrationEndpoint, registrationContext },
    {
      ...(sleep ? { sleep } : {}),
      onPrompt: ({ verificationUriComplete, userCode }) => {
        const url = withDeviceParams(verificationUriComplete, { provider, mode: 'login', surface: 'cli' });
        output.write(`\n  ${c.deviceTrust}\n\n  ${c.deviceVisit}\n  ${url}\n\n  ${c.deviceCodeLabel(userCode)}\n\n  ${c.deviceWaiting}\n`);
        if (provider === 'email') output.write(`  ${c.deviceApproveHint}\n`);
        try { openBrowser(url); } catch { /* the printed URL covers it */ }
      },
    },
  );
  handleDeviceResult(result, c, output);
}

function handleDeviceResult(result, c, output = process.stdout) {
  if (result.ok) {
    return void persistAndReport(
      deviceSessionRecord(result),
      c,
      result.email || null,
      output,
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

// `logout`: revoke the hub session (best-effort) and forget the stored one.
async function runLogout(argv = process.argv.slice(2), { output = process.stdout } = {}) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const c = getCatalog(lang).login;
  const had = await endSession(process.env);
  clearConsentState();
  clearLocalReports(process.env);
  output.write(`\n  ${had ? c.loggedOut : c.notLoggedIn}\n\n`);
}

module.exports = { run, runLogout, chooseLoginMethod, parseArgs, hasMethodFlag };

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'logout') runLogout(argv.slice(1));
  else run(argv);
}
