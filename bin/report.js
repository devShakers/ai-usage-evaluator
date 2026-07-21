#!/usr/bin/env node
'use strict';

const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { renderTerminal } = require('../src/render-terminal');
const { persistFootprint } = require('../src/report-store');
const { detectReportLang, getCatalog } = require('../src/i18n');
const { parseArgs } = require('../src/cli-args');
const {
  loadConsentState,
  getConsentDecision,
  autoShare,
  getConsentStatus,
  revokeConsent,
  resetConsent,
  setEmail,
  consentPath,
} = require('../src/share');
const { runConsentPrompt } = require('../src/consent-flow');
const { createStdinAsk } = require('../src/stdin-ask');
const { parseAgentDescriptions, parseAgentDefinitions } = require('../src/agent-org-chart');
const { buildSynthesisRequest, requestAgentSynthesis } = require('../src/agent-synthesis');
const { collectAgentUsage } = require('../src/agent-usage');
const { buildAgentEvaluationRequest, requestAgentEvaluation } = require('../src/agent-evaluation');
const {
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getAgentEvaluationEndpoint,
  setIngestEndpoint,
  resolveIngestEndpoint,
} = require('../src/config');
const { buildNextLevelStarter } = require('../src/build-next-level');
const { withStaticStatus, withSpinner } = require('../src/terminal-progress');
const { computeConsentSkip } = require('../src/consent-skip');
const { getRoadmapEntry } = require('../src/roadmap-content');
const { computeTierResult } = require('../src/tier-engine');
const { buildRoadmapPersonalizationRequest, requestRoadmapPersonalization } = require('../src/roadmap-personalization');

// Help text is now localized (skill-code-certification / ADR-003): it lives in
// the i18n `cli.help` catalog and is resolved via the machine locale (or
// --lang), replacing the previously hardcoded Spanish block.

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
  // Surface a granted-but-unverified email (ADR-006): the decision is saved
  // (no re-prompt) but nothing is sent to Shakers until it's verified.
  if (status.consent === 'granted' && status.email && !status.emailVerified) {
    process.stdout.write(`  ${s.verificationPending}\n`);
  }
  process.stdout.write(`  ${s.lastSentAt(status.lastSentAt)}\n\n`);
}

function doConsentRevoke(catalog) {
  revokeConsent();
  process.stdout.write(`\n  ${catalog.consent.revoked}\n\n`);
}

// skill-code-certification / ADR-003: clears the decision back to "no decision
// yet" so the consent question is asked again next run — distinct from revoke
// (which persists `denied`).
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

// Endpoint config (endpoint-config task): one-shot, don't scan. Persist the
// ingest endpoint into ~/.config/ai-footprint/config.json after validating it
// (a non-local host must be https). The env var still wins at runtime.
function doSetEndpoint(url, catalog) {
  const e = catalog.endpoint;
  const r = setIngestEndpoint(url);
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

// Print the effective ingest endpoint and where it resolved from (env var >
// config file > none), so a Talent can see what's configured without editing
// or exporting anything.
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
}

// "Construir el siguiente nivel ahora" (issue 021): optional, explicit
// phase — never runs unless the talent asks for it via --build-next-level.
// Deterministic (src/build-next-level.js, same snippets as the roadmap
// section); never overwrites an existing file unless --force is ALSO
// passed explicitly.
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

// Automatic, silent PERSISTING once consent is `granted` (ADR-007, gating
// revised by ADR-011: consent controls persistence only, never what's
// shown). Must never break the local run, no matter what.
async function maybeAutoShare(report, maturity) {
  try {
    await autoShare(report, maturity);
    // Every skip/failure reason (no-decision, consent-denied, throttled,
    // no-endpoint-configured, network-error, rate-limited,
    // service-unavailable, other HTTP): silent on purpose, they aren't
    // errors of the local run.
  } catch {
    // Must never break the local report.
  }
}

