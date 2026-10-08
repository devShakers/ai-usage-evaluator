'use strict';

const { scan, scanForRoots } = require('./scanner');
const { classify } = require('./maturity');
const { renderTerminal } = require('./render-terminal');
const { reportGateForIdentity } = require('./report-gating');
const { revealText } = require('./typewriter');
const { persistFootprint } = require('./report-store');
const {
  loadConsentState,
  getConsentDecision,
  recordConsent,
  isValidEmail,
  normalizeEmail,
  autoShare,
  consentPath,
} = require('./share');
const { runConsentPrompt } = require('./consent-flow');
const { createStdinAsk } = require('./stdin-ask');
const {
  parseAgentDescriptions,
  parseAgentOrgChartForRoots,
  parseAgentDescriptionsForRoots,
  parseAgentDefinitionsForRoots,
} = require('./agent-org-chart');
const { collectAgentUsage } = require('./agent-usage');
const { collectSessionSignals } = require('./session-signals');
const {
  collectScopedGitActivity,
  collectScopedWorkStreams,
  collectScopedDetectionEvidence,
} = require('./scope-signals');
const { MODEL_CALL, REASON, skipped, attachModelCall } = require('./model-call-record');
const {
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getAgentEvaluationEndpoint,
  getAiProfileEndpoint,
} = require('./config');
// "My work with AI" preview, read from the hub ai-profile (same as the front).
const { resolveAiProfilePreview } = require('./ai-profile-preview');
const { renderAiProfileTerminal } = require('./render-ai-fluency');
const { ensureFreshSession } = require('./session-refresh');
const { loadAuthSession, sessionStatus } = require('./auth-session-store');
const { c: termColors } = require('./terminal-format');
const { withStaticStatus, withSpinner } = require('./terminal-progress');
const { computeConsentSkip } = require('./consent-skip');
const { getRoadmapEntry } = require('./roadmap-content');
const {
  maybeSynthesizeAgents,
  maybeEvaluateAgents,
  maybePersonalizeRoadmap,
} = require('./usage-model-calls');
const { doBuildNextLevel } = require('./usage-oneshot-commands');

// Automatic, silent PERSISTING once consent is `granted` (ADR-007, gating revised by ADR-011: consent controls persistence only, never what's shown).
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

function performScan({ opts, catalog }) {
  const root = opts.root;
  const report = withStaticStatus(catalog.cli.scanningLabel, () => scan({ root }));
  // `let`, not `const`: this is the cwd tier.
  const maturity = classify(report);

  if (Array.isArray(report.agents) && report.agents.length > 0) {
    report.agentDescriptions = parseAgentDescriptions(root || process.cwd());
  }

  return { report, maturity, root, rootDir: root || process.cwd() };
}

// The identity gate + local (no-network, no-LLM) agent-usage signal.
function prepareIdentityAndUsage({ report, catalog, quiet = false }) {
  const hasAgents = Array.isArray(report.agents) && report.agents.length > 0;
  const gate = reportGateForIdentity();

  // --json owns stdout: one parseable document, and the MCP's JSON-RPC channel.
  if (gate.showFrameworkIntro && !quiet) process.stdout.write(`\n  ${catalog.cli.frameworkIntroUsage}\n`);

  // Local, no network, no LLM: how often each detected agent was invoked in the local Claude Code history.
  if (hasAgents) report.agentUsage = collectAgentUsage(report.agents);

  return { gate, hasAgents };
}

async function resolveAiConsent({ opts, catalog, gate, injectedAsk }) {
  // CONSENT GATE, MOVED TO BEFORE ANY AI/EGRESS CALL (talents-ai-score, ADR-051 — explicit product decision that AMENDS ADR-010/011/003 on purpose, not a bug fix).
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
  // A REUSED grant (skip/--json) carries a stale consent email; a fresh prompt re-anchors itself.
  let reusedStoredConsent = false;
  if (opts.json) {
    // `--json` never had an interactive prompt — its whole point is a single parseable stdout document, and it does not gain one now.
    aiConsentGranted = decision === 'granted' && (!state || state.emailVerified !== false);
    reusedStoredConsent = true;
  } else {
    if (consentSkip.message) {
      process.stdout.write(`\n  ${consentSkip.message}\n`);
    }
    if (consentSkip.skip) {
      // A TERMINAL decision already exists (a prior run's explicit grant or
      // denial) — never re-asked, per ADR-007/011.
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
      // No early return (reverted 8867450's wall): the local report still renders further down, same as ADR-011 always promised.
      process.stdout.write(`\n  ${termColors.warning}${catalog.consent.noReportWithoutConsent}${termColors.reset}\n\n`);
    }
  }
  // Re-anchor a reused grant to the session's login-proven email (ADR-006): else a stale consent email ingests the report under another account and this session's AI profile never populates.
  if (reusedStoredConsent && aiConsentGranted && gate.loggedIn
    && isValidEmail(gate.email) && state && state.email !== normalizeEmail(gate.email)) {
    recordConsent('granted', gate.email, { verified: true });
  }
  return aiConsentGranted;
}

