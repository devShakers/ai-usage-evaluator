#!/usr/bin/env node
'use strict';

/*
 * `ai-certify` — the SECOND binary of this repo (skill-code-certification,
 * issue 004). Sibling of `ai-footprint` (bin/report.js), NOT a subcommand.
 *
 * V1 ships ONLY the RESOLVE phase (ADR-001, phase 1): detect the local
 * project's technologies, ask the Shakers Hub which map to a Skill the
 * Talent can certify, and show certifiable vs non-certifiable. The sampling +
 * code egress + LLM certify phase is issue 005 — deliberately NOT here.
 *
 * Zero-dependency invariant (node stdlib only) preserved: every helper is a
 * local src/ module, no third-party package.
 *
 * Flow (order matters for ADR-001 — no egress before explicit acceptance):
 *   1. Resolve endpoint. Unset -> actionable error, exit 1 (no local product).
 *   2. Detect technologies locally (no egress). None -> inform, exit 0.
 *   3. Show the legal disclaimer and require EXPLICIT acceptance.
 *   4. Resolve identity email (flag / stored consent email / prompt).
 *   5. POST {email, technologies[]}; render the result, or an actionable
 *      error on any failure (never hangs, never a deterministic fallback).
 */

const { parseCertifyArgs } = require('../src/certify-args');
const { detectReportLang, getCatalog } = require('../src/i18n');
const { getCertifyEndpoint } = require('../src/config');
const { detectTechnologies } = require('../src/tech-detector');
const { confirmDisclaimerAcceptance } = require('../src/certify-disclaimer');
const {
  buildResolveRequest,
  requestResolve,
  buildCertifyRequest,
  requestCertify,
  classifyCertifyFailure,
} = require('../src/certify-client');
const { formatResolveReport } = require('../src/certify-render');
const { buildSkillSamples } = require('../src/skill-sampler');
const { parseSkillSelection } = require('../src/skill-selection');
const { renderCertificationTerminal } = require('../src/render-certification');
const { upsertCertification } = require('../src/report-store');
const {
  isValidEmail,
  normalizeEmail,
  getConsentStatus,
  loadConsentState,
  getConsentDecision,
  shareCertification,
} = require('../src/share');
const { runConsentPrompt } = require('../src/consent-flow');
const { createStdinAsk } = require('../src/stdin-ask');
const { withSpinner } = require('../src/terminal-progress');
const { runInteractiveMultiSelect } = require('../src/interactive-select');

const MAX_EMAIL_ATTEMPTS = 5;

// Identity resolution: explicit --email flag first, then the email already
// stored by ai-footprint's consent flow (share.js — one identity across both
// binaries), then an interactive prompt. Returns a normalized email, or null
// when none can be obtained (non-interactive with nothing stored, or the
// talent never enters a valid one).
async function resolveEmail({ opts, catalog, ask, stdinIsTTY }) {
  const c = catalog.certify;

  if (opts.email && isValidEmail(opts.email)) {
    const e = normalizeEmail(opts.email);
    process.stdout.write(`  ${c.emailUsing(e)}\n`);
    return e;
  }

  const stored = getConsentStatus().email;
  if (stored && isValidEmail(stored)) {
    process.stdout.write(`  ${c.emailUsing(stored)}\n`);
    return stored;
  }

  if (!stdinIsTTY) return null;

  for (let attempt = 0; attempt < MAX_EMAIL_ATTEMPTS; attempt++) {
    const raw = String(await ask(c.emailPrompt)).trim();
    if (isValidEmail(raw)) return normalizeEmail(raw);
    process.stdout.write(`  ${c.emailInvalid}\n`);
  }
  return null;
}

// Maps a TECHNICAL failure reason to an actionable, localized message.
function resolveErrorMessage(reason, catalog) {
  const c = catalog.certify;
  if (reason === 'no-endpoint') return c.errorNoEndpoint;
  if (reason === 'network-error') return c.errorNetwork;
  if (reason === 'timeout') return c.errorTimeout;
  if (typeof reason === 'string' && reason.startsWith('http-')) return c.errorHttp(reason.slice('http-'.length));
  return c.errorInvalidResponse; // invalid-json | invalid-shape
}

