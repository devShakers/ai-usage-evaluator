'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getCertifyEndpoint,
  getEmailVerificationRequestUrl,
  getEmailVerificationVerifyUrl,
} = require('../src/config');

/*
 * talents-ai-score, ADR-010/011: the agent-synthesis endpoint follows the
 * exact same no-hardcode, no-default, env-var-only pattern as the existing
 * ingestion endpoint (getIngestEndpoint) — unset means "nothing configured",
 * never a compiled-in fallback, never a kill-switch flag (ADR-011 retires
 * flags entirely).
 */

test('getSynthesisEndpoint: unset env var -> null', () => {
  assert.equal(getSynthesisEndpoint({}), null);
});

test('getSynthesisEndpoint: reads AI_FOOTPRINT_SYNTHESIS_ENDPOINT, trimmed', () => {
  const env = { AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '  https://hub.example.com/works/ai-footprint/agent-synthesis  ' };
  assert.equal(getSynthesisEndpoint(env), 'https://hub.example.com/works/ai-footprint/agent-synthesis');
});

test('getSynthesisEndpoint: empty/whitespace-only value -> null', () => {
  assert.equal(getSynthesisEndpoint({ AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '' }), null);
  assert.equal(getSynthesisEndpoint({ AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '   ' }), null);
});

// talents-ai-score, ADR-015: roadmap personalization endpoint, same
// no-hardcode/no-default/env-var-only pattern.

test('getRoadmapEndpoint: unset env var -> null', () => {
  assert.equal(getRoadmapEndpoint({}), null);
});

test('getRoadmapEndpoint: reads AI_FOOTPRINT_ROADMAP_ENDPOINT, trimmed', () => {
  const env = { AI_FOOTPRINT_ROADMAP_ENDPOINT: '  https://hub.example.com/works/ai-footprint/roadmap  ' };
  assert.equal(getRoadmapEndpoint(env), 'https://hub.example.com/works/ai-footprint/roadmap');
});

test('getRoadmapEndpoint: empty/whitespace-only value -> null', () => {
  assert.equal(getRoadmapEndpoint({ AI_FOOTPRINT_ROADMAP_ENDPOINT: '' }), null);
  assert.equal(getRoadmapEndpoint({ AI_FOOTPRINT_ROADMAP_ENDPOINT: '   ' }), null);
});

// skill-code-certification, ADR-001: certify endpoint, same no-hardcode/
// no-default/env-var-only pattern. The DIFFERENCE is in how the caller
// treats null (actionable error vs silent degrade) — that lives in
// bin/certify.js, not here; this getter is a plain reader like the rest.

test('getCertifyEndpoint: unset env var -> null', () => {
  assert.equal(getCertifyEndpoint({}), null);
});

test('getCertifyEndpoint: reads AI_FOOTPRINT_CERTIFY_ENDPOINT, trimmed', () => {
  const env = { AI_FOOTPRINT_CERTIFY_ENDPOINT: '  https://hub.example.com/works/ai-footprint/skill-certification  ' };
  assert.equal(getCertifyEndpoint(env), 'https://hub.example.com/works/ai-footprint/skill-certification');
});

test('getCertifyEndpoint: empty/whitespace-only value -> null', () => {
  assert.equal(getCertifyEndpoint({ AI_FOOTPRINT_CERTIFY_ENDPOINT: '' }), null);
  assert.equal(getCertifyEndpoint({ AI_FOOTPRINT_CERTIFY_ENDPOINT: '   ' }), null);
});

// skill-code-certification / ADR-006: the email-verification URLs introduce NO
// new env var — they are DERIVED as siblings of the ingest endpoint (email
// verification gates persistence, which targets the ingest URL; in the Hub
// both live in the same ai-footprint module).

test('getEmailVerification*Url: unset ingest env var -> null (nowhere to persist, nothing to verify for)', () => {
  assert.equal(getEmailVerificationRequestUrl({}), null);
  assert.equal(getEmailVerificationVerifyUrl({}), null);
});

test('getEmailVerification*Url: derives siblings of the ingest endpoint (last path segment replaced)', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/works/ai-footprint/reports' };
  assert.equal(
    getEmailVerificationRequestUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/request',
  );
  assert.equal(
    getEmailVerificationVerifyUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/verify',
  );
});

test('getEmailVerification*Url: robust to a trailing slash on the ingest endpoint', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: 'https://hub.example.com/works/ai-footprint/reports/' };
  assert.equal(
    getEmailVerificationRequestUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/request',
  );
  assert.equal(
    getEmailVerificationVerifyUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/verify',
  );
});

test('getEmailVerification*Url: trims surrounding whitespace like the other getters', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: '  https://hub.example.com/works/ai-footprint/reports  ' };
  assert.equal(
    getEmailVerificationRequestUrl(env),
    'https://hub.example.com/works/ai-footprint/email-verification/request',
  );
});
