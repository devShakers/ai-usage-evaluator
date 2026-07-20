#!/usr/bin/env node
'use strict';

/*
 * `superadmin` — NON-PROD test-identity provisioning + teardown (skill-code-
 * certification ADR-021/022). Runs as an internal `sh-eval` command (ADR-014)
 * and is require()-able standalone.
 *
 *   superadmin                        provision (prompts password + email)
 *   superadmin --email X --password Y provision, non-interactive
 *   superadmin --remove --email X     TEARDOWN one test identity (ADR-022)
 *   superadmin --remove --all         TEARDOWN every test identity
 *
 * Provision creates a real, verified TEST Talent that passes the real certify
 * gates; teardown removes test identities ONLY (the backend refuses a real
 * account). The password is NEVER hardcoded here — collected and sent; the
 * backend validates it (constant-time) and 404s the whole route in production.
 *
 * Zero-dependency (node stdlib only): all helpers are local src/ modules.
 */

const http = require('http');
const https = require('https');
const { detectReportLang, getCatalog } = require('../src/i18n');
const {
  getProvisionTestTalentEndpoint,
  getTeardownTestTalentEndpoint,
  getInspectCertificationsEndpoint,
} = require('../src/config');
const { isValidEmail, normalizeEmail } = require('../src/share');
const { createStdinAsk } = require('../src/stdin-ask');

const REQUEST_TIMEOUT_MS = 20000;

// Minimal flag parse: --email, --password, --lang (all optional; interactive
// prompts fill the gaps). Kept tiny — this is a superadmin utility.
function splitEmails(raw) {
  return String(raw || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const opts = {
    email: null,
    password: null,
    lang: null,
    remove: false,
    all: false,
    inspect: false,
    authorDomain: null,
    authorEmails: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') opts.email = argv[++i];
    else if (a.startsWith('--email=')) opts.email = a.slice('--email='.length);
    else if (a === '--password') opts.password = argv[++i];
    else if (a.startsWith('--password=')) opts.password = a.slice('--password='.length);
    else if (a === '--remove' || a === '--delete' || a === '--teardown') opts.remove = true;
    else if (a === '--inspect' || a === '--audit') opts.inspect = true;
    else if (a === '--all') opts.all = true;
    // ADR-023 authorized authoring set (provision only).
    else if (a === '--author-domain') opts.authorDomain = argv[++i];
    else if (a.startsWith('--author-domain=')) opts.authorDomain = a.slice('--author-domain='.length);
    else if (a === '--author-emails') opts.authorEmails = splitEmails(argv[++i]);
    else if (a.startsWith('--author-emails=')) opts.authorEmails = splitEmails(a.slice('--author-emails='.length));
    else if (a === '--lang' && (argv[i + 1] === 'es' || argv[i + 1] === 'en')) opts.lang = argv[++i];
    else if (a === '--lang=es') opts.lang = 'es';
    else if (a === '--lang=en') opts.lang = 'en';
  }
  return opts;
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(e);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(body));
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { kind: 'timeout' })));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Reads a line via the shared reader when available. NOTE: the password is read
// unmasked — the shared REPL reader has no raw-mode masking, and this is a
// local, non-prod tool.
async function promptLine(ask, canPrompt, label) {
  if (!canPrompt) return '';
  return String(await ask(label)).trim();
}

async function run(argv = process.argv.slice(2), { ask: injectedAsk = null } = {}) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const c = getCatalog(lang).superadmin;

  const mode = opts.inspect ? 'inspect' : opts.remove ? 'remove' : 'provision';
  const endpoint =
    mode === 'inspect'
      ? getInspectCertificationsEndpoint()
      : mode === 'remove'
        ? getTeardownTestTalentEndpoint()
        : getProvisionTestTalentEndpoint();
  if (!endpoint) {
    process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }

  const intro = mode === 'inspect' ? c.inspectIntro : mode === 'remove' ? c.removeIntro : c.intro;
  process.stdout.write(`\n  ${intro}\n`);

  const canPrompt = !!process.stdin.isTTY || !!injectedAsk;
  const ask = injectedAsk || createStdinAsk();
  try {
    const password = opts.password || (await promptLine(ask, canPrompt, c.passwordPrompt));
    if (mode === 'inspect') {
      await runInspect({ opts, c, endpoint, password, ask, canPrompt });
    } else if (mode === 'remove') {
      await runTeardown({ opts, c, endpoint, password, ask, canPrompt });
    } else {
      await runProvision({ opts, c, endpoint, password, ask, canPrompt });
    }
  } finally {
    if (!injectedAsk) ask.close();
  }
}

