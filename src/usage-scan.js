'use strict';

const { scan, scanForRoots } = require('./scanner');
const { classify } = require('./maturity');
const { reportGateForIdentity } = require('./report-gating');
const {
  loadConsentState,
  getConsentDecision,
  recordConsent,
  isValidEmail,
  normalizeEmail,
} = require('./share');
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
const { detectAuthorshipMismatch } = require('./authorship-mismatch');
const { MODEL_CALL, REASON, skipped, attachModelCall } = require('./model-call-record');
const {
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getAgentEvaluationEndpoint,
} = require('./config');
const { withStaticStatus, withSpinner } = require('./terminal-progress');
const { getRoadmapEntry } = require('./roadmap-content');
const {
  maybeSynthesizeAgents,
  maybeEvaluateAgents,
  maybePersonalizeRoadmap,
} = require('./usage-model-calls');
const { parseArgs } = require('./cli-args');
const { detectReportLang, getCatalog } = require('./i18n');
const { prefetchGitLogs } = require('./git-log-prefetch');
const { GIT_ACTIVITY_LOG_ARGS } = require('./git-activity');
const { WORK_STREAMS_LOG_ARGS } = require('./work-streams');
const { AUTHORSHIP_LOG_ARGS } = require('./authorship');
const { resolveRepoScope } = require('./repo-scope');
const { fetchProfileAgentNames } = require('./profile-agents');

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

function collectIdentityAndUsage({ report }) {
  const hasAgents = Array.isArray(report.agents) && report.agents.length > 0;
  const gate = reportGateForIdentity();
  if (hasAgents) report.agentUsage = collectAgentUsage(report.agents);
  return { gate, hasAgents };
}

// Re-anchor a reused grant to the session's login-proven email: else a stale consent email ingests the report under another account and this session's AI profile never populates.
function reanchorReusedGrant({ gate, state }) {
  if (gate.loggedIn && isValidEmail(gate.email) && state && state.email !== normalizeEmail(gate.email)) {
    recordConsent('granted', gate.email, { verified: true });
  }
}

// `--json` never had an interactive prompt — its whole point is a single parseable stdout document, and it does not gain one now.
function storedAiConsent({ gate }) {
  const state = loadConsentState();
  const granted = getConsentDecision(state) === 'granted' && (!state || state.emailVerified !== false);
  if (granted) reanchorReusedGrant({ gate, state });
  return granted;
}

function runAggregation({ report, scope, consentEmail, agentRoots, root, catalog }) {
  withStaticStatus(catalog.cli.aggregatingLabel, () => {
    report.gitActivity = collectScopedGitActivity(scope.toplevels, consentEmail);
    // Display-only transparency warning (never feeds scoring, see authorship-mismatch.js).
    report.authorshipMismatch = detectAuthorshipMismatch(scope.toplevels, consentEmail, report.gitActivity);
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
  const roadmapRequested = opts.roadmap === true && gate.showRoadmap;
  const willAttemptRoadmapPersonalization =
    aiConsentGranted
    && roadmapRequested
    && !!roadmapEntryForTier && !roadmapEntryForTier.maxTier
    && !!getRoadmapEndpoint();

  // THE THREE MODEL CALLS RUN ONE AFTER ANOTHER, NOT IN PARALLEL.
  const runPhase = (willAttempt, label, call) => (willAttempt ? withSpinner(label, call) : call());

  // `aiConsentGranted` is `false` whenever consent for this run was declined, denied in the past, or (on `--json`) simply never granted.
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
    // `runPhase` runs `call()` whether or not a spinner is shown, so gating the roadmap CANNOT be done by flipping `willAttempt` — that only hides the spinner.
    roadmapPersonalization = roadmapRequested
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

// Steps 1-6 of a run: scan, scope, aggregate, classify; nothing is rendered or sent.
async function computeUsage({
  opts,
  catalog,
  lang,
  inRegistration = false,
  prepareIdentity = collectIdentityAndUsage,
  resolveConsent = storedAiConsent,
  resolveScope = resolveRepoScope,
  listProfileAgents = fetchProfileAgentNames,
}) {
  // 1. Local scan + classify (always computed and shown).
  const { report, root, rootDir } = performScan({ opts, catalog });

  // 2. Identity gate + local agent-usage signal.
  const { gate: identityGate } = prepareIdentity({ report, catalog, quiet: opts.json === true });
  const gate = (inRegistration && identityGate.showRoadmap)
    ? { ...identityGate, showRoadmap: false }
    : identityGate;

  // 3. Consent gate before any AI/egress call; a decline still renders.
  const aiConsentGranted = await resolveConsent({ opts, catalog, gate });

  // 4. Repo scoping (exclude client work).
  const scope = await resolveScope({ opts, cwd: rootDir, catalog });
  const consentEmail = (loadConsentState() || {}).email || null;
  const agentRoots = scope.toplevels;

  // 5. Aggregate scoped signals + rebuild scan/org-chart over the selection, re-classify.
  await prefetchGitLogs(agentRoots, [GIT_ACTIVITY_LOG_ARGS, WORK_STREAMS_LOG_ARGS, AUTHORSHIP_LOG_ARGS]);
  runAggregation({ report, scope, consentEmail, agentRoots, root, catalog });
  report.profileAgentNames = await listProfileAgents(process.env);
  const maturity = classify(report);
  const hasAgents = Array.isArray(report.agents) && report.agents.length > 0;
  report.analyzedRepos =
    scope.mode === 'all'
      ? null
      : scope.toplevels.map((tl) => tl.split(/[/\\]/).pop() || tl);

  // 6. The three ephemeral model calls, serialized and gated by consent.
  await runModelCalls({
    report, maturity, aiConsentGranted, opts, gate, hasAgents, agentRoots, rootDir, lang, catalog,
  });
  return { report, maturity, root, gate, repos: scope.toplevels };
}

// The MCP's scan: same steps, returned instead of printed, since stdout is its JSON-RPC channel.
async function scanUsage(argv) {
  const opts = { ...parseArgs(argv), roadmap: false };
  const lang = opts.lang || detectReportLang();
  const { report, maturity, repos } = await computeUsage({ opts, catalog: getCatalog(lang), lang });
  return { report, maturity, repos };
}

module.exports = {
  performScan,
  collectIdentityAndUsage,
  reanchorReusedGrant,
  storedAiConsent,
  runAggregation,
  runModelCalls,
  computeUsage,
  scanUsage,
};