// Reports a resolve/certify failure with the RIGHT UX per status (issue 014):
// 403 = expected gate outcome (calm, clean exit, no retry/error styling);
// 413 = actionable "too large"; everything else = real technical error.
// Shared by both the resolve and certify phases.
function reportCertifyFailure(reason, catalog, email) {
  const c = catalog.certify;
  const kind = classifyCertifyFailure(reason);

  if (kind === 'gate') {
    // Not a technical error: informative message on stdout, no "unexpected
    // status", no "HTTP 403", no retry hint, no error styling. Exit code stays
    // 0 — this is a valid, expected outcome (the email simply isn't a
    // registered Talent), not a crash.
    process.stdout.write(`\n  ${c.notRegistered(email)}\n\n`);
    return;
  }
  if (kind === 'too-large') {
    process.stderr.write(`\n  ${c.errorTooLarge}\n\n`);
    process.exitCode = 1;
    return;
  }
  // technical: network/timeout/invalid/5xx/other non-2xx — generic error + retry.
  process.stderr.write(`\n  ${c.errorIntro} ${resolveErrorMessage(reason, catalog)}\n`);
  process.stderr.write(`  ${c.errorRetryHint}\n\n`);
  process.exitCode = 1;
}

// Persists the analyzed certification result if consent is granted. Never
// throws — must not break the local report (ADR-011).
async function maybeShareCertification(items) {
  try {
    await shareCertification(items);
  } catch {
    // silent: any skip/failure reason is not an error of the local run
  }
}

// The certify phase (issue 005): select -> sample -> scrub+send -> report ->
// consent. Assumes the disclaimer was already accepted (bin does that before
// resolve, and it covers code egress). Sets process.exitCode on hard errors.
async function runCertifyPhase({ endpoint, email, resolveResult, root, opts, catalog, lang, ask, stdinIsTTY }) {
  const c = catalog.certify;
  const certifiable = Array.isArray(resolveResult.certifiable) ? resolveResult.certifiable : [];

  if (certifiable.length === 0) return; // nothing certifiable — resolve report already shown

  // --- selection ---
  let selected;
  if (opts.all) {
    selected = certifiable.slice();
  } else if (opts.skills != null) {
    const parsed = parseSkillSelection(opts.skills, certifiable);
    if (!parsed.ok) {
      process.stderr.write(`\n  ${c.selectInvalid}\n\n`);
      process.exitCode = 1;
      return;
    }
    selected = parsed.selected;
  } else if (!stdinIsTTY) {
    process.stdout.write(`\n  ${c.selectNonInteractive}\n\n`);
    process.exitCode = 1;
    return;
  } else {
    // Dynamic multi-select (issue 011): arrows + space + enter. Uses raw
    // stdin, so release the line-based readline first (recreated later for the
    // consent prompt) to avoid two handlers fighting over the TTY.
    ask.close();
    const picked = await runInteractiveMultiSelect({
      items: certifiable,
      labelFor: (s) => `${s.skillName}${s.technology ? ` (${s.technology})` : ''}`,
      header: c.selectHeading,
      hint: c.selectHint,
    });
    if (!picked || picked.length === 0) {
      process.stdout.write(`\n  ${c.selectNoneChosen}\n\n`);
      return;
    }
    selected = picked;
  }
  if (selected.length === 0) {
    process.stdout.write(`\n  ${c.selectNoneChosen}\n\n`);
    return;
  }

  // --- deterministic sampling (local) ---
  const samples = buildSkillSamples(root, selected);
  const sendable = samples.filter((s) => Array.isArray(s.files) && s.files.length > 0);

  // --- certify (egress; scrub happens in buildCertifyRequest) ---
  let results = [];
  if (sendable.length > 0) {
    const requestBody = buildCertifyRequest(email, sendable);
    // Spinner while sonnet-5 runs (issue 011): the call takes ~15-25s — make
    // it clear the CLI is working, not hung. withSpinner degrades to a single
    // stderr line on non-TTY.
    const outcome = await withSpinner(c.certifyingLabel, () => requestCertify(requestBody, { endpoint }));
    if (!outcome.ok) {
      reportCertifyFailure(outcome.reason, catalog, email);
      return;
    }
    results = outcome.result.results;
  }

  // --- assemble + render ---
  const resultById = new Map(results.map((r) => [String(r.skillId), r]));
  const items = samples.map((s) => ({
    skillId: s.skillId,
    skillName: s.skillName,
    technology: s.technology,
    sampling: s.meta,
    result: (Array.isArray(s.files) && s.files.length > 0) ? (resultById.get(String(s.skillId)) || null) : null,
  }));
  const certification = { items, model: null };

  process.stdout.write('\n' + renderCertificationTerminal(certification, lang) + '\n\n');

  // Cumulative local report (skill-code-certification, reporting redesign):
  // upsert each certified Skill (keyed by Skill id) into the shared report.html
  // and ALWAYS print its file:// link. HTML is no longer opt-in behind --html.
  // Writing the local report must never break the run.
  try {
    const paths = upsertCertification({ items, lang });
    process.stdout.write(`  ${c.reportLink(paths.fileUrl)}\n\n`);
  } catch {
    // Never break the local run over a failed report write.
  }

  // --- consent (ADR-011): report already shown; persist only if granted ---
  const analyzed = items.some((i) => i.result);
  if (analyzed) {
    const decision = getConsentDecision(loadConsentState());
    if (decision === null && stdinIsTTY) {
      // A fresh readline: the interactive selection branch closed the original
      // `ask` to take over raw stdin; the --all/--skills branches left it open,
      // but a fresh instance is safe either way (closing twice is a no-op).
      const consentAsk = createStdinAsk();
      try {
        await runConsentPrompt({ ask: consentAsk, catalog });
      } finally {
        consentAsk.close();
      }
    }
    await maybeShareCertification(items);
  }
}

