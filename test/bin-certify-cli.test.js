'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const { handle } = require('../reference-server/server');

/*
 * skill-code-certification, issues 004 + 006: end-to-end. Runs the actual
 * `ai-certify` binary as a process (it calls main() on load, so it can't be
 * require()d — same constraint as bin/report.js) against the deterministic
 * reference-server stub wired on an ephemeral port. Proves the RESOLVE phase
 * works end to end locally without the real Hub.
 */

const BIN = path.join(__dirname, '..', 'bin', 'certify.js');

function startStub() {
  const state = { requests: 0 };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      state.requests += 1;
      handle(req, res).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, state }));
  });
}
function certifyUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/works/ai-footprint/skill-certification`;
}

function runCli({ args = [], stdin = '', env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, AI_FOOTPRINT_CERTIFY_ENDPOINT: '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

let tmpConfigDir;
let tmpProjectDir;

test.beforeEach(() => {
  tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-certify-config-'));
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-certify-project-'));
});
test.afterEach(() => {
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
});

// Initializes a git repo in `dir` and commits everything already written,
// authored by `email`. The ADR-017 verified-authorship gate reads git to
// confirm the sampled code is the Talent's — so the fixtures must carry a real
// history. Config is repo-local (never touches the machine's global git).
function gitCommitAll(dir, email) {
  const git = (args) =>
    execFileSync('git', ['-C', dir, ...args], {
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test Talent',
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: 'Test Talent',
        GIT_COMMITTER_EMAIL: email,
      },
    });
  git(['init', '-q']);
  git(['config', 'user.email', email]);
  git(['config', 'user.name', 'Test Talent']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial']);
}

// `email` = the git author for the project's commits. Defaults to the address
// every full-flow test certifies with, so attribution passes; a test can pass a
// DIFFERENT email to exercise the refusal path.
function writeReactProject(email = 'talent@example.com') {
  fs.writeFileSync(
    path.join(tmpProjectDir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0', express: '^4.0.0' } }),
  );
  // Real source files so the sampler has candidates to certify.
  fs.mkdirSync(path.join(tmpProjectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpProjectDir, 'src', 'App.jsx'), 'export default function App() { return null; }\n'.repeat(4));
  fs.writeFileSync(path.join(tmpProjectDir, 'src', 'server.js'), 'const express = require("express"); const app = express();\n'.repeat(4));
  gitCommitAll(tmpProjectDir, email);
}

test('--help prints usage and exits 0 (no endpoint needed)', async () => {
  const { code, stdout } = await runCli({ args: ['--help', '--lang', 'en'] });
  assert.equal(code, 0);
  assert.match(stdout, /AI Certify/);
  assert.match(stdout, /--accept-disclaimer/);
});

test('no endpoint configured -> actionable error, exit 1 (no silent degrade)', async () => {
  writeReactProject();
  const { code, stderr } = await runCli({
    args: ['--root', tmpProjectDir, '--email', 'a@b.com', '--accept-disclaimer', '--lang', 'en'],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: '' },
  });
  assert.equal(code, 1);
  // Endpoint unification (commit 8d89e4d): the actionable copy now points at
  // footprint --set-endpoint / AI_FOOTPRINT_INGEST_ENDPOINT (the shared base),
  // not a certify-only env var.
  assert.match(stderr, /--set-endpoint|AI_FOOTPRINT_INGEST_ENDPOINT/);
});

test('no recognized technologies -> informs and exits 0 (nothing to certify)', async () => {
  const { server } = await startStub();
  try {
    // empty project (no manifest) -> no technologies
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'a@b.com', '--accept-disclaimer', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    assert.match(stdout, /Nothing to certify/);
  } finally {
    server.close();
  }
});

test('full flow end-to-end against the stub: resolve -> --all certify -> report, exit 0', async () => {
  writeReactProject();
  const { server } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    assert.match(stdout, /LEGAL DISCLAIMER/);
    assert.match(stdout, /Certifiable Skills for your project/);
    // certify phase report
    assert.match(stdout, /Skill certification result/);
    assert.match(stdout, /anchored rubric/); // ADR-024 disclaimer
    assert.match(stdout, /Score: \d+\/100/);
    assert.match(stdout, /Sample: \d+\/\d+ files/);
  } finally {
    server.close();
  }
});

test('ADR-016: a full certify run PERSISTS the certification into report-state.json, writes NO html and prints NO link', async () => {
  writeReactProject();
  const { server } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    // certify no longer prints a report link (ADR-016 — the `report` command opens it).
    assert.equal(/file:\/\//.test(stdout), false, 'certify no longer prints a link');
    assert.equal(/Open your report|Abre tu informe/.test(stdout), false, 'no report-link copy');
    // State IS persisted; no html written by certify.
    assert.ok(fs.existsSync(path.join(tmpConfigDir, 'report-state.json')), 'state file written');
    assert.equal(
      fs.readdirSync(tmpConfigDir).some((f) => /^report-[a-f0-9]{12}\.html$/.test(f)),
      false,
      'certify writes no html (report command does)',
    );
    // And the certification is retrievable from state (report command renders it).
    // materializeProjectReport reads AI_FOOTPRINT_CONFIG_DIR from THIS process,
    // so point it at the same throwaway dir the spawned CLI wrote to.
    const prevCfg = process.env.AI_FOOTPRINT_CONFIG_DIR;
    process.env.AI_FOOTPRINT_CONFIG_DIR = tmpConfigDir;
    try {
      const { materializeProjectReport } = require('../src/report-store');
      const r = materializeProjectReport({ root: tmpProjectDir, lang: 'en' });
      const html = fs.readFileSync(r.htmlPath, 'utf8');
      assert.match(html, /Skill certification/);
    } finally {
      if (prevCfg === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR;
      else process.env.AI_FOOTPRINT_CONFIG_DIR = prevCfg;
    }
  } finally {
    server.close();
  }
});

test('consent (Issue B): with NO prior decision, the persist-consent prompt is shown BEFORE the report, and the report is STILL shown after declining', async () => {
  writeReactProject();
  const { server } = await startStub();
  try {
    const { code, stdout } = await runCli({
      // deny ('n') — no email/OTP asked; keeps the test off the network
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      stdin: 'n\n',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    const consentIdx = stdout.indexOf('Save this report in Shakers?');
    const reportIdx = stdout.indexOf('Skill certification result');
    assert.ok(consentIdx !== -1, 'consent prompt shown');
    assert.ok(reportIdx !== -1, 'report still shown (ADR-003)');
    assert.ok(consentIdx < reportIdx, 'consent is asked BEFORE the report is shown (like footprint)');
    assert.match(stdout, /nothing will be saved/); // denied ack
  } finally {
    server.close();
  }
});

test('consent front-loaded (ADR-003 / 2026-07-15): with NO prior decision, consent is asked BEFORE skill resolution/selection, not after certifying', async () => {
  writeReactProject();
  const { server } = await startStub();
  try {
    const { code, stdout } = await runCli({
      // deny ('n') up front — no email/OTP, stays off the network
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      stdin: 'n\n',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    const disclaimerIdx = stdout.indexOf('LEGAL DISCLAIMER');
    const consentIdx = stdout.indexOf('Save this report in Shakers?');
    const resolveIdx = stdout.indexOf('Certifiable Skills for your project');
    const reportIdx = stdout.indexOf('Skill certification result');
    assert.ok(disclaimerIdx !== -1 && consentIdx !== -1 && resolveIdx !== -1 && reportIdx !== -1);
    // Egress disclaimer (ADR-001) stays first; then consent; then resolution
    // (which precedes Skill selection); then the report.
    assert.ok(disclaimerIdx < consentIdx, 'disclaimer (egress gate) precedes consent');
    assert.ok(consentIdx < resolveIdx, 'consent is asked BEFORE Skills are resolved/selected');
    assert.ok(resolveIdx < reportIdx, 'the report comes last, still always shown');
  } finally {
    server.close();
  }
});

test('consent (Issue B): with consent ALREADY granted, no prompt is shown and the report is shown directly', async () => {
  writeReactProject();
  fs.writeFileSync(
    path.join(tmpConfigDir, 'consent.json'),
    JSON.stringify({ consent: 'granted', email: 'talent@example.com', lastSentAt: null }),
  );
  const { server } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      stdin: '', // nothing to answer — must not block waiting for consent
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    assert.match(stdout, /Skill certification result/, 'report shown');
    assert.equal(stdout.includes('Save this report in Shakers?'), false, 'no consent re-prompt when already granted');
  } finally {
    server.close();
  }
});

test('certify phase: non-interactive without --all/--skills aborts after resolve, exit 1, no code sent', async () => {
  writeReactProject();
  const { server, state } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 1);
    assert.match(stdout, /cannot select Skills/);
    // resolve happened (1 request), certify did NOT (no second request)
    assert.equal(state.requests, 1, 'only the resolve call, no certify egress');
  } finally {
    server.close();
  }
});

test('certify phase: --skills selects a subset', async () => {
  writeReactProject();
  const { server } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--skills', '1', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    assert.match(stdout, /Skill certification result/);
    assert.match(stdout, /Score: \d+\/100/);
  } finally {
    server.close();
  }
});

test('ADR-017 gate: a project with NO git history is refused before any certify egress', async () => {
  // Write the project WITHOUT git (no gitCommitAll) — attribution impossible.
  fs.writeFileSync(
    path.join(tmpProjectDir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }),
  );
  fs.mkdirSync(path.join(tmpProjectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpProjectDir, 'src', 'App.jsx'), 'export default function App() { return null; }\n'.repeat(4));

  const { server, state } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0); // clean refusal, not a crash
    assert.match(stdout, /Without git history the code authorship cannot be verified/);
    // ADR-018 contact valve is shown (display only — no extra request is made).
    assert.match(stdout, /talent@shakersworks\.com/);
    assert.equal(/Skill certification result/.test(stdout), false, 'no certification report');
    assert.equal(state.requests, 1, 'only the resolve call — NO certify egress of unattributable code');
  } finally {
    server.close();
  }
});

test('ADR-017 gate: a project authored by a DIFFERENT email is refused (no attributable code)', async () => {
  writeReactProject('someone-else@other.com'); // git history, but not the certifying Talent
  const { server, state } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    assert.match(stdout, /None of the selected Skills has code attributable to your verified email/);
    assert.match(stdout, /talent@shakersworks\.com/); // ADR-018 contact valve shown
    assert.equal(/Skill certification result/.test(stdout), false, 'no certification report');
    assert.equal(state.requests, 1, 'only the resolve call — nothing the Talent did not author is sent');
  } finally {
    server.close();
  }
});

test('disclaimer not accepted (non-TTY, no flag) -> aborts, exit 1, NOTHING sent', async () => {
  writeReactProject();
  const { server, state } = await startStub();
  try {
    const { code, stdout } = await runCli({
      // piped (non-TTY) stdin, no --accept-disclaimer
      args: ['--root', tmpProjectDir, '--email', 'a@b.com', '--lang', 'en'],
      stdin: '',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 1);
    assert.match(stdout, /Non-interactive input/);
    assert.equal(state.requests, 0, 'no egress must happen before disclaimer acceptance');
  } finally {
    server.close();
  }
});

// --- issue 014: status -> UX mapping (403 is not a technical error) ----------

function startStatusStub(status, body = '{}') {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body); });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function statusUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/works/ai-footprint/skill-certification`;
}