// Ephemeral agent-synthesis call (talents-ai-score, ADR-010/ADR-011): runs
// EVERY execution, regardless of consent — it's what makes "always show the
// diagram" possible. Never throws, never hangs the run: any failure
// (no endpoint configured, network error, timeout, invalid response) is
// treated as "no synthesis this run" and the report/render layer falls back
// to the deterministic org chart (ADR-009). Descriptions are scrubbed
// before they ever leave the machine (src/agent-synthesis.js#scrubSecrets).
async function maybeSynthesizeAgents(report, root) {
  if (!Array.isArray(report.agents) || report.agents.length === 0) return null;
  const endpoint = getSynthesisEndpoint();
  if (!endpoint) return null;

  try {
    // Reuses `report.agentDescriptions` (already attached, unconditionally,
    // right after the scan) instead of re-parsing the same files a second
    // time — falls back to a fresh parse only if it's somehow missing.
    const descriptions = Array.isArray(report.agentDescriptions)
      ? report.agentDescriptions
      : parseAgentDescriptions(root);
    const requestBody = buildSynthesisRequest(report.agents, descriptions);
    return await requestAgentSynthesis(requestBody, { endpoint });
  } catch {
    return null; // never breaks the local report — falls back to the org chart
  }
}

// Ephemeral agent-evaluation call (ADR-016): scores each agent's DEFINITION
// quality server-side (gemini-2.5-flash — see src/agent-evaluation.js). Same
// resilience contract as maybeSynthesizeAgents: no endpoint / network error /
// timeout / bad shape all resolve to `null`, and the report simply shows no
// scores (the local run never hangs or breaks). Definitions are scrubbed before
// they leave the machine (buildAgentEvaluationRequest + the network-boundary
// re-scrub in requestAgentEvaluation). Reuses report.agentDescriptions (already
// attached after the scan) rather than re-parsing.
async function maybeEvaluateAgents(report, root, lang) {
  if (!Array.isArray(report.agents) || report.agents.length === 0) return null;
  const endpoint = getAgentEvaluationEndpoint();
  if (!endpoint) return null;

  try {
    // Evaluate the FULL definition (frontmatter description + body), not just
    // the one-line description — a body-defined agent has an empty frontmatter
    // description, which the backend would omit (no score). See
    // src/agent-org-chart.js#parseAgentDefinitions.
    const definitions = parseAgentDefinitions(root);
    // ADR-026: pass the report language so the rationale + the one-line
    // description come back translated (a Spanish-authored definition still
    // yields report-language prose).
    const requestBody = buildAgentEvaluationRequest(report.agents, definitions, lang);
    return await requestAgentEvaluation(requestBody, { endpoint });
  } catch {
    return null; // never breaks the local report
  }
}

// Ephemeral roadmap personalization call (talents-ai-score, ADR-015): asks
// the hub for a project-adapted rewrite of the CURRENT tier jump's 4 prose
// gaps (whatUnlocks/steps/tips/mistakes) — everything else about the
// roadmap (tier, band, the "upgrade when" criterion, the copyable
// snippet) always stays the curated content, reinserted client-side
// (src/roadmap-personalization.js's mergeRoadmapPersonalization, applied
// by the render layer). Never attempted for the T7 terminal entry (no
// jump to personalize) or when the tier can't be resolved. Any failure —
// no endpoint, network error, timeout, invalid JSON, or a
// steps/tips/mistakes count mismatch — resolves to `null`, and the render
// layer falls back to the curated content verbatim, same resilience
// invariant as maybeSynthesizeAgents above. Never touches the persistence
// payload (src/share.js) — entirely separate, ephemeral call.
async function maybePersonalizeRoadmap(report, maturity, lang) {
  const tierKey = maturity && maturity.tierKey;
  if (!tierKey) return null;
  const entry = getRoadmapEntry(tierKey, lang);
  if (!entry || entry.maxTier) return null;

  const endpoint = getRoadmapEndpoint();
  if (!endpoint) return null;

  try {
    const tierResult = computeTierResult(report);
    // ADR-026: pass the report language so the personalized prose is localized.
    const requestBody = buildRoadmapPersonalizationRequest(entry, tierResult, report, lang);
    return await requestRoadmapPersonalization(requestBody, { endpoint });
  } catch {
    return null; // never breaks the local report — falls back to the curated content
  }
}