async function main() {
  const opts = parseCertifyArgs(process.argv.slice(2));
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);

  if (opts.help) {
    process.stdout.write(catalog.certify.help + '\n');
    return;
  }

  // (1) No endpoint -> actionable error, never a silent degrade (ADR-001:
  // there is no offline certification).
  const endpoint = getCertifyEndpoint();
  if (!endpoint) {
    process.stderr.write(`\n  ${catalog.certify.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }

  // (2) Local, deterministic technology detection (no egress).
  const root = opts.root || process.cwd();
  const technologies = detectTechnologies(root);
  if (technologies.length === 0) {
    process.stdout.write(`\n  ${catalog.certify.noTechnologies}\n\n`);
    return;
  }
  process.stdout.write(`\n  ${catalog.certify.technologiesDetected(technologies.join(', '))}\n`);

  const stdinIsTTY = !!process.stdin.isTTY;
  const ask = createStdinAsk();
  try {
    // (3) Legal disclaimer + EXPLICIT acceptance BEFORE any egress (ADR-001).
    const acceptance = await confirmDisclaimerAcceptance({
      ask,
      catalog,
      preAccepted: opts.acceptDisclaimer,
      stdinIsTTY,
    });
    if (!acceptance.accepted) {
      process.exitCode = 1;
      return;
    }

    // (4) Identity.
    const email = await resolveEmail({ opts, catalog, ask, stdinIsTTY });
    if (!email) {
      process.stderr.write(`  ${catalog.certify.emailNeeded}\n\n`);
      process.exitCode = 1;
      return;
    }

    // (5) Resolve request. Resilient: inform on failure, never hang, no
    // deterministic fallback (ADR-001).
    const requestBody = buildResolveRequest(email, technologies);
    const outcome = await requestResolve(requestBody, { endpoint });
    if (!outcome.ok) {
      reportCertifyFailure(outcome.reason, catalog, email);
      return;
    }

    process.stdout.write('\n' + formatResolveReport(technologies, outcome.result, catalog) + '\n\n');

    // (6) Certify phase (issue 005): select certifiable Skills, sample+scrub+
    // send code, show the assessment report, offer to persist with consent.
    await runCertifyPhase({
      endpoint,
      email,
      resolveResult: outcome.result,
      root,
      opts,
      catalog,
      lang,
      ask,
      stdinIsTTY,
    });
  } finally {
    ask.close();
  }
}

main();