function runAggregation({ report, scope, consentEmail, agentRoots, root, catalog }) {
  withStaticStatus(catalog.cli.aggregatingLabel, () => {
    report.gitActivity = collectScopedGitActivity(scope.toplevels, consentEmail);
    const sessionSignals = collectSessionSignals(process.env, scope.selectedCwds);
    report.sessions = sessionSignals.sessions;
    report.workStreams = collectScopedWorkStreams(scope.toplevels);
    report.steering = sessionSignals.steering;
    report.decisions = sessionSignals.decisions;
    report.detectionEvidence = collectScopedDetectionEvidence(
      scope.toplevels,
      consentEmail,
      report,
    );

    const scoped = scanForRoots(agentRoots, { root });
    report.tools = scoped.tools;
    report.summary = scoped.summary;
    report.technologies = scoped.technologies;
    report.mcp = scoped.mcp;
    report.memory = scoped.memory;
    report.automations = scoped.automations;
    report.browserTools = scoped.browserTools;
    report.agentCounts = scoped.agentCounts;
    report.environment = scoped.environment;

    report.agents = parseAgentOrgChartForRoots(agentRoots);
    report.agentCounts.agents = report.agents.length;
    if (report.agents.length > 0) {
      report.agentDescriptions = parseAgentDescriptionsForRoots(agentRoots);
      report.agentDefinitions = parseAgentDefinitionsForRoots(agentRoots);
      report.agentUsage = collectAgentUsage(report.agents);
    }
  });
}

async function runModelCalls({
  report, maturity, aiConsentGranted, opts, gate, hasAgents, agentRoots, rootDir, lang, catalog,
}) {
  // Which of the three will genuinely be ATTEMPTED.
  const willAttemptSynthesis = aiConsentGranted && hasAgents && !!getSynthesisEndpoint();
  const willAttemptEvaluation = aiConsentGranted && hasAgents && !!getAgentEvaluationEndpoint();
  const roadmapEntryForTier = maturity.tierKey ? getRoadmapEntry(maturity.tierKey, lang) : null;
  const willAttemptRoadmapPersonalization =
    aiConsentGranted
    && gate.showRoadmap
    && !!roadmapEntryForTier && !roadmapEntryForTier.maxTier
    && !!getRoadmapEndpoint();

  // THE THREE MODEL CALLS RUN ONE AFTER ANOTHER, NOT IN PARALLEL (issue 116).
  const runPhase = (willAttempt, label, call) => (willAttempt ? withSpinner(label, call) : call());

  // talents-ai-score, ADR-051: `aiConsentGranted` is `false` whenever consent for this run was declined, denied in the past, or (on `--json`) simply never granted.
  let synthesis = null;
  let evaluation = null;
  let roadmapPersonalization = null;
  if (aiConsentGranted && !opts.noAi) {
    synthesis = await runPhase(
      willAttemptSynthesis,
      catalog.cli.synthesizingLabel,
      () => maybeSynthesizeAgents(report, rootDir),
    );
    evaluation = hasAgents
      ? await runPhase(
        willAttemptEvaluation,
        catalog.cli.evaluatingAgentsLabel,
        () => maybeEvaluateAgents(report, agentRoots, lang),
      )
      : null;
    // issue 123 / ADR-044: `runPhase` runs `call()` whether or not a spinner is shown, so gating the roadmap CANNOT be done by flipping `willAttempt` — that only hides the spinner.
    roadmapPersonalization = gate.showRoadmap
      ? await runPhase(
        willAttemptRoadmapPersonalization,
        catalog.cli.personalizingRoadmapLabel,
        () => maybePersonalizeRoadmap(report, maturity, lang),
      )
      : null;
  } else {
    const skipReason = aiConsentGranted ? REASON.NOT_APPLICABLE : REASON.NO_CONSENT;
    attachModelCall(report, MODEL_CALL.SYNTHESIS, skipped(skipReason));
    attachModelCall(report, MODEL_CALL.EVALUATION, skipped(skipReason));
    attachModelCall(report, MODEL_CALL.ROADMAP, skipped(skipReason));
  }

  if (synthesis) report.agentSynthesis = synthesis;
  if (evaluation) report.agentEvaluation = evaluation;
  if (roadmapPersonalization) report.roadmapPersonalization = roadmapPersonalization;
}

async function renderAndFinalize({ report, maturity, lang, opts, root, gate, catalog, bypassThrottle = false }) {
  if (opts.json) {
    process.stdout.write(JSON.stringify({ report, maturity }, null, 2) + '\n');
    return;
  }

  // Issue 103: revealed by SECTIONS instead of landing in one write.
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

  // "Construir el siguiente nivel ahora" (issue 021): optional, only when
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
  performScan,
  prepareIdentityAndUsage,
  resolveAiConsent,
  runAggregation,
  runModelCalls,
  renderAndFinalize,
  shouldRenderAiProfile,
  maybeRenderAiProfile,
};
