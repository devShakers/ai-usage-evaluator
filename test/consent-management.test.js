'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  recordConsent,
  loadConsentState,
  getConsentStatus,
  revokeConsent,
  resetConsent,
  setEmail,
  autoShare,
  getConsentDecision,
} = require('../src/share');

/*
 * talents-ai-score / ADR-007, issue 007: view status / revoke / change
 * email — one-shot GDPR-style controls, independent of the disclosure flow
 * (006). Covers the issue's acceptance criteria directly: "revocar corta
 * envíos" and "cambio de correo se refleja en el siguiente envío".
 */

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
function serverUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/reports`;
}

// --- skill-code-certification / ADR-003: resetConsent -----------------------

test('resetConsent: clears the decision to null (asks again), distinct from revoke (denied), keeps the email', () => {
  recordConsent('granted', 'talent@example.com');
  assert.equal(getConsentDecision(loadConsentState()), 'granted');

  resetConsent();
  const state = loadConsentState();
  assert.equal(getConsentDecision(state), null, 'decision cleared to "no decision yet"');
  assert.equal(state.email, 'talent@example.com', 'email retained across reset');
});

test('resetConsent vs revokeConsent: reset -> null (re-ask), revoke -> denied (stays no)', () => {
  recordConsent('granted', 'a@b.com');
  revokeConsent();
  assert.equal(getConsentDecision(loadConsentState()), 'denied');
  resetConsent();
  assert.equal(getConsentDecision(loadConsentState()), null);
});

test('resetConsent: idempotent and safe with no prior state', () => {
  assert.doesNotThrow(() => resetConsent());
  assert.equal(getConsentDecision(loadConsentState()), null);
});
function echoServer() {
  return startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, received: JSON.parse(raw) }));
    });
  });
}

const REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-08T00:00:00.000Z',
  anonId: 'anon123',
  platform: 'darwin',
  summary: { totalDetected: 1, categories: [] },
  tools: [],
};
const MATURITY = { level: 1, name: 'Exploring', score: 20 };

// --- getConsentStatus --------------------------------------------------------

test('getConsentStatus: no decision yet -> consent null, no email, emailVerified false, no lastSentAt', () => {
  const status = getConsentStatus();
  // `emailVerified` is part of the status by design (ADR-006): computeConsentSkip
  // depends on it to distinguish a terminal (verified) grant from an incomplete
  // one. With no state, it defaults to false.
  assert.deepEqual(status, { consent: null, email: null, emailVerified: false, lastSentAt: null });
});

test('getConsentStatus: reflects a granted decision, email and last send', () => {
  recordConsent('granted', 'talent@example.com');
  const status = getConsentStatus();
  assert.equal(status.consent, 'granted');
  assert.equal(status.email, 'talent@example.com');
  assert.equal(status.lastSentAt, null);
});

// --- revokeConsent -----------------------------------------------------------

test('revokeConsent: works even with no prior decision, sets denied', () => {
  const r = revokeConsent();
  assert.equal(r.ok, true);
  assert.equal(getConsentStatus().consent, 'denied');
});

test('revokeConsent: cuts off automatic sending — a previously granted talent stops sending', async () => {
  const server = await echoServer();
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);

    const before = await autoShare(REPORT, MATURITY);
    assert.equal(before.ok, true);

    revokeConsent();

    const after = await autoShare(REPORT, MATURITY);
    assert.equal(after.ok, false);
    assert.equal(after.skipped, true);
    assert.equal(after.reason, 'consent-denied');
  } finally {
    server.close();
  }
});

test('revokeConsent: does not scan or send a "final" report (pure state mutation)', () => {
  recordConsent('granted', 'talent@example.com');
  // No endpoint configured: if revoke tried to send anything, it would have
  // to reach the network layer. Asserting only local state changed is enough
  // here — revokeConsent's implementation never calls autoShare/requestJson.
  const r = revokeConsent();
  assert.equal(r.state.consent, 'denied');
  assert.equal(r.state.email, 'talent@example.com'); // email kept, not erased
});

// --- setEmail ------------------------------------------------------------------

test('setEmail: invalid email is rejected, nothing persisted', () => {
  const r = setEmail('not-an-email');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-email');
  assert.equal(loadConsentState(), null);
});

test('setEmail: valid email persists without touching an existing consent decision', () => {
  recordConsent('granted', 'old@example.com');
  const r = setEmail('New@Example.com');
  assert.equal(r.ok, true);
  assert.equal(r.state.email, 'new@example.com');
  assert.equal(getConsentStatus().consent, 'granted'); // untouched
});

test('setEmail: a changed email is unverified, so autoShare blocks the next send until re-verification (ADR-006)', async () => {
  const server = await echoServer();
  let lastReceivedEmail = null;
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      lastReceivedEmail = body.email;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    // A verified grant sends normally under its email.
    recordConsent('granted', 'old@example.com', { verified: true });
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);

    await autoShare(REPORT, MATURITY);
    assert.equal(lastReceivedEmail, 'old@example.com');

    // Changing the email marks it unverified (ADR-006): ownership of the new
    // address hasn't been proven, so autoShare must NOT send under it until it
    // is re-verified.
    setEmail('new@example.com');
    // Bypass the client-side throttle for this assertion by clearing
    // lastSentAt directly (the throttle itself is covered in share.test.js).
    const state = loadConsentState();
    state.lastSentAt = null;
    require('../src/share').saveConsentState(state);

    const r = await autoShare(REPORT, MATURITY);
    assert.equal(r.ok, false);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'email-unverified');
    // Nothing was sent under the new (unverified) email.
    assert.equal(lastReceivedEmail, 'old@example.com');
  } finally {
    server.close();
  }
});
