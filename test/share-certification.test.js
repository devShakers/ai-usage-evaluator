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

const ITEMS = [
  {
    skillId: 1, skillName: 'React', technology: 'React',
    sampling: { sampleable: true },
    result: { score: 80, rationale: 'uses sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF widely', improvements: ['token AKIAIOSFODNN7EXAMPLE here', 'ok tip'], model: 'gemini-2.5-pro' },
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
  const payload = deriveCertificationPayload(ITEMS);
  assert.equal(payload.kind, 'skill-code-assessment');
  assert.equal(payload.skillCodeAssessments.length, 1); // the not-analyzed one is dropped
  const a = payload.skillCodeAssessments[0];
  // ADR-017 added authorEmails/perFileBreakdown/sampledFiles; ADR-024 added
  // dimensionScores — still NO code/content field.
  assert.deepEqual(Object.keys(a).sort(), ['authorEmails', 'dimensionScores', 'improvements', 'model', 'perFileBreakdown', 'rationale', 'sampled', 'sampledFiles', 'score', 'skillId', 'skillName', 'technology']);
  assert.equal(a.rationale.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF'), false);
  assert.equal(a.improvements[0].includes('AKIAIOSFODNN7EXAMPLE'), false);
  // talents-ai-score, ADR-022: `model` is PER-skillId, sourced from THIS
  // item's own result — no batch-wide stamp exists anymore.
  assert.equal(a.model, 'gemini-2.5-pro');
  assert.equal(a.sampled, true);
  // ADR-017 fields default to safe-empty when the item omits them.
  assert.deepEqual(a.authorEmails, []);
  assert.deepEqual(a.sampledFiles, []);
  assert.deepEqual(a.perFileBreakdown, []);
});

test('deriveCertificationPayload: pairs `model` per skillId, never a single batch-wide value', () => {
  const items = [
    { skillId: 1, skillName: 'React', technology: 'React', sampling: { sampleable: true }, result: { score: 80, rationale: 'ok', improvements: [], model: 'gemini-2.5-pro' } },
    { skillId: 2, skillName: 'NestJS', technology: 'NestJS', sampling: { sampleable: true }, result: { score: 70, rationale: 'ok', improvements: [], model: 'gpt-4o-mini' } },
  ];
  const payload = deriveCertificationPayload(items);
  const byId = new Map(payload.skillCodeAssessments.map((a) => [a.skillId, a.model]));
  assert.equal(byId.get(1), 'gemini-2.5-pro');
  assert.equal(byId.get(2), 'gpt-4o-mini'); // different provider hop for a different Skill in the SAME batch
});

test('deriveCertificationPayload: a result with no `model` -> null, NEVER guessed/defaulted', () => {
  const items = [
    { skillId: 1, skillName: 'React', technology: 'React', sampling: { sampleable: true }, result: { score: 80, rationale: 'ok', improvements: [] } }, // no model field at all (e.g. hub fallback)
    { skillId: 2, skillName: 'NestJS', technology: 'NestJS', sampling: { sampleable: true }, result: { score: 70, rationale: 'ok', improvements: [], model: '' } }, // empty string -> also null
  ];
  const payload = deriveCertificationPayload(items);
  assert.equal(payload.skillCodeAssessments[0].model, null);
  assert.equal(payload.skillCodeAssessments[1].model, null);
});

// talents-ai-score, ADR-049 / issue 128: the attested combined level is bound by putting the interview verdict's evidence token into the OPTIONAL `interviewEvidenceToken` field.
test('deriveCertificationPayload: interviewEvidenceToken is present ONLY when the item carries one', () => {
  const none = deriveCertificationPayload(ITEMS).skillCodeAssessments[0];
  assert.equal(Object.prototype.hasOwnProperty.call(none, 'interviewEvidenceToken'), false);

  const withTok = deriveCertificationPayload([{ ...ITEMS[0], interviewEvidenceToken: 'ev_abc123' }]).skillCodeAssessments[0];
  assert.equal(withTok.interviewEvidenceToken, 'ev_abc123');
});

test('deriveCertificationPayload: interviewEvidenceToken caps at 4096 and drops empty/non-string', () => {
  const long = deriveCertificationPayload([{ ...ITEMS[0], interviewEvidenceToken: 'x'.repeat(5000) }]).skillCodeAssessments[0];
  assert.equal(long.interviewEvidenceToken.length, 4096);

  for (const bad of ['', null, 123, {}]) {
    const a = deriveCertificationPayload([{ ...ITEMS[0], interviewEvidenceToken: bad }]).skillCodeAssessments[0];
    assert.equal(Object.prototype.hasOwnProperty.call(a, 'interviewEvidenceToken'), false);
  }
});

test('deriveCertificationPayload: evidenceToken is round-tripped from result.evidenceToken, present ONLY when CERTIFY returned one', () => {
  // Code-only, no interview: absent when the result carries no token.
  const none = deriveCertificationPayload(ITEMS).skillCodeAssessments[0];
  assert.equal(Object.prototype.hasOwnProperty.call(none, 'evidenceToken'), false);

  // A real `certify skills` result carries `evidenceToken` on the item's result
  // (what `normalizeCertifyResponse` now captures) -> it reaches the ingest.
  const withTok = deriveCertificationPayload([
    { ...ITEMS[0], result: { ...ITEMS[0].result, evidenceToken: 'ev_certify_9c2b' } },
  ]).skillCodeAssessments[0];
  assert.equal(withTok.evidenceToken, 'ev_certify_9c2b');

  // Independent of the interview token: both present when both exist.
  const both = deriveCertificationPayload([
    { ...ITEMS[0], result: { ...ITEMS[0].result, evidenceToken: 'ev_certify_9c2b' }, interviewEvidenceToken: 'ev_iv_1' },
  ]).skillCodeAssessments[0];
  assert.equal(both.evidenceToken, 'ev_certify_9c2b');
  assert.equal(both.interviewEvidenceToken, 'ev_iv_1');
});

test('deriveCertificationPayload: evidenceToken caps at 4096 and drops empty/non-string', () => {
  const long = deriveCertificationPayload([
    { ...ITEMS[0], result: { ...ITEMS[0].result, evidenceToken: 'x'.repeat(5000) } },
  ]).skillCodeAssessments[0];
  assert.equal(long.evidenceToken.length, 4096);

  for (const bad of ['', null, 123, {}]) {
    const a = deriveCertificationPayload([
      { ...ITEMS[0], result: { ...ITEMS[0].result, evidenceToken: bad } },
    ]).skillCodeAssessments[0];
    assert.equal(Object.prototype.hasOwnProperty.call(a, 'evidenceToken'), false);
  }
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
        score: 80, rationale: 'ok', improvements: ['tip'], model: 'gemini-2.5-pro',
        perFileBreakdown: [
          { path: 'src/a.tsx', score: 90, note: 'reach me at scrub.me@acme.com' },
          { path: 'src/b.tsx', score: 40, note: null },
        ],
      },
    },
  ];
  const payload = deriveCertificationPayload(items, {
    repository: 'github.com/acme/widgets', commitRange: 'abc..def', toolVersion: '0.1.0',
  });
  assert.equal(payload.toolVersion, '0.1.0');
  assert.equal(payload.repository, 'github.com/acme/widgets');
  assert.equal(payload.commitRange, 'abc..def');
  const a = payload.skillCodeAssessments[0];
  assert.equal(a.model, 'gemini-2.5-pro');
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
    const out = await shareCertification(ITEMS);
    assert.equal(out.ok, true);
    assert.equal(received.email, 'talent@example.com');
    assert.equal(received.payload.kind, 'skill-code-assessment');
    assert.equal(received.payload.skillCodeAssessments[0].skillName, 'React');
    // talents-ai-score, ADR-022: the model sent over the wire is the one the
    // ITEM's own CERTIFY result carried, not a caller-supplied stamp.
    assert.equal(received.payload.skillCodeAssessments[0].model, 'gemini-2.5-pro');
    // wire body carries no raw secret
    assert.equal(JSON.stringify(received).includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF'), false);
    assert.ok(loadConsentState().lastCertifySentAt);
  } finally {
    server.close();
  }
});

// ADR-042: this used to assert the SAME key reached the primary AND the fallback attempt of one submission (ADR-021's split-persistence risk).
test('shareCertification: sends an Idempotency-Key header on the single backend attempt', async () => {
  recordConsent('granted', 'talent@example.com');
  const seenKeys = [];
  const server = await startServer((req, res) => {
    seenKeys.push(req.headers['idempotency-key']);
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{}'); });
  });
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = `http://127.0.0.1:${server.address().port}/reports`;
  try {
    const out = await shareCertification(ITEMS);
    assert.equal(out.ok, true);
    assert.equal(out.backend, 'primary');
    assert.equal(seenKeys.length, 1, 'exactly one attempt, so exactly one key');
    assert.ok(seenKeys[0], 'a key must be sent');
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
