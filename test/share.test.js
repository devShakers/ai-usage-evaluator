'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  requestJson,
  loadConsentState,
  saveConsentState,
  getConsentDecision,
  recordConsent,
  isValidEmail,
  normalizeEmail,
  isThrottled,
  derivePayload,
  autoShare,
  consentPath,
  SEND_THROTTLE_MS,
} = require('../src/share');

/*
 * talents-ai-score / ADR-007: retires the token/enrollment model in favor
 * of per-run opt-in consent + self-affirmed email identity. Covers:
 *   - consent state persistence (granted/denied/no-decision, three states)
 *   - email validation/normalization
 *   - throttle (unchanged invariant, ADR-005/006/007 all keep it)
 *   - derivePayload whitelist (unchanged: email travels OUTSIDE the payload)
 *   - autoShare: every skip/success/failure branch, using a real ephemeral
 *     local HTTP server (zero mocks, zero dependencies) to assert no
 *     Authorization header is ever sent (no more Bearer tokens)
 *   - endpoint resolution comes from config (AI_FOOTPRINT_INGEST_ENDPOINT),
 *     never hardcoded; unset -> silent no-op
 */

// --- isolation helpers -----------------------------------------------------
// Every test gets its own throwaway config dir (AI_FOOTPRINT_CONFIG_DIR),
// so nothing ever touches the real developer machine's
// ~/.config/ai-footprint/consent.json.

let originalConfigDir;
let originalEndpoint;
let tmpDir;

test.beforeEach(() => {
  originalConfigDir = process.env.AI_FOOTPRINT_CONFIG_DIR;
  originalEndpoint = process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-test-'));
  process.env.AI_FOOTPRINT_CONFIG_DIR = tmpDir;
  delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
});

test.afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR;
  else process.env.AI_FOOTPRINT_CONFIG_DIR = originalConfigDir;
  if (originalEndpoint === undefined) delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
  else process.env.AI_FOOTPRINT_INGEST_ENDPOINT = originalEndpoint;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function serverUrl(server, pathname = '/reports') {
  const { port } = server.address();
  return `http://127.0.0.1:${port}${pathname}`;
}

const REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-08T00:00:00.000Z',
  anonId: 'anon123',
  platform: 'darwin',
  summary: { totalDetected: 2, categories: ['AGENTIC_CLI'] },
  tools: [{ id: 'claude-code', detected: true, depth: { rules: 1 } }],
};
const MATURITY = { level: 3, name: 'Power user', score: 70 };

// --- email -----------------------------------------------------------------

test('isValidEmail: accepts well-formed addresses', () => {
  assert.equal(isValidEmail('talent@example.com'), true);
  assert.equal(isValidEmail('  talent@example.com  '), true);
});

test('isValidEmail: rejects malformed input', () => {
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('missing@domain'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
});

test('normalizeEmail: trims and lowercases', () => {
  assert.equal(normalizeEmail('  Talent@Example.COM  '), 'talent@example.com');
});

// --- consent state (granted / denied / no-decision) -------------------------

test('loadConsentState: null when no file persisted yet (no-decision)', () => {
  assert.equal(loadConsentState(), null);
  assert.equal(getConsentDecision(loadConsentState()), null);
});

test('recordConsent: granted persists consent + normalized email', () => {
  const state = recordConsent('granted', '  Talent@Example.com  ');
  assert.equal(state.consent, 'granted');
  assert.equal(state.email, 'talent@example.com');
  assert.equal(fs.existsSync(consentPath()), true);
  assert.equal(getConsentDecision(loadConsentState()), 'granted');
});

test('recordConsent: denied persists consent without requiring an email', () => {
  const state = recordConsent('denied');
  assert.equal(state.consent, 'denied');
  assert.equal(getConsentDecision(loadConsentState()), 'denied');
});

test('recordConsent: granted without a valid email throws (never persists a half-decision)', () => {
  assert.throws(() => recordConsent('granted', 'not-an-email'));
  assert.throws(() => recordConsent('granted'));
  assert.equal(loadConsentState(), null);
});

test('recordConsent: consent file permissions are restricted (600)', () => {
  recordConsent('denied');
  const mode = fs.statSync(consentPath()).mode & 0o777;
  // Windows doesn't honor chmod; only assert strictly on POSIX.
  if (process.platform !== 'win32') assert.equal(mode, 0o600);
});

// --- throttle ----------------------------------------------------------------

test('isThrottled: false with no lastSentAt', () => {
  assert.equal(isThrottled({}), false);
  assert.equal(isThrottled(null), false);
});

test('isThrottled: true within the window, false after it', () => {
  const now = Date.now();
  const recent = { lastSentAt: new Date(now - 1000).toISOString() };
  const old = { lastSentAt: new Date(now - SEND_THROTTLE_MS - 1000).toISOString() };
  assert.equal(isThrottled(recent, now), true);
  assert.equal(isThrottled(old, now), false);
});

// --- derivePayload whitelist (unchanged invariant) ---------------------------

test('derivePayload: whitelist, email is never part of the payload', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.deepEqual(Object.keys(payload).sort(), [
    'anonId', 'categories', 'generatedAt', 'level', 'levelName',
    'platform', 'schemaVersion', 'score', 'tools', 'totalDetected',
    'agents', 'agentCounts',
  ].sort());
  assert.equal('email' in payload, false);
});

