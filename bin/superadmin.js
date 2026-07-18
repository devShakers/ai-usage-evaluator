#!/usr/bin/env node
'use strict';

/*
 * `superadmin` — NON-PROD test-identity provisioning (skill-code-certification
 * ADR-021). Runs as an internal `sh-eval` command (ADR-014) and is require()-able
 * standalone. Collects the superadmin password + an email and calls the backend
 * provisioning endpoint, which — in NON-PRODUCTION ONLY — provisions a real,
 * verified TEST Talent that passes the real certify gates (identity + durable
 * verification + TTL). Then the superadmin runs the normal `certify --email <that>`.
 *
 * The password is NEVER hardcoded here — it is collected and sent; the backend
 * validates it (constant-time) and 404s the whole route in production. This
 * command only provisions; it does NOT chain certify.
 *
 * Zero-dependency (node stdlib only): all helpers are local src/ modules.
 */

const http = require('http');
const https = require('https');
const { detectReportLang, getCatalog } = require('../src/i18n');
const { getProvisionTestTalentEndpoint } = require('../src/config');
const { isValidEmail, normalizeEmail } = require('../src/share');
const { createStdinAsk } = require('../src/stdin-ask');

const REQUEST_TIMEOUT_MS = 20000;

// Minimal flag parse: --email, --password, --lang (all optional; interactive
// prompts fill the gaps). Kept tiny — this is a superadmin utility.
function parseArgs(argv) {
  const opts = { email: null, password: null, lang: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') opts.email = argv[++i];
    else if (a.startsWith('--email=')) opts.email = a.slice('--email='.length);
    else if (a === '--password') opts.password = argv[++i];
    else if (a.startsWith('--password=')) opts.password = a.slice('--password='.length);
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

async function run(argv = process.argv.slice(2), { ask: injectedAsk = null } = {}) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const c = getCatalog(lang).superadmin;

  const endpoint = getProvisionTestTalentEndpoint();
  if (!endpoint) {
    process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n  ${c.intro}\n`);

  const stdinIsTTY = !!process.stdin.isTTY;
  const ask = injectedAsk || createStdinAsk();
  try {
    // NOTE: the password is read as a normal line (not masked) — the shared
    // REPL reader has no raw-mode masking, and this is a local, non-prod tool.
    const password = opts.password || (stdinIsTTY || injectedAsk ? String(await ask(c.passwordPrompt)).trim() : '');

    let email = opts.email;
    if (!email) {
      if (!(stdinIsTTY || injectedAsk)) {
        process.stderr.write(`\n  ${c.needInput}\n\n`);
        process.exitCode = 1;
        return;
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const raw = String(await ask(c.emailPrompt)).trim();
        if (isValidEmail(raw)) {
          email = raw;
          break;
        }
        process.stdout.write(`  ${c.emailInvalid}\n`);
      }
    }

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

    // Map the backend's guard/validation outcomes to actionable copy.
    if (res.status === 403) process.stderr.write(`\n  ${c.errorWrongPassword}\n\n`);
    else if (res.status === 404) process.stderr.write(`\n  ${c.errorDisabled}\n\n`);
    else if (res.status === 409) process.stderr.write(`\n  ${c.errorConflict}\n\n`);
    else process.stderr.write(`\n  ${c.errorGeneric}\n\n`);
    process.exitCode = 1;
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run };

if (require.main === module) {
  run();
}
