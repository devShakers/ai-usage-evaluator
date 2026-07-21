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
const { getCertifyEndpoint, loadSuperadminSession } = require('../src/config');
const { detectTechnologies } = require('../src/tech-detector');
const { confirmDisclaimerAcceptance } = require('../src/certify-disclaimer');
const {
  buildResolveRequest,
  requestResolve,
  buildCertifyRequest,
  requestCertify,
  certifyTimeoutForItems,
  classifyCertifyFailure,
} = require('../src/certify-client');
const { formatResolveReport } = require('../src/certify-render');
const { filterResolveBySampling } = require('../src/certify-sampling-filter');
const { buildSkillSamples } = require('../src/skill-sampler');
const { collectAuthorship, attributeSample } = require('../src/authorship');

// CLI version stamped as `toolVersion` on the persisted certification evidence
// (ADR-017) — same source `sh-eval` uses. `|| null` so a missing field never
// sends an empty string.
const CLI_VERSION = require('../package.json').version || null;
const { parseSkillSelection } = require('../src/skill-selection');
const { renderCertificationTerminal } = require('../src/render-certification');
const { persistCertification } = require('../src/report-store');
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
// Shared by both phases — `phase` ('resolve'|'certify') selects an accurate
// intro so a CERTIFY failure never prints the resolve-worded "could not resolve
// certifiable Skills" (misleading — the Skills WERE resolved and shown first).
function reportCertifyFailure(reason, catalog, email, phase = 'resolve') {
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
  if (kind === 'backend-unavailable') {
    // 5xx: the server is down/restarting or missing DB migrations. Actionable,
    // and DISTINCT from the network-error message — never blame the connection.
    process.stderr.write(`\n  ${c.errorBackendOutdated}\n\n`);
    process.exitCode = 1;
    return;
  }
  // technical: network/timeout/invalid/other non-2xx — generic error + retry.
  const intro = phase === 'certify' ? c.errorIntroCertify : c.errorIntro;
  process.stderr.write(`\n  ${intro} ${resolveErrorMessage(reason, catalog)}\n`);
  process.stderr.write(`  ${c.errorRetryHint}\n\n`);
  process.exitCode = 1;
}