test('014: 403 (not a registered Talent) -> calm message, exit 0, no error styling/retry/HTTP-code', async () => {
  writeReactProject();
  const server = await startStatusStub(403, JSON.stringify({ message: 'not a talent' }));
  try {
    const { code, stdout, stderr } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'nobody@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: statusUrl(server) },
    });
    assert.equal(code, 0, '403 is an expected outcome, not a crash');
    const out = stdout + stderr;
    assert.match(out, /only for registered Shakers Talents/);
    assert.match(out, /nobody@example\.com/);
    // No technical-error framing:
    assert.equal(/HTTP 403|unexpected status|Could not resolve|Check your connection|try again later/.test(out), false);
  } finally {
    server.close();
  }
});

test('014: 413 -> clear "too large" message (not the generic connection error), exit 1', async () => {
  writeReactProject();
  const server = await startStatusStub(413);
  try {
    const { code, stdout, stderr } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'a@b.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: statusUrl(server) },
    });
    assert.equal(code, 1);
    const out = stdout + stderr;
    assert.match(out, /too large/);
    assert.equal(/Check your connection|HTTP 413/.test(out), false);
  } finally {
    server.close();
  }
});

test('missing-migrations bugfix: 5xx -> actionable "backend unavailable / missing migrations" message (NOT a network error), exit 1', async () => {
  writeReactProject();
  const server = await startStatusStub(503);
  try {
    const { code, stdout, stderr } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'a@b.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: statusUrl(server) },
    });
    assert.equal(code, 1);
    const out = stdout + stderr;
    // Actionable, server-side message — distinct from the network-error copy.
    assert.match(out, /missing database migrations|restarting/i);
    assert.match(out, /Apply migrations and restart/i);
    // NOT the generic connection/retry hint.
    assert.equal(/Check your connection/i.test(out), false);
  } finally {
    server.close();
  }
});

test('resolve failure (bad endpoint) -> actionable error, exit 1, never hangs', async () => {
  writeReactProject();
  const { code, stderr } = await runCli({
    args: ['--root', tmpProjectDir, '--email', 'a@b.com', '--accept-disclaimer', '--lang', 'en'],
    // nothing listening on this port
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/skill-certification' },
  });
  assert.equal(code, 1);
  assert.match(stderr, /Could not resolve certifiable Skills/);
});
