#!/usr/bin/env node
'use strict';

const { classify } = require('../src/maturity');
const { detectReportLang, getCatalog } = require('../src/i18n');
const { parseArgs } = require('../src/cli-args');
const { loadConsentState } = require('../src/share');
const { handleOneShotCommand } = require('../src/usage-oneshot-commands');
const { prefetchGitLogs } = require('../src/git-log-prefetch');
const { GIT_ACTIVITY_LOG_ARGS } = require('../src/git-activity');
const { WORK_STREAMS_LOG_ARGS } = require('../src/work-streams');
const { AUTHORSHIP_LOG_ARGS } = require('../src/authorship');
const {
  resolveRepoScope,
  machineWideToplevels,
  promptScope,
} = require('../src/usage-repo-scope');
const {
  performScan,
  prepareIdentityAndUsage,
  resolveAiConsent,
  runAggregation,
  runModelCalls,
  renderAndFinalize,
} = require('../src/usage-run-steps');

// Steps 1-6 of a run: scan, scope, aggregate, classify; nothing is rendered or sent.
async function computeUsage({ opts, catalog, lang, injectedAsk = null, inRegistration = false }) {
  // 1. Local scan + classify (always computed and shown, ADR-011/013).
  const { report, root, rootDir } = performScan({ opts, catalog });

  // 2. Identity gate + local agent-usage signal. Roadmap only for anonymous runs
  //    (gate.showRoadmap = !loggedIn) AND never during register/onboarding.
  const { gate: identityGate } = prepareIdentityAndUsage({ report, catalog, quiet: opts.json === true });
  const gate = (inRegistration && identityGate.showRoadmap)
    ? { ...identityGate, showRoadmap: false }
    : identityGate;

  // 3. Consent gate before any AI/egress call (ADR-051); a decline still renders.
  const aiConsentGranted = await resolveAiConsent({ opts, catalog, gate, injectedAsk });

  // 4. Repo scoping (exclude client work).
  const scope = await resolveRepoScope({ opts, cwd: rootDir, injectedAsk, catalog });
  const consentEmail = (loadConsentState() || {}).email || null;
  const agentRoots = scope.toplevels;

  // 5. Aggregate scoped signals + rebuild scan/org-chart over the selection, re-classify.
  await prefetchGitLogs(agentRoots, [GIT_ACTIVITY_LOG_ARGS, WORK_STREAMS_LOG_ARGS, AUTHORSHIP_LOG_ARGS]);
  runAggregation({ report, scope, consentEmail, agentRoots, root, catalog });
  const maturity = classify(report);
  const hasAgents = Array.isArray(report.agents) && report.agents.length > 0;
  report.analyzedRepos =
    scope.mode === 'all'
      ? null
      : scope.toplevels.map((tl) => tl.split(/[/\\]/).pop() || tl);

  // 6. The three ephemeral model calls, serialized and gated by consent (ADR-051).
  await runModelCalls({
    report, maturity, aiConsentGranted, opts, gate, hasAgents, agentRoots, rootDir, lang, catalog,
  });
  return { report, maturity, root, gate };
}

// The MCP's scan: same steps, returned instead of printed, since stdout is its JSON-RPC channel.
async function scanUsage(argv) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const { report, maturity } = await computeUsage({ opts, catalog: getCatalog(lang), lang });
  return { report, maturity };
}

// Shared by the dispatcher and register flow: an injected `ask` is caller-owned, `bypassThrottle` is register-only.
async function run(argv = process.argv.slice(2), { ask: injectedAsk = null, bypassThrottle = false, inRegistration = false } = {}) {
  const opts = parseArgs(argv);

  // Resolve language first so even --help is localized.
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);

  if (opts.help) {
    process.stdout.write(catalog.cli.help);
    return;
  }

  // One-shot commands (consent/endpoint config): act immediately, do NOT scan.
  if (await handleOneShotCommand({ opts, catalog, injectedAsk })) return;

  const { report, maturity, root, gate } = await computeUsage({ opts, catalog, lang, injectedAsk, inRegistration });

  // 7. Render (or emit --json), persist, optional --build-next-level, auto-share.
  await renderAndFinalize({ report, maturity, lang, opts, root, gate, catalog, bypassThrottle });
}

module.exports = { run, scanUsage, resolveRepoScope, machineWideToplevels, promptScope };

// Auto-run only when executed directly, not when require()'d by the dispatcher.
if (require.main === module) {
  run();
}
