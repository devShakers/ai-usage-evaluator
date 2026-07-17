#!/usr/bin/env node
'use strict';

/*
 * `certify` — the certification command of this repo (skill-code-certification,
 * issues 004/005). Runs as an internal command of the `sh-eval` REPL (ADR-014)
 * and is still require()-able standalone (`node bin/certify.js`). Historically
 * the standalone `ai-certify` binary (retired); the logic is unchanged.
 *
 * BOTH phases now ship: phase 1 RESOLVE (ADR-001) detects the local project's
 * technologies and asks the Shakers Hub which map to a certifiable Skill; phase
 * 2 CERTIFY (issue 005) samples + secret-scrubs + sends code for a per-Skill
 * assessment (runCertifyPhase below). No egress happens before the explicit
 * disclaimer acceptance.
 *
 * Zero-dependency invariant (node stdlib only) preserved: every helper is a
 * local src/ module, no third-party package.
 *
 * Flow (order matters for ADR-001 — no egress before explicit acceptance —
 * and for the front-loaded consent, skill-code-certification 2026-07-15):
 *   1. Resolve endpoint. Unset -> actionable error, exit 1 (no local product).
 *   2. Detect technologies locally (no egress). None -> inform, exit 0.
 *   3. Show the legal disclaimer and require EXPLICIT acceptance (egress gate).
 *   4. Consent-to-persist + email + OTP verification, FRONT-LOADED — asked here
 *      (before choosing Skills), only if no decision is persisted yet.
 *   5. Resolve identity email (reuses the OTP-verified consent email / flag /
 *      prompt).
 *   6. POST {email, technologies[]} (resolve); render the result, or an
 *      actionable error on any failure (never hangs, no deterministic fallback).
 *   7. Certify phase: select Skills -> sample+scrub+send -> report (always
 *      shown, ADR-003) -> persist iff consent was granted up front.
 */

const { parseCertifyArgs } = require('../src/certify-args');
const { detectReportLang, getCatalog } = require('../src/i18n');
const { getCertifyEndpoint } = require('../src/config');
const { oscLink } = require('../src/osc-link');
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
  consentPath,
  shareCertification,
} = require('../src/share');
const { runConsentPrompt } = require('../src/consent-flow');
const { computeConsentSkip } = require('../src/consent-skip');
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

// Front-loaded consent-to-PERSIST (skill-code-certification / ADR-003 + user
// decision 2026-07-15): asked at the START of the run — after the code-egress
// disclaimer (ADR-001) but BEFORE choosing Skills — never after certifying.
// Only when there is NO persisted decision yet; a granted/denied decision is
// not re-asked (computeConsentSkip explains why, and still attempts a piped
// answer on non-TTY). runConsentPrompt handles yes/no -> email -> OTP
// verification and persists the decision. The report is STILL always shown
// later, consent or not (ADR-003) — this is not a wall. Returns nothing; the
// decision lives in the shared consent state, read again at persist time.
async function runFrontloadedConsent({ ask, catalog, stdinIsTTY }) {
  const state = loadConsentState();
  const decision = getConsentDecision(state);
  const consentSkip = computeConsentSkip({
    decision,
    emailVerified: state ? state.emailVerified : undefined,
    stdinIsTTY,
    consentFilePath: consentPath(),
    catalog,
  });
  if (consentSkip.message) {
    process.stdout.write(`\n  ${consentSkip.message}\n`);
  }
  if (!consentSkip.skip) {
    await runConsentPrompt({ ask, catalog });
  }
}

