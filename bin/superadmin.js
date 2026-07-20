#!/usr/bin/env node
'use strict';

/*
 * `superadmin` — NON-PROD, password-authenticated superadmin SESSION (ADR-027,
 * supersedes the ADR-021/022/023 provision/teardown/authorized-authoring flow).
 * Runs as an internal `sh-eval` command (ADR-014) and is require()-able standalone.
 *
 *   superadmin                        open a session (prompts password + your email)
 *   superadmin --email X --password Y open a session, non-interactive
 *   superadmin --inspect --email X    READ-ONLY certification receipt (ADR-025)
 *   superadmin --logout               forget the locally stored session
 *
 * Opening a session validates the superadmin password server-side and persists
 * the returned token locally. `certify` then runs against ANY email on ANY repo
 * (bypassing the identity + authorship gates) and its persisted results are
 * stamped `test_origin=true` — all NON-PROD only (the backend 404s the session
 * route and refuses the bypass in production). The password is NEVER hardcoded
 * here — collected and sent; the backend validates it (constant-time).
 *
 * Zero-dependency (node stdlib only): all helpers are local src/ modules.
 */

const http = require('http');
const https = require('https');
const { detectReportLang, getCatalog } = require('../src/i18n');
const {
  getSuperadminSessionEndpoint,
  getInspectCertificationsEndpoint,
  saveSuperadminSession,
  clearSuperadminSession,
} = require('../src/config');
const { isValidEmail, normalizeEmail } = require('../src/share');
const { createStdinAsk } = require('../src/stdin-ask');

const REQUEST_TIMEOUT_MS = 20000;

// Minimal flag parse: --email, --password, --lang, --inspect, --logout (all
// optional; interactive prompts fill the gaps). Kept tiny — superadmin utility.
function parseArgs(argv) {
  const opts = {
    email: null,
    password: null,
    lang: null,
    inspect: false,
    logout: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') opts.email = argv[++i];
    else if (a.startsWith('--email=')) opts.email = a.slice('--email='.length);
    else if (a === '--password') opts.password = argv[++i];
    else if (a.startsWith('--password=')) opts.password = a.slice('--password='.length);
    else if (a === '--inspect' || a === '--audit') opts.inspect = true;
    else if (a === '--logout' || a === '--forget') opts.logout = true;
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

  // --logout is local-only (no endpoint, no password): forget the stored token.
  if (opts.logout) {
    clearSuperadminSession();
    process.stdout.write(`\n  ${c.loggedOut}\n\n`);
    return;
  }

  const mode = opts.inspect ? 'inspect' : 'session';
  const endpoint =
    mode === 'inspect' ? getInspectCertificationsEndpoint() : getSuperadminSessionEndpoint();
  if (!endpoint) {
    process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }

  const intro = mode === 'inspect' ? c.inspectIntro : c.sessionIntro;
  process.stdout.write(`\n  ${intro}\n`);

  const canPrompt = !!process.stdin.isTTY || !!injectedAsk;
  const ask = injectedAsk || createStdinAsk();
  try {
    const password = opts.password || (await promptLine(ask, canPrompt, c.passwordPrompt));
    if (mode === 'inspect') {
      await runInspect({ opts, c, endpoint, password, ask, canPrompt });
    } else {
      await runOpenSession({ opts, c, endpoint, password, ask, canPrompt });
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

// ADR-027: open a superadmin SESSION — validate the password server-side, get a
// token, persist it locally. The email is the superadmin's OWN (audit only).
async function runOpenSession({ opts, c, endpoint, password, ask, canPrompt }) {
  const email = await resolveEmailArg(opts, c, ask, canPrompt, c.emailPrompt);
  if (!password || !email || !isValidEmail(email)) {
    process.stderr.write(`\n  ${c.needInput}\n\n`);
    process.exitCode = 1;
    return;
  }

  let res;
  try {
    res = await postJson(endpoint, { password, email: normalizeEmail(email) });
  } catch {
    process.stderr.write(`\n  ${c.errorGeneric}\n\n`);
    process.exitCode = 1;
    return;
  }

  if (res.status >= 200 && res.status < 300 && res.json && res.json.token) {
    saveSuperadminSession({
      email: res.json.email || normalizeEmail(email),
      token: res.json.token,
      expiresAt: res.json.expiresAt || null,
    });
    process.stdout.write(`\n  ${c.sessionReady(res.json.email || normalizeEmail(email))}\n`);
    if (res.json.expiresAt) process.stdout.write(`  ${c.sessionExpires(res.json.expiresAt)}\n`);
    process.stdout.write(`  ${c.sessionHint}\n\n`);
    return;
  }
  if (res.status === 403) process.stderr.write(`\n  ${c.errorWrongPassword}\n\n`);
  else if (res.status === 404) process.stderr.write(`\n  ${c.errorDisabled}\n\n`);
  else process.stderr.write(`\n  ${c.errorGeneric}\n\n`);
  process.exitCode = 1;
}

module.exports = { run };

if (require.main === module) {
  run();
}
