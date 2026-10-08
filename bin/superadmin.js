#!/usr/bin/env node
'use strict';

// `superadmin` — NON-PROD, password-authenticated superadmin SESSION (ADR-027, supersedes the ADR-021/022/023 provision/teardown/authorized-authoring flow).

const http = require('http');
const https = require('https');
const { detectReportLang, getCatalog } = require('../src/i18n');
const {
  getSuperadminSessionEndpoint,
  getInspectCertificationsEndpoint,
  saveSuperadminSession,
  clearSuperadminSession,
  loadSuperadminSession,
  getProfile,
} = require('../src/config');
const { isValidEmail, normalizeEmail } = require('../src/share');
const { createStdinAsk } = require('../src/stdin-ask');
const { runInteractiveMultiSelect, wrapDesc } = require('../src/interactive-select');
const { palette } = require('../src/ansi');
const { switchProfile } = require('../src/profile-switch');

const REQUEST_TIMEOUT_MS = 20000;

// Only `dim`/`reset` — the numbered fallback's per-option descriptions are quiet chrome, same treatment every other picker in this CLI gives them.
const ANSI = palette({ reset: '\x1b[0m', dim: '\x1b[2m' });

// Minimal flag parse: --email, --lang, --inspect, --logout (all optional; the interactive prompt / a stdin pipe fills the gaps).
function parseArgs(argv) {
  const opts = {
    email: null,
    lang: null,
    inspect: false,
    logout: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') opts.email = argv[++i];
    else if (a.startsWith('--email=')) opts.email = a.slice('--email='.length);
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

// Reads a line via the shared reader when available.
async function promptLine(ask, canPrompt, label) {
  if (!canPrompt) return '';
  return String(await ask(label)).trim();
}

// The SECRET prompt (issue 102).
async function promptSecret(ask, canPrompt, label) {
  if (!canPrompt) return '';
  const read = typeof ask.secret === 'function' ? ask.secret.bind(ask) : ask;
  return String(await read(label)).trim();
}

function profileMenuItems(c) {
  const current = getProfile();
  return [
    {
      key: 'talent',
      label: current === 'talent' ? c.profileMenuTalentCurrent : c.profileMenuTalent,
      desc: c.profileMenuTalentDesc,
    },
    {
      key: 'external',
      label: current === 'external' ? c.profileMenuExternalCurrent : c.profileMenuExternal,
      desc: c.profileMenuExternalDesc,
    },
  ];
}

async function askNumberedChoice(ask, promptText, count) {
  const raw = (await ask(promptText)).trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > count) return null;
  return n - 1;
}

// The picker itself.
async function chooseProfileAction({ ask, c, input, output, stdinIsTTY }) {
  const items = profileMenuItems(c);
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items,
      labelFor: (i) => i.label,
      header: c.profileMenuHeading,
      hint: c.profileMenuHint,
      single: true,
      descriptionFor: (i) => i.desc || null,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return picked && picked.length ? picked[0].key : null;
  }

  process.stdout.write(`\n  ${c.profileMenuHeading}\n`);
  items.forEach((item, i) => {
    process.stdout.write(`    ${i + 1}) ${item.label}\n`);
    if (item.desc) for (const line of wrapDesc(item.desc)) process.stdout.write(`       ${ANSI.dim}${line}${ANSI.reset}\n`);
  });
  const idx = await askNumberedChoice(ask, `  ${c.profileMenuPrompt(items.length)}`, items.length);
  return idx === null ? null : items[idx].key;
}

// Runs the picker and, on a real choice, the switch itself.
async function runProfileMenu({ ask, c, input, output, stdinIsTTY }) {
  const picked = await chooseProfileAction({ ask, c, input, output, stdinIsTTY });
  if (!picked) {
    process.stdout.write(`\n  ${c.profileMenuCancelled}\n\n`);
    return;
  }
  const current = getProfile();
  if (picked === current) {
    process.stdout.write(`\n  ${c.profileAlreadyOn(picked)}\n\n`);
    return;
  }
  const result = switchProfile(picked);
  process.stdout.write(`\n  ${c.profileSwitched(result.to)}\n\n`);
}

async function run(argv = process.argv.slice(2), { ask: injectedAsk = null, input = undefined, output = undefined } = {}) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const c = getCatalog(lang).superadmin;

  // --logout is local-only (no endpoint, no password): forget the stored token.
  if (opts.logout) {
    clearSuperadminSession();
    process.stdout.write(`\n  ${c.loggedOut}\n\n`);
    return;
  }

  if (opts.inspect) {
    const endpoint = getInspectCertificationsEndpoint();
    if (!endpoint) {
      process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`\n  ${c.inspectIntro}\n`);
    process.stdout.write(`  ${c.queryingPrimary(endpoint)}\n`);
    const canPrompt = true;
    const ask = injectedAsk || createStdinAsk();
    try {
      const password = await promptSecret(ask, canPrompt, c.passwordPrompt);
      await runInspect({ opts, c, endpoint, password, ask, canPrompt });
    } finally {
      if (!injectedAsk) ask.close();
    }
    return;
  }

  // Default ("session") mode.
  const existing = loadSuperadminSession();
  const ask = injectedAsk || createStdinAsk();
  try {
    let sessionReady = !!existing;
    if (!existing) {
      const endpoint = getSuperadminSessionEndpoint();
      if (!endpoint) {
        process.stderr.write(`\n  ${c.errorNoEndpoint}\n\n`);
        process.exitCode = 1;
        return;
      }
      process.stdout.write(`\n  ${c.sessionIntro}\n`);
      // talents-ai-score, ADR-020/021 (coordinator ruling): superadmin is DELIBERATELY single-hop, PRIMARY (certifications service) ONLY — never hub.
      process.stdout.write(`  ${c.queryingPrimary(endpoint)}\n`);
      // Always true (three-way review): the password has NO argv flag anymore, so it must always be collectible — either from a real TTY, the REPL's injected reader, or a piped stdin.
      const password = await promptSecret(ask, true, c.passwordPrompt);
      sessionReady = await runOpenSession({ opts, c, endpoint, password, ask, canPrompt: true });
    }
    if (sessionReady) {
      const stdinIsTTY =
        input !== undefined ? !!input.isTTY : !!process.stdin.isTTY;
      await runProfileMenu({ ask, c, input, output, stdinIsTTY });
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

// ADR-027: open a superadmin SESSION — validate the password server-side, get a token, persist it locally.
async function runOpenSession({ opts, c, endpoint, password, ask, canPrompt }) {
  const email = await resolveEmailArg(opts, c, ask, canPrompt, c.emailPrompt);
  if (!password || !email || !isValidEmail(email)) {
    process.stderr.write(`\n  ${c.needInput}\n\n`);
    process.exitCode = 1;
    return false;
  }

  let res;
  try {
    res = await postJson(endpoint, { password, email: normalizeEmail(email) });
  } catch {
    process.stderr.write(`\n  ${c.errorGeneric}\n\n`);
    process.exitCode = 1;
    return false;
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
    return true;
  }
  if (res.status === 403) process.stderr.write(`\n  ${c.errorWrongPassword}\n\n`);
  else if (res.status === 404) process.stderr.write(`\n  ${c.errorDisabled}\n\n`);
  else process.stderr.write(`\n  ${c.errorGeneric}\n\n`);
  process.exitCode = 1;
  return false;
}

module.exports = { run };

if (require.main === module) {
  run();
}
