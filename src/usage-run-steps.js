'use strict';

const { renderTerminal } = require('./render-terminal');
const { revealText } = require('./typewriter');
const { persistFootprint } = require('./report-store');
const {
  loadConsentState,
  getConsentDecision,
  autoShare,
  consentPath,
} = require('./share');
const { runConsentPrompt } = require('./consent-flow');
const { createStdinAsk } = require('./stdin-ask');
const { getAiProfileEndpoint } = require('./config');
// "My work with AI" preview, read from the hub ai-profile (same as the front).
const { resolveAiProfilePreview } = require('./ai-profile-preview');
const { renderAiProfileTerminal } = require('./render-ai-fluency');
const { ensureFreshSession } = require('./session-refresh');
const { loadAuthSession, sessionStatus } = require('./auth-session-store');
const { c: termColors } = require('./terminal-format');
const { withSpinner } = require('./terminal-progress');
const { computeConsentSkip } = require('./consent-skip');
const { collectIdentityAndUsage, storedAiConsent, reanchorReusedGrant } = require('./usage-scan');
const { doBuildNextLevel } = require('./usage-oneshot-commands');

// Automatic, silent PERSISTING once consent is `granted` (consent controls persistence only, never what's shown).
async function maybeAutoShare(report, maturity, root, catalog, { bypassThrottle = false } = {}) {
  try {
    const result = await autoShare(report, maturity, { root, bypassThrottle });
    if (result && result.ok && result.backend) {
      process.stdout.write(`  ${catalog.backendChain.saved(result.backend)}\n`);
      return result;
    }
    // Surface why a send was skipped/failed (user-language, stderr); null = quiet.
    if (result && result.reason) {
      const msg = catalog.sendStatus.reason(result.reason);
      if (msg) process.stderr.write(`  ${sendStatusColor(result.reason)}${msg}${termColors.reset}\n`);
    }
    return result || { ok: false, reason: null };
  } catch {
    try {
      const msg = catalog.sendStatus.reason('error');
      if (msg) process.stderr.write(`  ${termColors.danger}${msg}${termColors.reset}\n`);
    } catch { /* never break the local report over a notice */ }
    return { ok: false, reason: 'error' };
  }
}

const SEND_WARN_REASONS = new Set(['throttled', 'email-unverified', 'no-email', 'no-endpoint-configured']);
function sendStatusColor(reason) {
  return SEND_WARN_REASONS.has(reason) ? termColors.warning : termColors.danger;
}

// The identity gate + local (no-network, no-LLM) agent-usage signal.
function prepareIdentityAndUsage({ report, catalog, quiet = false }) {
  const identity = collectIdentityAndUsage({ report });
  // --json owns stdout: one parseable document, and the MCP's JSON-RPC channel.
  if (identity.gate.showFrameworkIntro && !quiet) process.stdout.write(`\n  ${catalog.cli.frameworkIntroUsage}\n`);
  return identity;
}

async function resolveAiConsent({ opts, catalog, gate, injectedAsk }) {
  // CONSENT GATE, MOVED TO BEFORE ANY AI/EGRESS CALL (explicit product decision, not a bug fix).
  if (opts.json) return storedAiConsent({ gate });
  const state = loadConsentState();
  const decision = getConsentDecision(state);
  const consentSkip = computeConsentSkip({
    decision,
    emailVerified: state ? state.emailVerified : undefined,
    stdinIsTTY: !!process.stdin.isTTY,
    consentFilePath: consentPath(),
    catalog,
  });

  let aiConsentGranted;
  // A REUSED grant (skip) carries a stale consent email; a fresh prompt re-anchors itself.
  let reusedStoredConsent = false;
  if (consentSkip.message) {
    process.stdout.write(`\n  ${consentSkip.message}\n`);
  }
  if (consentSkip.skip) {
    // A TERMINAL decision already exists (a prior run's explicit grant or
    // denial) — never re-asked.
    aiConsentGranted = decision === 'granted';
    reusedStoredConsent = true;
  } else {
    const ask = injectedAsk || createStdinAsk();
    let result;
    try {
      result = await runConsentPrompt({
        ask, catalog, loggedIn: gate.loggedIn, sessionEmail: gate.email, profile: gate.profile,
      });
    } finally {
      if (!injectedAsk) ask.close();
    }
    aiConsentGranted = result === 'granted';
  }
  if (!aiConsentGranted) {
    // No early return: the local report still renders further down.
    process.stdout.write(`\n  ${termColors.warning}${catalog.consent.noReportWithoutConsent}${termColors.reset}\n\n`);
  }
  if (reusedStoredConsent && aiConsentGranted) reanchorReusedGrant({ gate, state });
  return aiConsentGranted;
}

