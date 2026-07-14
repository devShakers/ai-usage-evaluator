#!/usr/bin/env node
'use strict';

const { execFile } = require('child_process');
const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { renderTerminal } = require('../src/render-terminal');
const { renderHtml } = require('../src/render-html');
const { save } = require('../src/store');
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
const { parseAgentDescriptions } = require('../src/agent-org-chart');
const { buildSynthesisRequest, requestAgentSynthesis } = require('../src/agent-synthesis');
const { getSynthesisEndpoint, getRoadmapEndpoint } = require('../src/config');
const { buildNextLevelStarter } = require('../src/build-next-level');
const { withStaticStatus, withSpinner } = require('../src/terminal-progress');
const { computeConsentSkip } = require('../src/consent-skip');
const { getRoadmapEntry } = require('../src/roadmap-content');
const { computeTierResult } = require('../src/tier-engine');
const { buildRoadmapPersonalizationRequest, requestRoadmapPersonalization } = require('../src/roadmap-personalization');

function openInBrowser(file) {
  const cmd =
    process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  execFile(cmd, args, () => {});
}

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
    const requestBody = buildRoadmapPersonalizationRequest(entry, tierResult, report);
    return await requestRoadmapPersonalization(requestBody, { endpoint });
  } catch {
    return null; // never breaks the local report — falls back to the curated content
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

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
    stdinIsTTY: !!process.stdin.isTTY,
    consentFilePath: consentPath(),
    catalog,
  });
  if (consentSkip.message) {
    process.stdout.write(`\n  ${consentSkip.message}\n`);
  }
  if (!consentSkip.skip) {
    const ask = createStdinAsk();
    try {
      await runConsentPrompt({ ask, catalog });
    } finally {
      ask.close();
    }
  }

  process.stdout.write(renderTerminal(report, maturity, lang) + '\n');

  const html = renderHtml(report, maturity, lang);
  if (opts.save) {
    const paths = save(report, html);
    process.stdout.write(`  ${catalog.cli.saved(paths.dir)}\n\n`);
    if (opts.html) openInBrowser(paths.htmlPath);
    else process.stdout.write(`  ${catalog.cli.useHtmlHint}\n\n`);
  } else if (opts.html) {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const tmp = path.join(os.tmpdir(), `ai-footprint-${Date.now()}.html`);
    fs.writeFileSync(tmp, html);
    openInBrowser(tmp);
    process.stdout.write(`  ${catalog.cli.tempDashboard(tmp)}\n\n`);
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

main();