// ADR-025 read-only attribution receipt for stored certifications.
async function runInspect({ opts, c, endpoint, password, ask, canPrompt }) {
  const email = await resolveEmailArg(opts, c, ask, canPrompt, c.inspectEmailPrompt);
  if (!password || !email || !isValidEmail(email)) {
    process.stderr.write(`\n  ${c.needInput}\n\n`);
    process.exitCode = 1;
    return;
  }

  let res;
  try {
    res = await postJson(endpoint, { password, email: normalizeEmail(email) });
  } catch {
    process.stderr.write(`\n  ${c.inspectErrorGeneric}\n\n`);
    process.exitCode = 1;
    return;
  }

  if (res.status >= 200 && res.status < 300) {
    const certs = (res.json && Array.isArray(res.json.certifications) && res.json.certifications) || [];
    printInspectReceipts(certs, normalizeEmail(email), c);
    return;
  }
  if (res.status === 403) process.stderr.write(`\n  ${c.errorWrongPassword}\n\n`);
  else if (res.status === 404) process.stderr.write(`\n  ${c.errorDisabled}\n\n`);
  else process.stderr.write(`\n  ${c.inspectErrorGeneric}\n\n`);
  process.exitCode = 1;
}

// Prints the stored authorship + rubric evidence per certification. Attribution
// trail (git authorship), NOT cryptographic proof — stated in the note.
function printInspectReceipts(certs, email, c) {
  if (certs.length === 0) {
    process.stdout.write(`\n  ${c.inspectNone(email)}\n\n`);
    return;
  }
  const L = c.inspectLabels;
  const out = [`\n  ${c.inspectHeader(certs.length, email)}\n`];
  for (const cert of certs) {
    const dims =
      cert.dimensionScores && typeof cert.dimensionScores === 'object'
        ? Object.entries(cert.dimensionScores)
            .map(([k, v]) => `${k} ${v == null ? 'N/A' : `${v}/4`}`)
            .join(', ')
        : '—';
    const confirmed = Array.isArray(cert.authorEmails)
      ? cert.authorEmails.filter((a) => a && a.matched).map((a) => a.email)
      : [];
    const considered = Array.isArray(cert.authorEmails) ? cert.authorEmails.map((a) => a.email) : [];
    const files = Array.isArray(cert.sampledFiles) ? cert.sampledFiles : [];
    out.push(`  ── ${cert.skillName}${cert.technology ? ` (${cert.technology})` : ''}`);
    out.push(`     ${L.score}: ${cert.score == null ? 'n/a' : `${cert.score}/100`}`);
    out.push(`     ${L.dimensions}: ${dims}`);
    if (cert.repository) out.push(`     ${L.repo}: ${cert.repository}`);
    if (cert.commitRange) out.push(`     ${L.commitRange}: ${cert.commitRange}`);
    if (files.length) out.push(`     ${L.sampledFiles}: ${files.join(', ')}`);
    if (confirmed.length) out.push(`     ${L.authorsConfirmed}: ${confirmed.join(', ')}`);
    else if (considered.length) out.push(`     ${L.authorsConsidered}: ${considered.join(', ')}`);
    out.push(`     ${L.model}: ${cert.model || '—'}${cert.promptVersion ? ` · ${cert.promptVersion}` : ''}`);
    out.push(`     ${L.when}: ${cert.createdAt}`);
    if (cert.testOrigin) out.push(`     ${L.testOrigin}: ✓`);
    out.push('');
  }
  out.push(`  ${c.inspectNote}\n`);
  process.stdout.write(out.join('\n'));
}

