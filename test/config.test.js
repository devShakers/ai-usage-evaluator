'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getSynthesisEndpoint } = require('../src/config');

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
