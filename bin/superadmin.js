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
} = require('../src/config');
const { isValidEmail, normalizeEmail } = require('../src/share');
const { createStdinAsk } = require('../src/stdin-ask');

const REQUEST_TIMEOUT_MS = 20000;

// Minimal flag parse: --email, --password, --lang (all optional; interactive
// prompts fill the gaps). Kept tiny — this is a superadmin utility.
function parseArgs(argv) {
  const opts = { email: null, password: null, lang: null, remove: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') opts.email = argv[++i];
    else if (a.startsWith('--email=')) opts.email = a.slice('--email='.length);
    else if (a === '--password') opts.password = argv[++i];
    else if (a.startsWith('--password=')) opts.password = a.slice('--password='.length);
    else if (a === '--remove' || a === '--delete' || a === '--teardown') opts.remove = true;
    else if (a === '--all') opts.all = true;
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

  const endpoint = opts.remove ? getTeardownTestTalentEndpoint() : getProvisionTestTalentEndpoint();
  if (!endpoint) {
    process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n  ${opts.remove ? c.removeIntro : c.intro}\n`);

  const canPrompt = !!process.stdin.isTTY || !!injectedAsk;
  const ask = injectedAsk || createStdinAsk();
  try {
    const password = opts.password || (await promptLine(ask, canPrompt, c.passwordPrompt));
    if (opts.remove) {
      await runTeardown({ opts, c, endpoint, password, ask, canPrompt });
    } else {
      await runProvision({ opts, c, endpoint, password, ask, canPrompt });
    }
  } finally {
    if (!injectedAsk) ask.close();
  }
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

  let res;
  try {
    res = await postJson(endpoint, { password, email: normalizeEmail(email) });
  } catch {
    process.stderr.write(`\n  ${c.errorGeneric}\n\n`);
    process.exitCode = 1;
    return;
  }

  if (res.status >= 200 && res.status < 300) {
    const provisionedEmail = (res.json && res.json.email) || normalizeEmail(email);
    const reused = !!(res.json && res.json.reused);
    process.stdout.write(`\n  ${reused ? c.reused(provisionedEmail) : c.ready(provisionedEmail)}\n\n`);
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