// The certify phase (issue 005): select -> sample -> scrub+send -> report ->
// persist. Assumes the disclaimer was already accepted AND the persist-consent
// was already asked (bin does both before resolve, front-loaded — ADR-001 for
// egress, ADR-003 + user decision for consent). Sets process.exitCode on hard
// errors.
async function runCertifyPhase({ endpoint, email, resolveResult, root, opts, catalog, lang, ask, stdinIsTTY }) {
  const c = catalog.certify;
  const certifiable = Array.isArray(resolveResult.certifiable) ? resolveResult.certifiable : [];

  if (certifiable.length === 0) return; // nothing certifiable — resolve report already shown

  // --- selection ---
  // The interactive multi-select takes over raw stdin, so it CLOSES the shared
  // readline (`ask`); the --all/--skills and non-interactive branches leave it
  // open. Consent already ran up front (before this phase), so nothing here
  // reuses `ask` afterwards — main()'s finally closes it.
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
    // stdin, so release the line-based readline first to avoid two handlers
    // fighting over the TTY. When running inside the REPL (ADR-014) the reader
    // is SHARED, so suspend/resume it instead of closing it (closing would kill
    // the REPL's stdin); standalone (`ask.close` only) it's a throwaway reader.
    // TTY-only path — non-TTY takes the --all/--skills branches above.
    if (typeof ask.suspend === 'function') ask.suspend();
    else ask.close();
    const picked = await runInteractiveMultiSelect({
      items: certifiable,
      labelFor: (s) => `${s.skillName}${s.technology ? ` (${s.technology})` : ''}`,
      header: c.selectHeading,
      hint: c.selectHint,
    });
    if (typeof ask.resume === 'function') ask.resume();
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
    // Spinner while the model analyzes your code (issue 011): the call takes ~15-25s — make
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
  const analyzed = items.some((i) => i.result);

  // --- report (always shown, ADR-003) ----------------------------------------
  // Consent-to-persist was already asked up front (runFrontloadedConsent in
  // main, before Skill selection) — nothing consent-related happens here.
  process.stdout.write('\n' + renderCertificationTerminal(certification, lang) + '\n\n');

  // Local report (skill-code-certification, reporting redesign): upsert each
  // certified Skill into THIS PROJECT's scoped report (keyed by Skill id within
  // the project `root`) and ALWAYS print its file:// link. HTML is no longer
  // opt-in behind --html. Writing the local report must never break the run.
  try {
    const paths = upsertCertification({ root, items, lang });
    // OSC 8 clickable file:// link (iTerm2 &c.); plain URL elsewhere.
    process.stdout.write(`  ${c.reportLink(oscLink(paths.fileUrl))}\n\n`);
  } catch {
    // Never break the local run over a failed report write.
  }

  // --- persist (only if consent is granted) ----------------------------------
  if (analyzed) {
    await maybeShareCertification(items);
  }
}

// Exposed as `run(argv, { ask })` (ADR-014) so the branded REPL
// (bin/sh-eval.js) invokes the SAME certify logic the `certify` command used
// to run, without duplicating it. `argv` is the arg array; `ask` is the SHARED
// stdin reader injected by the REPL (nested stdin) — when present, disclaimer /
// consent / email / OTP / selection all read through it, and this function
// NEVER closes it (the REPL owns its lifecycle). Standalone (no `ask`) it
// creates and closes its own, exactly as before.
async function run(argv = process.argv.slice(2), { ask: injectedAsk = null } = {}) {
  const opts = parseCertifyArgs(argv);
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
  const ask = injectedAsk || createStdinAsk();
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

    // (4) Consent-to-PERSIST + email + OTP, FRONT-LOADED (skill-code-
    // certification / user decision 2026-07-15): all the legal/consent/email/
    // verification interaction happens NOW — after the egress disclaimer, before
    // choosing Skills — never buried after certifying. Only asked when there's
    // no persisted decision yet. A granted decision stores the (OTP-verified)
    // email, reused as the identity below; the report is still always shown.
    await runFrontloadedConsent({ ask, catalog, stdinIsTTY });

    // (5) Identity for the server calls (resolve/certify). Reuses the email just
    // stored by the consent grant; otherwise --email / prompt (a declined
    // consent stores no email, so an identity email is still resolved here).
    const email = await resolveEmail({ opts, catalog, ask, stdinIsTTY });
    if (!email) {
      process.stderr.write(`  ${catalog.certify.emailNeeded}\n\n`);
      process.exitCode = 1;
      return;
    }

    // (6) Resolve request. Resilient: inform on failure, never hang, no
    // deterministic fallback (ADR-001).
    const requestBody = buildResolveRequest(email, technologies);
    const outcome = await requestResolve(requestBody, { endpoint });
    if (!outcome.ok) {
      reportCertifyFailure(outcome.reason, catalog, email);
      return;
    }

    process.stdout.write('\n' + formatResolveReport(technologies, outcome.result, catalog) + '\n\n');

    // (7) Certify phase (issue 005): select certifiable Skills, sample+scrub+
    // send code, show the assessment report; persist iff consent was granted
    // up front.
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
    // Only close a reader we own; never the REPL's shared one.
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run };

// Only auto-run when executed directly (`node bin/certify.js`). Guarded so the
// REPL can `require()` this module and call `run()` without a second execution
// (ADR-014).
if (require.main === module) {
  run();
}