// Persists the analyzed certification result if consent is granted. Never
// throws — must not break the local report (ADR-011). `provenance` carries the
// run-level ADR-017 fields (repository/commitRange/toolVersion) stamped onto
// every persisted assessment row.
async function maybeShareCertification(items, provenance = {}) {
  try {
    await shareCertification(items, provenance);
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

  // ADR-027: a NON-PROD superadmin session (opened via `superadmin`) bypasses
  // the ADR-017 authorship gate wholesale — certify ANY code on ANY repo. The
  // token is honored server-side only in non-production. Supersedes the ADR-023
  // authorized-authoring widening (RESOLVE no longer returns a set).
  const superadmin = loadSuperadminSession();

  // Read git authorship once — used as the ADR-017 GATE (real run) and, either
  // way, for the ADR-025 provenance receipt (repository / commit range).
  const authorship = collectAuthorship(root);

  if (superadmin) {
    // Skip attribution entirely: every sampled file is sent as-is.
    for (const s of samples) {
      s.authorEmails = [];
      s.sampledFiles = Array.isArray(s.files) ? s.files.map((f) => f.path) : [];
      s.fileAttribution = [];
    }
    process.stdout.write(`\n  ${c.superadminBypass(superadmin.email || '')}\n`);
  } else {
    // --- verified authorship gate (ADR-017) ----------------------------------
    // Only code ATTRIBUTABLE to the Talent's verified email is certifiable. Git
    // is read locally (no egress); non-attributable files are dropped BEFORE any
    // code leaves the machine. "Sin email atribuible, no hay certificación."
    if (!authorship.available) {
      // No git / no readable history / squashed → attribution impossible → refuse
      // the whole run cleanly (never a crash, never a silent pass). ADR-018:
      // offer the human contact valve for a possible legitimate false negative.
      process.stdout.write(`\n  ${c.authorshipNoGit}\n  ${c.authorshipContact}\n\n`);
      return;
    }

    const refusedSkillNames = [];
    for (const s of samples) {
      // ADR-027: strict single-verified-email attribution (no authorized set).
      const attribution = attributeSample(s, email, authorship, null);
      // Persist-evidence + gate inputs live on the sample. Only attributable
      // files survive to be sent for certification.
      s.files = attribution.attributableFiles;
      s.authorEmails = attribution.authorEmails;
      s.sampledFiles = attribution.attributableFiles.map((f) => f.path);
      // ADR-025 receipt: the per-file attribution trail (path → git authors → ✓/✗)
      // for display only (never persisted; git authorship is not cryptographic proof).
      s.fileAttribution = attribution.fileAttribution;
      if (!attribution.certifiable && s.meta && s.meta.sampleable) {
        // A Skill that HAD a code sample but none of it is the Talent's own.
        refusedSkillNames.push(s.skillName);
      }
    }

    if (refusedSkillNames.length > 0) {
      // Some certified, some refused for lack of attributable code — say which,
      // and offer the ADR-018 contact valve for a possible false negative.
      process.stdout.write(`\n  ${c.authorshipRefused(refusedSkillNames.join(', '))}\n  ${c.authorshipContact}\n`);
    }
  }

  const sendable = samples.filter((s) => Array.isArray(s.files) && s.files.length > 0);

  if (sendable.length === 0) {
    // Nothing attributable (real run) or nothing sampled (superadmin) → refuse.
    // ADR-018 contact valve (display only, no automatic send).
    process.stdout.write(`\n  ${c.authorshipNoneAttributable}\n  ${c.authorshipContact}\n\n`);
    return;
  }

  // --- certify (egress; scrub happens in buildCertifyRequest) ---
  let results = [];
  if (sendable.length > 0) {
    const requestBody = buildCertifyRequest(email, sendable, lang, superadmin ? superadmin.token : null);
    // Spinner while the model analyzes your code (issue 011): each Skill is a
    // ~50s+ server-side gemini-2.5-pro call, run sequentially — make it clear
    // the CLI is working, not hung. withSpinner degrades to a single stderr
    // line on non-TTY. The HTTP timeout SCALES with the number of Skills
    // (`certifyTimeoutForItems`) so a multi-Skill run isn't aborted mid-way.
    const timeoutMs = certifyTimeoutForItems(requestBody.items.length);
    const outcome = await withSpinner(c.certifyingLabel, () =>
      requestCertify(requestBody, { endpoint, timeoutMs }),
    );
    if (!outcome.ok) {
      reportCertifyFailure(outcome.reason, catalog, email, 'certify');
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
    // Verified-authorship evidence (ADR-017) — persisted alongside the result.
    authorEmails: Array.isArray(s.authorEmails) ? s.authorEmails : [],
    sampledFiles: Array.isArray(s.sampledFiles) ? s.sampledFiles : [],
    // ADR-025 receipt: per-file attribution trail (display only).
    fileAttribution: Array.isArray(s.fileAttribution) ? s.fileAttribution : [],
    result: (Array.isArray(s.files) && s.files.length > 0) ? (resultById.get(String(s.skillId)) || null) : null,
  }));
  // ADR-025: run-level provenance for the authorship receipt (repo + commit range).
  const certification = {
    items,
    model: null,
    authorship: { repository: authorship.repository, commitRange: authorship.commitRange },
  };
  const analyzed = items.some((i) => i.result);

  // --- report (always shown, ADR-003) ----------------------------------------
  // Consent-to-persist was already asked up front (runFrontloadedConsent in
  // main, before Skill selection) — nothing consent-related happens here.
  process.stdout.write('\n' + renderCertificationTerminal(certification, lang) + '\n\n');

  // ADR-016: certify PERSISTS each certified Skill into THIS PROJECT's scoped
  // state (report-state.json, keyed by Skill id within the project `root`) but
  // no longer writes the HTML nor prints a link — the cumulative HTML (footprint
  // + certified Skills) is materialized + opened only by the `report` command.
  // Persisting must never break the run.
  try {
    persistCertification({ root, items });
  } catch {
    // Never break the local run over a failed state write.
  }

  // --- persist (only if consent is granted) ----------------------------------
  if (analyzed) {
    await maybeShareCertification(items, {
      repository: authorship.repository,
      commitRange: authorship.commitRange,
      toolVersion: CLI_VERSION,
      // ADR-027: forward the session token so the backend stamps test_origin.
      superadminToken: superadmin ? superadmin.token : null,
    });
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

    // Invariant (listed-as-certifiable <=> has-a-defined-sampling): the RESOLVE
    // server may mark a technology certifiable even when this CLI has no code
    // sampling for it (detection-only techs — Jest historically, Vitest,
    // Tailwind…). Demote those to non-certifiable HERE, once, so both the
    // printed report and the interactive selection below offer only Skills that
    // can actually be certified by code — never advertise one that then fails
    // with "no hay muestreo definido".
    const resolved = filterResolveBySampling(outcome.result);

    process.stdout.write('\n' + formatResolveReport(technologies, resolved, catalog) + '\n\n');

    // (7) Certify phase (issue 005): select certifiable Skills, sample+scrub+
    // send code, show the assessment report; persist iff consent was granted
    // up front.
    await runCertifyPhase({
      endpoint,
      email,
      resolveResult: resolved,
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
