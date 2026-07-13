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
const { buildResolveRequest, requestResolve } = require('../src/certify-client');
const { formatResolveReport } = require('../src/certify-render');
const { isValidEmail, normalizeEmail, getConsentStatus } = require('../src/share');
const { createStdinAsk } = require('../src/stdin-ask');

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

// Maps a requestResolve failure reason to an actionable, localized message.
function resolveErrorMessage(reason, catalog) {
  const c = catalog.certify;
  if (reason === 'no-endpoint') return c.errorNoEndpoint;
  if (reason === 'network-error') return c.errorNetwork;
  if (reason === 'timeout') return c.errorTimeout;
  if (typeof reason === 'string' && reason.startsWith('http-')) return c.errorHttp(reason.slice('http-'.length));
  return c.errorInvalidResponse; // invalid-json | invalid-shape
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
      process.stderr.write(`\n  ${catalog.certify.errorIntro} ${resolveErrorMessage(outcome.reason, catalog)}\n`);
      process.stderr.write(`  ${catalog.certify.errorRetryHint}\n\n`);
      process.exitCode = 1;
      return;
    }

    process.stdout.write('\n' + formatResolveReport(technologies, outcome.result, catalog) + '\n\n');
  } finally {
    ask.close();
  }
}

main();