async function resolveEmailArg(opts, c, ask, canPrompt, promptLabel) {
  if (opts.email) return opts.email;
  if (!canPrompt) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = String(await ask(promptLabel)).trim();
    if (isValidEmail(raw)) return raw;
    process.stdout.write(`  ${c.emailInvalid}\n`);
  }
  return null;
}

async function runProvision({ opts, c, endpoint, password, ask, canPrompt }) {
  const email = await resolveEmailArg(opts, c, ask, canPrompt, c.emailPrompt);
  if (!password || !email || !isValidEmail(email)) {
    process.stderr.write(`\n  ${c.needInput}\n\n`);
    process.exitCode = 1;
    return;
  }

  // ADR-023 authorized authoring set — sent only when the superadmin specified
  // it; the server applies the default domain otherwise.
  const body = { password, email: normalizeEmail(email) };
  if (opts.authorDomain && opts.authorDomain.trim()) body.authorDomain = opts.authorDomain.trim();
  if (Array.isArray(opts.authorEmails) && opts.authorEmails.length > 0) {
    body.extraEmails = opts.authorEmails.map((e) => normalizeEmail(e));
  }

  let res;
  try {
    res = await postJson(endpoint, body);
  } catch {
    process.stderr.write(`\n  ${c.errorGeneric}\n\n`);
    process.exitCode = 1;
    return;
  }

  if (res.status >= 200 && res.status < 300) {
    const provisionedEmail = (res.json && res.json.email) || normalizeEmail(email);
    const reused = !!(res.json && res.json.reused);
    const auth = (res.json && res.json.authorizedAuthoring) || null;
    process.stdout.write(`\n  ${reused ? c.reused(provisionedEmail) : c.ready(provisionedEmail)}\n`);
    if (auth && auth.domain) {
      const extra = Array.isArray(auth.extraEmails) && auth.extraEmails.length > 0
        ? auth.extraEmails.join(', ')
        : null;
      process.stdout.write(`  ${c.authoring(auth.domain, extra)}\n`);
    }
    process.stdout.write('\n');
    return;
  }
  if (res.status === 403) process.stderr.write(`\n  ${c.errorWrongPassword}\n\n`);
  else if (res.status === 404) process.stderr.write(`\n  ${c.errorDisabled}\n\n`);
  else if (res.status === 409) process.stderr.write(`\n  ${c.errorConflict}\n\n`);
  else process.stderr.write(`\n  ${c.errorGeneric}\n\n`);
  process.exitCode = 1;
}

async function runTeardown({ opts, c, endpoint, password, ask, canPrompt }) {
  const body = { password };
  if (opts.all) {
    body.all = true;
  } else {
    const email = await resolveEmailArg(opts, c, ask, canPrompt, c.removeEmailPrompt);
    if (!email || !isValidEmail(email)) {
      process.stderr.write(`\n  ${c.removeNeedTarget}\n\n`);
      process.exitCode = 1;
      return;
    }
    body.email = normalizeEmail(email);
  }

  if (!password) {
    process.stderr.write(`\n  ${c.needInput}\n\n`);
    process.exitCode = 1;
    return;
  }

  let res;
  try {
    res = await postJson(endpoint, body);
  } catch {
    process.stderr.write(`\n  ${c.removeErrorGeneric}\n\n`);
    process.exitCode = 1;
    return;
  }

  if (res.status >= 200 && res.status < 300) {
    const removed = (res.json && Array.isArray(res.json.removed) && res.json.removed) || [];
    const count = res.json && typeof res.json.count === 'number' ? res.json.count : removed.length;
    const emails = removed.map((r) => r && r.email).filter(Boolean).join(', ');
    process.stdout.write(`\n  ${c.removed(count, emails)}\n\n`);
    return;
  }
  if (res.status === 403) process.stderr.write(`\n  ${c.errorWrongPassword}\n\n`);
  else if (res.status === 404) process.stderr.write(`\n  ${c.errorDisabled}\n\n`);
  else if (res.status === 409) process.stderr.write(`\n  ${c.removeRefusedReal}\n\n`);
  else process.stderr.write(`\n  ${c.removeErrorGeneric}\n\n`);
  process.exitCode = 1;
}

module.exports = { run };

if (require.main === module) {
  run();
}
