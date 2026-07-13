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

test('resolve end-to-end against the stub: shows certifiable Skills, exit 0', async () => {
  writeReactProject();
  const { server } = await startStub();
  try {
    const { code, stdout } = await runCli({
      args: ['--root', tmpProjectDir, '--email', 'talent@example.com', '--accept-disclaimer', '--lang', 'en'],
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_CERTIFY_ENDPOINT: certifyUrl(server) },
    });
    assert.equal(code, 0);
    assert.match(stdout, /LEGAL DISCLAIMER/);
    assert.match(stdout, /Certifiable Skills for your project/);
    assert.match(stdout, /React/);
    assert.match(stdout, /Express/); // the stub marks all received techs certifiable
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