async function renderAndFinalize({ report, maturity, lang, opts, root, gate, catalog, bypassThrottle = false }) {
  if (opts.json) {
    process.stdout.write(JSON.stringify({ report, maturity }, null, 2) + '\n');
    return;
  }

  // Revealed by SECTIONS instead of landing in one write.
  if (gate.sessionStatus === 'expired') {
    process.stdout.write(`\n  ${termColors.warning}${catalog.terminal.sessionExpiredNotice}${termColors.reset}\n`);
  }

  await revealText(renderTerminal(report, maturity, lang, { showRoadmap: opts.roadmap, gate }) + '\n', {
    stream: process.stdout,
    animate: opts.noAnimation ? false : null,
  });

  if (opts.save) {
    try {
      persistFootprint({ root, report, maturity });
    } catch {
      // Never break the local run over a failed state write.
    }
  }

  // "Construir el siguiente nivel ahora": optional, only when
  // explicitly requested — never part of a normal run otherwise.
  if (opts.buildNextLevel) {
    doBuildNextLevel(root, maturity, opts.force, catalog);
  }

  // Auto-send at the end (bypassThrottle only true on the register path).
  const shareResult = await maybeAutoShare(report, maturity, root, catalog, { bypassThrottle });

  // "My work with AI" preview, best-effort after the send; never blocks/breaks the run.
  await maybeRenderAiProfile({ report, maturity, lang, root, save: opts.save, submitOk: !!(shareResult && shareResult.ok), catalog });
}

// A `ready` profile always shows; otherwise the "being evaluated"/setup-only note only shows when this run's submit succeeded.
function shouldRenderAiProfile({ submitOk, status } = {}) {
  return status === 'ready' || !!submitOk;
}

// Previews the hub "My work with AI" profile (matrix + vision E + howIWork F +
// traction). Shared source with the MCP tool. Setup-only without session/consent.
async function maybeRenderAiProfile({ report, maturity, lang, root, save, submitOk = true, catalog }, deps = {}) {
  const {
    resolve = resolveAiProfilePreview,
    refreshToken = async () => {
      const fresh = await ensureFreshSession(process.env);
      return fresh ? { accessToken: fresh.accessToken, hubAccessToken: fresh.hubAccessToken } : null;
    },
    spin = withSpinner,
    out = process.stdout,
    loadSession = loadAuthSession,
    consentDecision = () => getConsentDecision(loadConsentState()),
  } = deps;
  try {
    const session = loadSession();
    const hasSession = sessionStatus(session) === 'active';
    const consentGranted = consentDecision() === 'granted';
    if (!hasSession || !consentGranted) return;

    const result = await spin(
      catalog.terminal.aiProfileGenerating,
      () => resolve({ session, endpoint: getAiProfileEndpoint() }, { refreshToken }),
    );
    // A failed submit means nothing is in flight — don't tease "being evaluated"/setup-only.
    if (!shouldRenderAiProfile({ submitOk, status: result && result.status })) return;

    if (result.status === 'ready') {
      // Re-persist so the HTML report and later state reads show the preview too.
      report.aiWorkPreview = result.preview;
      if (save) {
        try {
          persistFootprint({ root, report, maturity });
        } catch {
          // never break the run over a state re-write
        }
      }
      const block = renderAiProfileTerminal(result, { lang, c: termColors });
      if (block) out.write(`\n${block}\n`);
      return;
    }

    out.write(`\n  ${catalog.terminal.aiProfilePendingRetry}\n`);
  } catch {
    // Never break the local run over the (optional) preview.
  }
}

module.exports = {
  prepareIdentityAndUsage,
  resolveAiConsent,
  renderAndFinalize,
  shouldRenderAiProfile,
  maybeRenderAiProfile,
};
