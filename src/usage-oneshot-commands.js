'use strict';

// One-shot command handlers extracted from bin/ai-usage.js (structure refactor, issue 020).

const {
  getConsentStatus,
  revokeConsent,
  resetConsent,
  setEmail,
} = require('./share');
const { createStdinAsk } = require('./stdin-ask');
const {
  setIngestEndpoint,
  resolveIngestEndpoint,
  hasRetiredFallbackConfig,
  isTalentProfile,
} = require('./config');
const { buildNextLevelStarter } = require('./build-next-level');

// One-shot consent management commands (issue 007). Mirror the retired
// `--enroll` pattern: they act immediately and do NOT scan.

function doConsentStatus(catalog) {
  const status = getConsentStatus();
  const s = catalog.consent.status;
  process.stdout.write(`\n  ${s.heading}\n\n`);
  const decisionLine =
    status.consent === 'granted' ? s.decisionGranted
    : status.consent === 'denied' ? s.decisionDenied
    : s.decisionNone;
  process.stdout.write(`  ${decisionLine}\n`);
  process.stdout.write(`  ${s.email(status.email)}\n`);
  if (status.consent === 'granted' && status.email && !status.emailVerified) {
    process.stdout.write(`  ${isTalentProfile() ? s.verificationPending : s.emailUnverifiedExternal}\n`);
  }
  process.stdout.write(`  ${s.lastSentAt(status.lastSentAt)}\n\n`);
}

function doConsentRevoke(catalog) {
  revokeConsent();
  process.stdout.write(`\n  ${catalog.consent.revoked}\n\n`);
}

// skill-code-certification / ADR-003: clears the decision back to "no decision yet" so the consent question is asked again next run — distinct from revoke (which persists `denied`).
function doConsentReset(catalog) {
  resetConsent();
  process.stdout.write(`\n  ${catalog.consent.reset}\n\n`);
}

function doConsentEmail(newEmail, catalog) {
  const r = setEmail(newEmail);
  if (r.ok) {
    process.stdout.write(`\n  ${catalog.consent.emailChanged(r.state.email)}\n\n`);
  } else {
    process.stdout.write(`\n  ${catalog.consent.emailInvalidCli}\n\n`);
    process.exitCode = 1;
  }
}

async function confirmEndpointHost(host, ask, catalog) {
  const e = catalog.endpoint;
  const answer = await ask(e.confirmHostPrompt(host));
  return String(answer || '').trim() === host;
}

// Endpoint config (endpoint-config task): one-shot, don't scan.
async function doSetEndpoint(url, catalog, ask) {
  const e = catalog.endpoint;
  let r = setIngestEndpoint(url);
  if (!r.ok && r.reason === 'needs-confirmation') {
    const confirmed = await confirmEndpointHost(r.host, ask, catalog);
    if (!confirmed) {
      process.stdout.write(`\n  ${e.confirmHostMismatch}\n\n`);
      process.exitCode = 1;
      return;
    }
    r = setIngestEndpoint(url, process.env, { confirmed: true });
  }
  if (r.ok) {
    process.stdout.write(`\n  ${e.setOk(r.value, r.path)}\n\n`);
  } else {
    const msg =
      r.reason === 'insecure-remote' ? e.errInsecureRemote
      : r.reason === 'invalid-url' || r.reason === 'bad-protocol' ? e.errInvalidUrl
      : e.errEmpty;
    process.stdout.write(`\n  ${msg}\n\n`);
    process.exitCode = 1;
  }
}

// Print the effective ingest endpoint(s) and where each resolved from (env var > config file > none), so a Talent can see what's configured without editing or exporting anything.
function doShowEndpoint(catalog) {
  const e = catalog.endpoint;
  const r = resolveIngestEndpoint();
  if (r.source === 'env') {
    process.stdout.write(`\n  ${e.showEnv(r.endpoint)}\n\n`);
  } else if (r.source === 'config-file') {
    process.stdout.write(`\n  ${e.showConfigFile(r.endpoint, r.path)}\n\n`);
  } else if (r.source === 'config-file-invalid') {
    process.stdout.write(`\n  ${e.showConfigInvalid(r.path)}\n\n`);
  } else {
    process.stdout.write(`\n  ${e.showNone}\n\n`);
  }

  // ADR-042: there is no second hop any more.
  if (hasRetiredFallbackConfig()) {
    process.stdout.write(`  ${e.showFallbackRetired}\n\n`);
  }

}

// "Construir el siguiente nivel ahora" (issue 021): optional, explicit phase — never runs unless the talent asks for it via --build-next-level.
function doBuildNextLevel(root, maturity, force, catalog) {
  const b = catalog.buildNextLevel;
  const result = buildNextLevelStarter(root || process.cwd(), maturity.tierKey, { force });

  if (!result.ok) {
    const message =
      result.reason === 'max-tier' ? b.maxTier
      : result.reason === 'no-file-target' ? b.noFileTarget
      : b.unrecognizedTier;
    process.stdout.write(`\n  ${message}\n\n`);
    return;
  }

  process.stdout.write(`\n  ${b.heading(result.targetTierKey)}\n`);
  for (const f of result.files) {
    const line =
      f.status === 'created' ? b.created(f.filename)
      : f.status === 'overwritten' ? b.overwritten(f.filename)
      : b.skippedExists(f.filename);
    process.stdout.write(`    ${line}\n`);
  }
  process.stdout.write('\n');
}

// The one-shot dispatch that used to sit at the top of `run()`: each command acts immediately and returns, without scanning.
async function handleOneShotCommand({ opts, catalog, injectedAsk }) {
  if (opts.consentStatus) {
    doConsentStatus(catalog);
    return true;
  }
  if (opts.consentRevoke) {
    doConsentRevoke(catalog);
    return true;
  }
  if (opts.consentReset) {
    doConsentReset(catalog);
    return true;
  }
  if (opts.consentEmail) {
    doConsentEmail(opts.consentEmail, catalog);
    return true;
  }
  if (opts.setEndpoint !== null) {
    const ask = injectedAsk || createStdinAsk();
    try {
      await doSetEndpoint(opts.setEndpoint, catalog, ask);
    } finally {
      if (!injectedAsk) ask.close();
    }
    return true;
  }
  if (opts.showEndpoint) {
    doShowEndpoint(catalog);
    return true;
  }
  return false;
}

module.exports = {
  handleOneShotCommand,
  doConsentStatus,
  doConsentRevoke,
  doConsentReset,
  doConsentEmail,
  doSetEndpoint,
  doShowEndpoint,
  doBuildNextLevel,
};
