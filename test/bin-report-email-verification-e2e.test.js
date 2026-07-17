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
 * skill-code-certification / ADR-006: end-to-end wait-mode verification.
 * bin/report.js calls main() on load (can't be require()d), so the whole flow
 * is exercised as a real process, piping the yes/no + email + OTP code over
 * stdin against the reference-server stub (fixed code 123456).
 *
 * The verification endpoints are DERIVED from AI_FOOTPRINT_INGEST_ENDPOINT
 * (no new env var), so pointing ingest at the stub's
 * `/works/ai-footprint/reports` makes `.../email-verification/request` and
 * `.../verify` resolve to the stub too. The final autoShare POST to the ingest
 * path itself 404s here (the stub mounts ingest at root `/reports`), but that
 * is silent by design and never affects the persisted consent decision.
 *
 * INVARIANT under test (ADR-003/ADR-006, revised by the terminal-state bug
 * fix): the report is shown in BOTH the verified and the not-verified runs
 * (persistence never gates the report). A consent decision is persisted ONLY
 * once terminal — a grant only after email verification SUCCEEDS. An aborted /
 * failed verification persists NOTHING, so the prompt is re-asked next run; a
 * verified grant sticks and is skipped thereafter.
 */

const BIN = path.join(__dirname, '..', 'bin', 'report.js');

function startStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runCli({ stdin, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, '--no-save', '--root', env.__ROOT], {
      env: { ...process.env, AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '', ...env },
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

let server;
let ingestEndpoint;
let tmpConfigDir;
let tmpProjectDir;

test.before(async () => {
  server = await startStub();
  ingestEndpoint = `http://127.0.0.1:${server.address().port}/works/ai-footprint/reports`;
});
test.after(() => server.close());

test.beforeEach(() => {
  tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-verif-config-'));
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-verif-project-'));
});
test.afterEach(() => {
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
});

function readConsent() {
  try {
    return JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
  } catch {
    return null;
  }
}

test('e2e: accept + correct OTP code -> report shown AND consent persisted granted', async () => {
  const { code, stdout } = await runCli({
    stdin: 's\ntalent@example.com\n123456\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: ingestEndpoint, __ROOT: tmpProjectDir },
  });
  assert.equal(code, 0);
  // Report always shown.
  assert.match(stdout, /AI FOOTPRINT/);
  // Wait mode was entered (code sent to the email) and then verified.
  assert.match(stdout, /código de verificación a talent@example\.com|verification code to talent@example\.com/);
  // Persisted only after verification.
  const consent = readConsent();
  assert.equal(consent && consent.consent, 'granted');
  assert.equal(consent.email, 'talent@example.com');
  assert.equal(consent.emailVerified, true);
});

test('e2e: accept but verification cancelled -> report shown, NOTHING persisted (re-asked next run)', async () => {
  const { code, stdout } = await runCli({
    // one wrong code, then EOF -> the next code read resolves '' -> cancel.
    stdin: 's\ntalent@example.com\n000000\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: ingestEndpoint, __ROOT: tmpProjectDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /AI FOOTPRINT/); // report shown regardless
  // An aborted/unverified grant is not a terminal decision: nothing is
  // persisted, so the prompt is re-asked next run.
  assert.equal(readConsent(), null);
});

test('e2e: a second run after a granted decision does NOT re-ask consent/email (skip explained)', async () => {
  // First run: grant + verify.
  await runCli({
    stdin: 's\ntalent@example.com\n123456\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: ingestEndpoint, __ROOT: tmpProjectDir },
  });
  // Second run: no stdin answers at all; must NOT prompt again.
  const { code, stdout } = await runCli({
    stdin: '',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: ingestEndpoint, __ROOT: tmpProjectDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /AI FOOTPRINT/);
  // The consent question is NOT re-asked; the skip is explained instead.
  assert.doesNotMatch(stdout, /Save this report in Shakers|Guardar este informe en Shakers/);
  assert.match(stdout, /already answered|ya respondido/);
});

test('e2e: the pasted OTP code never appears in the CLI output', async () => {
  const { stdout, stderr } = await runCli({
    stdin: 's\ntalent@example.com\n123456\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: ingestEndpoint, __ROOT: tmpProjectDir },
  });
  assert.equal((stdout + stderr).includes('123456'), false);
});