// --- agent org chart (talents-ai-score, ADR-009) -----------------------------

test('derivePayload: includes the agent org chart with the exact shape {name, tools[], model, parent}', () => {
  const reportWithAgents = {
    ...REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read', 'Bash'], model: 'sonnet', parent: null }],
    agentCounts: { agents: 1, skills: 2, commands: 3, mcpServers: 1, hooks: 0 },
  };
  const payload = derivePayload(reportWithAgents, MATURITY);
  assert.deepEqual(payload.agents, [
    { name: 'backend-developer', tools: ['Read', 'Bash'], model: 'sonnet', parent: null },
  ]);
  assert.deepEqual(payload.agentCounts, { agents: 1, skills: 2, commands: 3, mcpServers: 1, hooks: 0 });
});

test('derivePayload: never leaks extra agent fields (e.g. a description slipped onto the object) — re-applies the whitelist per agent', () => {
  const reportWithLeakyAgent = {
    ...REPORT,
    agents: [{
      name: 'leaky-agent',
      tools: ['Read'],
      model: 'sonnet',
      parent: null,
      description: 'this must never leave the machine',
    }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  };
  const payload = derivePayload(reportWithLeakyAgent, MATURITY);
  assert.deepEqual(Object.keys(payload.agents[0]).sort(), ['model', 'name', 'parent', 'tools'].sort());
  assert.equal(JSON.stringify(payload).includes('this must never leave the machine'), false);
});

test('derivePayload: missing agents/agentCounts (report predating ADR-009) defaults gracefully, never throws', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.deepEqual(payload.agents, []);
  assert.deepEqual(payload.agentCounts, { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 });
});

// --- requestJson: no Authorization header (ADR-007 retires Bearer) ----------

test('requestJson: sends no Authorization header, body is exactly what is passed', async () => {
  let receivedHeaders;
  let receivedBody;
  const server = await startServer((req, res) => {
    receivedHeaders = req.headers;
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    const res = await requestJson('POST', serverUrl(server), { body: { email: 'a@b.com', payload: { x: 1 } } });
    assert.equal(res.status, 201);
    assert.equal('authorization' in receivedHeaders, false);
    assert.deepEqual(receivedBody, { email: 'a@b.com', payload: { x: 1 } });
  } finally {
    server.close();
  }
});

// --- autoShare: skip reasons --------------------------------------------------

test('autoShare: no decision persisted -> skipped, reason no-decision, nothing sent', async () => {
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'no-decision');
});

test('autoShare: consent denied -> skipped, reason consent-denied', async () => {
  recordConsent('denied');
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'consent-denied');
});

test('autoShare: granted but no endpoint configured -> skipped, reason no-endpoint-configured', async () => {
  recordConsent('granted', 'talent@example.com');
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'no-endpoint-configured');
});

test('autoShare: granted + throttled (recent lastSentAt) -> skipped, reason throttled', async () => {
  recordConsent('granted', 'talent@example.com');
  const state = loadConsentState();
  state.lastSentAt = new Date().toISOString();
  saveConsentState(state);
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'throttled');
});

test('autoShare: granted + network error -> resiliently fails, never throws, local report unaffected', async () => {
  recordConsent('granted', 'talent@example.com');
  // Port 1 is a privileged/closed port: connection refused immediately.
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, false);
  assert.equal(r.reason, 'network-error');
});

test('autoShare: granted + happy path -> sends {email, payload}, persists lastSentAt', async () => {
  let receivedBody;
  let receivedHeaders;
  const server = await startServer((req, res) => {
    receivedHeaders = req.headers;
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);

    const r = await autoShare(REPORT, MATURITY);

    assert.equal(r.ok, true);
    assert.equal('authorization' in receivedHeaders, false);
    assert.equal(receivedBody.email, 'talent@example.com');
    assert.deepEqual(receivedBody.payload, derivePayload(REPORT, MATURITY));

    const persisted = loadConsentState();
    assert.ok(persisted.lastSentAt);
  } finally {
    server.close();
  }
});

test('autoShare: server 429 -> rate-limited, does not update lastSentAt', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate limit' }));
    });
  });
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);
    const r = await autoShare(REPORT, MATURITY);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'rate-limited');
    assert.equal(loadConsentState().lastSentAt, null);
  } finally {
    server.close();
  }
});

test('autoShare: server 503 (kill switch off) -> service-unavailable, resolves without throwing', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ingest disabled' }));
    });
  });
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);
    const r = await autoShare(REPORT, MATURITY);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'service-unavailable');
  } finally {
    server.close();
  }
});
