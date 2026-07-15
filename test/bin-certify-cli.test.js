'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

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

function writeReactProject() {
  fs.writeFileSync(
    path.join(tmpProjectDir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0', express: '^4.0.0' } }),
  );
  // Real source files so the sampler has candidates to certify.
  fs.mkdirSync(path.join(tmpProjectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpProjectDir, 'src', 'App.jsx'), 'export default function App() { return null; }\n'.repeat(4));
  fs.writeFileSync(path.join(tmpProjectDir, 'src', 'server.js'), 'const express = require("express"); const app = express();\n'.repeat(4));
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
  assert.match(stderr, /AI_FOOTPRINT_CERTIFY_ENDPOINT/);
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
    assert.match(stdout, /indicative and NOT reproducible/);
    assert.match(stdout, /Score: \d+\/100/);
    assert.match(stdout, /Sample: \d+\/\d+ files/);
  } finally {
    server.close();
  }
});

test('reporting redesign: a full certify run writes the cumulative report.html and ALWAYS prints its file:// link (no --html needed)', async () => {
  writeReactProject();
  const { server } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    assert.match(stdout, /file:\/\/\S+report-[a-f0-9]{12}\.html/);
    assert.match(stdout, /Open your report|Abre tu informe/);
    const htmlFile = fs.readdirSync(tmpConfigDir).find((f) => /^report-[a-f0-9]{12}\.html$/.test(f));
    assert.ok(htmlFile, 'per-project report-<hash>.html written to the config dir');
    const html = fs.readFileSync(path.join(tmpConfigDir, htmlFile), 'utf8');
    // The certification landed in the cumulative report, in the Shakers theme.
    assert.match(html, /Skill certification/);
    assert.ok(html.includes('--bg:var(--ds-white)'), 'white background');
    assert.equal(/prefers-color-scheme\s*:\s*dark/.test(html), false, 'no dark mode');
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

test('014: 5xx stays a real technical error (generic message + retry), exit 1', async () => {
  writeReactProject();
  const server = await startStatusStub(500);
  try {
    const { code, stdout, stderr } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'a@b.com', '--accept-disclaimer', '--all', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: statusUrl(server) },
    });
    assert.equal(code, 1);
    const out = stdout + stderr;
    assert.match(out, /Could not resolve certifiable Skills/);
    assert.match(out, /HTTP 500/);
    assert.match(out, /try again later/);
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
