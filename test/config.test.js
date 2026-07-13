'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getSynthesisEndpoint, getRoadmapEndpoint, getCertifyEndpoint } = require('../src/config');

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
