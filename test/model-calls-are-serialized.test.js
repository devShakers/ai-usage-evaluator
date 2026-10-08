'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// ISSUE 116: THE THREE MODEL CALLS MUST NOT OVERLAP.

const BIN = path.join(__dirname, '..', 'bin', 'ai-usage.js');
const HOLD_MS = 300;

// A project with agents, so all three calls are attempted (synthesis and
// evaluation both need `report.agents` to be non-empty).
function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-116-'));
  const agents = path.join(dir, '.claude', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  // Name AND definition correspond (AC inherited from issues 114/115: a fixture
  // whose name and definition disagree turns an assertion into its opposite).
  fs.writeFileSync(path.join(agents, 'backend-developer.md'), [
    '---',
    'name: backend-developer',
    'description: Use when implementing API endpoints, database migrations or server-side business logic',
    'model: sonnet',
    'tools:',
    '  - Read',
    '  - Bash',
    '---',
    '',
    'You implement backend features: endpoints, persistence and business logic.',
    'Boundaries: you never touch the UI layer and you never invent a schema.',
  ].join('\n'));
  return dir;
}

function startRecordingServer() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const record = { route, start: Date.now(), end: null };
      calls.push(record);
      // Hold the response open: a parallel caller's intervals would overlap.
      setTimeout(() => {
        record.end = Date.now();
        let body = '{}';
        if (route.endsWith('/agent-synthesis')) {
          body = JSON.stringify({ agents: [{ name: 'backend-developer', symbolicName: 'API Builder', whatItDoes: 'Writes server-side code.' }] });
        } else if (route.endsWith('/agent-evaluation')) {
          body = JSON.stringify({
            evaluations: [{
              name: 'backend-developer',
              rationale: 'Clear scope and boundaries.',
              description: 'Implements server-side features.',
              classification: { catalogId: 'dev-1', category: 'developer', role: 'AI-Assisted Code Writer', level: 'L1', method: 'llm' },
              improvements: [],
            }],
            omittedAgentNames: [],
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      }, HOLD_MS);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, calls }));
  });
}

function seedGrantedConsent(configDir, email = 'talent@example.com') {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'consent.json'),
    JSON.stringify({ consent: 'granted', email, emailVerified: true, lastSentAt: null }),
  );
}

function runCli({ root, ingest, configDir }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, '--root', root], {
      env: {
        ...process.env,
        AI_FOOTPRINT_CONFIG_DIR: configDir,
        AI_FOOTPRINT_INGEST_ENDPOINT: ingest,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.stdin.end('');
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Any pair of intervals that share a millisecond of wall time.
function overlappingPairs(calls) {
  const pairs = [];
  for (let i = 0; i < calls.length; i++) {
    for (let j = i + 1; j < calls.length; j++) {
      const a = calls[i];
      const b = calls[j];
      if (a.end === null || b.end === null) continue;
      if (a.start < b.end && b.start < a.end) pairs.push([a.route, b.route]);
    }
  }
  return pairs;
}

test('the three model calls never overlap on the wire (issue 116: no Promise.all)', async () => {
  const { server, calls } = await startRecordingServer();
  const root = makeProject();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-116-cfg-'));
  seedGrantedConsent(configDir);
  try {
    const ingest = `http://127.0.0.1:${server.address().port}/ai-footprint/reports`;
    const { code } = await runCli({ root, ingest, configDir });
    assert.equal(code, 0);

    const modelRoutes = calls.filter((r) => !r.route.endsWith('/reports'));
    // NOT VACUOUS: if no model call went out, "nothing overlapped" is trivially
    // true and would pass against a parallel implementation too.
    assert.ok(modelRoutes.length >= 2, `expected at least 2 model calls, got ${modelRoutes.length}: ${modelRoutes.map((r) => r.route).join(', ')}`);

    const overlaps = overlappingPairs(modelRoutes);
    assert.deepEqual(overlaps, [], `these model calls were in flight at the same time: ${JSON.stringify(overlaps)}`);
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

test('CONTROL: the recording server DOES detect overlap when calls are concurrent', async () => {
  // Guards the detector itself. Without this, an `overlappingPairs` that can
  // never return anything would make the test above green forever.
  const { server, calls } = await startRecordingServer();
  try {
    const base = `http://127.0.0.1:${server.address().port}/ai-footprint`;
    const hit = (route) => new Promise((resolve) => {
      const req = http.request(`${base}/${route}`, { method: 'POST' }, (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      });
      req.end('{}');
    });
    await Promise.all([hit('agent-synthesis'), hit('agent-evaluation')]);
    assert.equal(calls.length, 2);
    assert.equal(overlappingPairs(calls).length, 1);
  } finally {
    server.close();
  }
});

test('the total wall time is the SUM of the calls, which is what serializing costs', async () => {
  // The tradeoff, pinned as a number rather than left as prose: three held
  // responses of HOLD_MS each cannot complete in less than their sum.
  const { server, calls } = await startRecordingServer();
  const root = makeProject();
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-116-cfg-'));
  seedGrantedConsent(configDir);
  try {
    const ingest = `http://127.0.0.1:${server.address().port}/ai-footprint/reports`;
    await runCli({ root, ingest, configDir });
    const modelRoutes = calls.filter((r) => !r.route.endsWith('/reports') && r.end !== null);
    assert.ok(modelRoutes.length >= 2);
    const first = Math.min(...modelRoutes.map((r) => r.start));
    const last = Math.max(...modelRoutes.map((r) => r.end));
    assert.ok(
      last - first >= HOLD_MS * modelRoutes.length,
      `model phase took ${last - first}ms for ${modelRoutes.length} calls held ${HOLD_MS}ms each — that is less than the sum, so they overlapped`,
    );
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
