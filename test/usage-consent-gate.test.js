'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'ai-usage.js');

function startRecordingServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url.split('?')[0]);
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      if (req.url.includes('agent-synthesis')) {
        body = { agents: [] };
      } else if (req.url.includes('agent-evaluation')) {
        body = { evaluations: [], omittedAgentNames: [] };
      } else if (req.url.includes('roadmap')) {
        try {
          const parsed = JSON.parse(raw || '{}');
          const curated = parsed.curated || { steps: [], tips: [], mistakes: [] };
          body = {
            whatUnlocks: 'stub unlocks',
            steps: curated.steps || [],
            tips: curated.tips || [],
            mistakes: curated.mistakes || [],
          };
        } catch {
          body = { whatUnlocks: 'stub', steps: [], tips: [], mistakes: [] };
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls })));
}

function makeProjectWithAgent(dir) {
  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'agents', 'backend-developer.md'), [
    '---',
    'name: backend-developer',
    'description: Implements backend features end to end.',
    'model: sonnet',
    '---',
    '',
    'You implement backend features.',
  ].join('\n'));
}

function seedGrantedConsent(configDir, email = 'talent@example.com') {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'consent.json'),
    JSON.stringify({ consent: 'granted', email, emailVerified: true, lastSentAt: null }),
  );
}

function runCli({ args = [], stdin = '', env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

let tmpConfigDir;
let tmpProjectDir;
let tmpHomeDir;

test.beforeEach(() => {
  tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-consent-gate-cfg-'));
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-consent-gate-proj-'));
  tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-consent-gate-home-'));
  makeProjectWithAgent(tmpProjectDir);
});
test.afterEach(() => {
  for (const d of [tmpConfigDir, tmpProjectDir, tmpHomeDir]) fs.rmSync(d, { recursive: true, force: true });
});

test('usage: declining consent -> ZERO requests reach agent-synthesis, agent-evaluation OR roadmap-personalization, but the local report still shows', async () => {
  const { server, calls } = await startRecordingServer();
  try {
    const { port } = server.address();
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir],
      stdin: 'n\n', // declines the up-front gate
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_SYNTHESIS_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/agent-synthesis`,
        AI_FOOTPRINT_AGENT_EVAL_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/agent-evaluation`,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/roadmap`,
      },
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [], `expected zero AI/egress calls after declining, got: ${calls.join(', ')}`);
    // ADR-011, restored: the local report (no egress) is shown regardless of
    // the AI-consent decision — declining never blocks it (reverts 8867450).
    assert.match(stdout, /SHAKERS/, 'the local report is shown even after declining AI/egress consent');
  } finally {
    server.close();
  }
});

test('usage: no way to obtain consent (non-interactive, no persisted decision, no --accept flag) -> ZERO requests either, local report still shows', async () => {
  const { server, calls } = await startRecordingServer();
  try {
    const { port } = server.address();
    // Empty stdin: no answer arrives at all (EOF) -> `notObtained`, not granted.
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir],
      stdin: '',
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_SYNTHESIS_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/agent-synthesis`,
        AI_FOOTPRINT_AGENT_EVAL_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/agent-evaluation`,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/roadmap`,
      },
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [], `expected zero AI/egress calls with no consent obtained, got: ${calls.join(', ')}`);
    assert.match(stdout, /SHAKERS/, 'the local report is shown even with no consent obtainable');
  } finally {
    server.close();
  }
});

test('usage: a PRIOR denied decision -> local report still shows this run, AI/egress omitted, never re-asked (no wall)', async () => {
  const { server, calls } = await startRecordingServer();
  try {
    const { port } = server.address();
    fs.mkdirSync(tmpConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpConfigDir, 'consent.json'),
      JSON.stringify({ consent: 'denied', email: null, emailVerified: false, lastSentAt: null }),
    );
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir],
      stdin: '', // must not be asked again — a prompt reading this would hang otherwise
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_SYNTHESIS_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/agent-synthesis`,
        AI_FOOTPRINT_AGENT_EVAL_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/agent-evaluation`,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/roadmap`,
      },
    });
    assert.equal(code, 0);
    assert.deepEqual(calls, [], `expected zero AI/egress calls with a prior denied decision, got: ${calls.join(', ')}`);
    assert.match(stdout, /SHAKERS/, 'a prior denied decision never blocks the local report (no wall)');
  } finally {
    server.close();
  }
});

test('usage: CONTROL — with consent GRANTED, the calls DO reach the server exactly as before (agent-synthesis + agent-evaluation at least)', async () => {
  const { server, calls } = await startRecordingServer();
  try {
    const { port } = server.address();
    seedGrantedConsent(tmpConfigDir);
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir],
      stdin: '',
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_SYNTHESIS_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/agent-synthesis`,
        AI_FOOTPRINT_AGENT_EVAL_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/agent-evaluation`,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/roadmap`,
      },
    });
    assert.equal(code, 0);
    assert.match(stdout, /SHAKERS/, 'the report shows once consent is granted');
    assert.ok(calls.some((u) => u.includes('agent-synthesis')), `expected an agent-synthesis call, got: ${calls.join(', ')}`);
    assert.ok(calls.some((u) => u.includes('agent-evaluation')), `expected an agent-evaluation call, got: ${calls.join(', ')}`);
  } finally {
    server.close();
  }
});