// Exposed as `run(argv, { ask })` (ADR-014) so the branded REPL
// (bin/sh-eval.js) can invoke the SAME logic the `footprint` command used to
// run, without duplicating it. `argv` is the arg array (process.argv.slice(2)
// when standalone). `ask` is the SHARED stdin reader injected by the REPL — the
// nested-stdin seam: when present the consent flow reads through it and this
// function NEVER closes it (the REPL owns its lifecycle). Standalone (no `ask`)
// it creates and closes its own, exactly as before.
async function run(argv = process.argv.slice(2), { ask: injectedAsk = null } = {}) {
  const opts = parseArgs(argv);

  // Resolve language FIRST (skill-code-certification / ADR-003) so even --help
  // is localized to the machine locale (or --lang) — no hardcoded Spanish.
  // `--lang` overrides the auto-detected language for the whole report and the
  // copyable implementation prompt too (one language axis).
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);

  if (opts.help) {
    process.stdout.write(catalog.cli.help);
    return;
  }

  // Consent management commands: one-shot, don't scan (issue 007 / ADR-003).
  if (opts.consentStatus) {
    doConsentStatus(catalog);
    return;
  }
  if (opts.consentRevoke) {
    doConsentRevoke(catalog);
    return;
  }
  if (opts.consentReset) {
    doConsentReset(catalog);
    return;
  }
  if (opts.consentEmail) {
    doConsentEmail(opts.consentEmail, catalog);
    return;
  }

  // Endpoint config commands: one-shot, don't scan (endpoint-config task).
  if (opts.setEndpoint !== null) {
    doSetEndpoint(opts.setEndpoint, catalog);
    return;
  }
  if (opts.showEndpoint) {
    doShowEndpoint(catalog);
    return;
  }

  // talents-ai-score, ADR-011: the report is ALWAYS computed and shown,
  // unconditionally — no gate, no disclosure wall before scanning. Consent
  // (asked further below, AFTER the report is on screen) governs ONLY
  // whether it gets persisted in Shakers.
  // Terminal progress feedback (talents-ai-score): more detectors + the
  // synthesis call made this run noticeably slower — stderr-only status so
  // it never corrupts stdout (`--json`'s single parseable document, or the
  // terminal report if ever piped/redirected). See src/terminal-progress.js
  // for why scan+detectors gets a static line (synchronous, can't animate)
  // while synthesis gets a real spinner (genuinely async).
  const root = opts.root;
  const report = withStaticStatus(catalog.cli.scanningLabel, () => scan({ root }));
  const maturity = classify(report);

  // talents-ai-score, description-always-present (real-browser user
  // feedback): raw per-agent descriptions, straight from
  // `.claude/agents/*.md` frontmatter, attached UNCONDITIONALLY (no
  // network, no endpoint needed) — the render layer's fallback source for
  // an agent card's description when synthesis doesn't run or doesn't
  // cover that agent (src/render-html.js's buildAgentCardTree). Reuses
  // ADR-010's gated parseAgentDescriptions, previously only called when
  // synthesis was attempted; local-only display is a strictly LESS
  // exposed use than sending it to the synthesis endpoint, so no new
  // privacy boundary is crossed. Never touches the persistence payload.
  if (Array.isArray(report.agents) && report.agents.length > 0) {
    report.agentDescriptions = parseAgentDescriptions(root || process.cwd());
  }

  // Ephemeral diagram synthesis (ADR-010/011): every run, independent of
  // consent. Attaches `report.agentSynthesis` only on success; on any
  // failure the render layer falls back to the deterministic org chart.
  // The spinner only fires when synthesis will actually be ATTEMPTED
  // (agents exist AND an endpoint is configured) — otherwise
  // maybeSynthesizeAgents returns instantly with nothing to wait for, and
  // flashing a "Synthesizing..." message would be misleading, not honest
  // progress feedback.
  const willAttemptSynthesis =
    Array.isArray(report.agents) && report.agents.length > 0 && !!getSynthesisEndpoint();
  const synthesis = willAttemptSynthesis
    ? await withSpinner(catalog.cli.synthesizingLabel, () => maybeSynthesizeAgents(report, root || process.cwd()))
    : await maybeSynthesizeAgents(report, root || process.cwd());
  if (synthesis) report.agentSynthesis = synthesis;

  // Footprint agents are now name + description + hierarchy ONLY
  // (skill-code-certification, investor spec): the per-agent classification /
  // level / improvements and the definition-quality score/usage were RELOCATED
  // to the `certify agents` flow (they are NOT computed in footprint anymore).
  // The synthesis (name + one-line "what it does") + the deterministic org-chart
  // hierarchy remain. `collectAgentUsage` / `maybeEvaluateAgents` are no longer
  // invoked here (kept in the codebase, dormant, reused by certify agents).

  // Ephemeral roadmap personalization (ADR-015): attaches
  // `report.roadmapPersonalization` only on a validated success; on any
  // failure the render layer falls back to the curated roadmap content
  // verbatim. Reuses the SAME spinner mechanism as synthesis above, only
  // shown when personalization will actually be ATTEMPTED (an applicable
  // jump entry exists — never for T7 — AND an endpoint is configured):
  // otherwise maybePersonalizeRoadmap returns instantly with nothing to
  // wait for.
  const roadmapEntryForTier = maturity.tierKey ? getRoadmapEntry(maturity.tierKey, lang) : null;
  const willAttemptRoadmapPersonalization =
    !!roadmapEntryForTier && !roadmapEntryForTier.maxTier && !!getRoadmapEndpoint();
  const roadmapPersonalization = willAttemptRoadmapPersonalization
    ? await withSpinner(catalog.cli.personalizingRoadmapLabel, () => maybePersonalizeRoadmap(report, maturity, lang))
    : await maybePersonalizeRoadmap(report, maturity, lang);
  if (roadmapPersonalization) report.roadmapPersonalization = roadmapPersonalization;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ report, maturity }, null, 2) + '\n');
    return;
  }

  // Consent-to-PERSIST, asked BEFORE the report is printed (skill-code-
  // certification / ADR-003 — revises ADR-011's "after the report" order). The
  // legal/consent text (catalog.consent.persistIntro) + the yes/no + (on yes)
  // the email prompt all show FIRST; the report is STILL always printed
  // afterwards, accept or decline — this is NOT a wall. Asked once (until
  // --consent-reset); a persisted decision (granted/denied) skips it, with
  // computeConsentSkip explaining why. Not reached under --json (stdout must
  // stay one parseable document). The ephemeral synthesis egress (ADR-010)
  // already ran above and is intentionally NOT gated here — consent governs
  // persistence only (ADR-003 open flag).
  const state = loadConsentState();
  const decision = getConsentDecision(state);
  const consentSkip = computeConsentSkip({
    decision,
    emailVerified: state ? state.emailVerified : undefined,
    stdinIsTTY: !!process.stdin.isTTY,
    consentFilePath: consentPath(),
    catalog,
  });
  if (consentSkip.message) {
    process.stdout.write(`\n  ${consentSkip.message}\n`);
  }
  if (!consentSkip.skip) {
    // Reuse the REPL's shared reader when injected (nested stdin); otherwise
    // own a throwaway one. Only close what we created — never the REPL's.
    const ask = injectedAsk || createStdinAsk();
    try {
      await runConsentPrompt({ ask, catalog });
    } finally {
      if (!injectedAsk) ask.close();
    }
  }

  process.stdout.write(renderTerminal(report, maturity, lang, { showRoadmap: opts.roadmap }) + '\n');

  // ADR-016: footprint PERSISTS this project's footprint into report-state.json
  // (keyed by the scanned project path) but no longer writes the HTML file nor
  // prints a link — the HTML is materialized + opened only by the `report`
  // command. `--no-save` is the explicit opt-out (persist nothing, e.g. CI).
  // Persisting must never break the run.
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

  // Automatic sending, always at the end and after seeing the local report.
  // Gated by consent + email + throttle + endpoint config (src/share.js).
  await maybeAutoShare(report, maturity);
}

module.exports = { run };

// Only auto-run when executed directly (`node bin/report.js`). Guarded so the
// REPL can `require()` this module and call `run()` without triggering a second
// execution (ADR-014).
if (require.main === module) {
  run();
}
