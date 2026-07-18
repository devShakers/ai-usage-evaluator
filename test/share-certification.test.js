'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  deriveCertificationPayload,
  shareCertification,
  isCertifyThrottled,
  recordConsent,
  loadConsentState,
} = require('../src/share');

/*
 * skill-code-certification, issue 005 (ADR-002 "Camino 2" / ADR-011 consent):
 * persist ONLY the analyzed result, ONLY with granted consent, scrubbed,
 * throttled independently from the footprint send. Never throws.
 */

const ITEMS = [
  {
    skillId: 1, skillName: 'React', technology: 'React',
    sampling: { sampleable: true },
    result: { score: 80, rationale: 'uses sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF widely', improvements: ['token AKIAIOSFODNN7EXAMPLE here', 'ok tip'] },
  },
  { skillId: 2, skillName: 'X', technology: 'COBOL', sampling: { sampleable: false }, result: null }, // not analyzed -> excluded
];

let configDir;
test.beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-certify-share-'));
  process.env.AI_FOOTPRINT_CONFIG_DIR = configDir;
});
test.afterEach(() => {
  delete process.env.AI_FOOTPRINT_CONFIG_DIR;
  delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
  fs.rmSync(configDir, { recursive: true, force: true });
});

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// --- deriveCertificationPayload ---------------------------------------------

test('deriveCertificationPayload: whitelists analyzed results only, scrubs prose, no code fields', () => {
  const payload = deriveCertificationPayload(ITEMS, { model: 'claude-sonnet-5' });
  assert.equal(payload.kind, 'skill-code-assessment');
  assert.equal(payload.skillCodeAssessments.length, 1); // the not-analyzed one is dropped
  const a = payload.skillCodeAssessments[0];
  // ADR-017 added authorEmails/perFileBreakdown/sampledFiles — still NO code/content field.
  assert.deepEqual(Object.keys(a).sort(), ['authorEmails', 'improvements', 'model', 'perFileBreakdown', 'rationale', 'sampled', 'sampledFiles', 'score', 'skillId', 'skillName', 'technology']);
  assert.equal(a.rationale.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF'), false);
  assert.equal(a.improvements[0].includes('AKIAIOSFODNN7EXAMPLE'), false);
  assert.equal(a.model, 'claude-sonnet-5');
  assert.equal(a.sampled, true);
  // ADR-017 fields default to safe-empty when the item omits them.
  assert.deepEqual(a.authorEmails, []);
  assert.deepEqual(a.sampledFiles, []);
  assert.deepEqual(a.perFileBreakdown, []);
});

test('deriveCertificationPayload: carries ADR-017 authorship, per-file breakdown, and run-level provenance', () => {
  const items = [
    {
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true },
      authorEmails: [
        { email: 'talent@example.com', matched: true },
        { email: 'other@contrib.com', matched: false },
      ],
      sampledFiles: ['src/a.tsx', 'src/b.tsx'],
      result: {
        score: 80, rationale: 'ok', improvements: ['tip'],
        perFileBreakdown: [
          { path: 'src/a.tsx', score: 90, note: 'reach me at scrub.me@acme.com' },
          { path: 'src/b.tsx', score: 40, note: null },
        ],
      },
    },
  ];
  const payload = deriveCertificationPayload(items, {
    model: 'gemini-2.5-pro', repository: 'github.com/acme/widgets', commitRange: 'abc..def', toolVersion: '0.1.0',
  });
  assert.equal(payload.toolVersion, '0.1.0');
  assert.equal(payload.repository, 'github.com/acme/widgets');
  assert.equal(payload.commitRange, 'abc..def');
  const a = payload.skillCodeAssessments[0];
  assert.deepEqual(a.sampledFiles, ['src/a.tsx', 'src/b.tsx']);
  assert.deepEqual(a.authorEmails, [
    { email: 'talent@example.com', matched: true },
    { email: 'other@contrib.com', matched: false },
  ]);
  assert.equal(a.perFileBreakdown[0].path, 'src/a.tsx');
  assert.equal(a.perFileBreakdown[0].score, 90);
  // note scrubbed client-side (defense in depth).
  assert.equal(a.perFileBreakdown[0].note.includes('scrub.me@acme.com'), false);
  assert.equal(a.perFileBreakdown[1].note, null);
});

// --- consent gating ----------------------------------------------------------

test('shareCertification: no decision -> skipped (no-decision), nothing sent', async () => {
  const out = await shareCertification(ITEMS);
  assert.deepEqual(out, { ok: false, skipped: true, reason: 'no-decision' });
});

test('shareCertification: denied -> skipped (consent-denied)', async () => {
  recordConsent('denied');
  const out = await shareCertification(ITEMS);
  assert.equal(out.reason, 'consent-denied');
});

test('shareCertification: granted but no ingest endpoint -> no-endpoint-configured', async () => {
  recordConsent('granted', 'talent@example.com');
  const out = await shareCertification(ITEMS);
  assert.equal(out.reason, 'no-endpoint-configured');
});

test('shareCertification: granted + endpoint -> posts {email, payload}, sets lastCertifySentAt', async () => {
  recordConsent('granted', 'talent@example.com');
  let received;
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => { received = JSON.parse(raw); res.writeHead(201); res.end('{}'); });
  });
  const { port } = server.address();
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = `http://127.0.0.1:${port}/reports`;
  try {
    const out = await shareCertification(ITEMS, { model: 'claude-sonnet-5' });
    assert.equal(out.ok, true);
    assert.equal(received.email, 'talent@example.com');
    assert.equal(received.payload.kind, 'skill-code-assessment');
    assert.equal(received.payload.skillCodeAssessments[0].skillName, 'React');
    // wire body carries no raw secret
    assert.equal(JSON.stringify(received).includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF'), false);
    assert.ok(loadConsentState().lastCertifySentAt);
  } finally {
    server.close();
  }
});

test('shareCertification: throttled after a recent certify send', async () => {
  recordConsent('granted', 'talent@example.com');
  const state = loadConsentState();
  state.lastCertifySentAt = new Date().toISOString();
  fs.writeFileSync(path.join(configDir, 'consent.json'), JSON.stringify(state));
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const out = await shareCertification(ITEMS);
  assert.equal(out.reason, 'throttled');
});

test('shareCertification: nothing analyzed -> nothing-to-persist (never sends)', async () => {
  recordConsent('granted', 'talent@example.com');
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const out = await shareCertification([{ skillId: 9, skillName: 'X', technology: 'COBOL', sampling: { sampleable: false }, result: null }]);
  assert.equal(out.reason, 'nothing-to-persist');
});

test('isCertifyThrottled uses lastCertifySentAt, independent from footprint lastSentAt', () => {
  assert.equal(isCertifyThrottled({ lastSentAt: new Date().toISOString() }), false); // footprint field ignored
  assert.equal(isCertifyThrottled({ lastCertifySentAt: new Date().toISOString() }), true);
  assert.equal(isCertifyThrottled({ lastCertifySentAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }), false);
});
