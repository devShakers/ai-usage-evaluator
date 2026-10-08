'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getAgentEvaluationEndpoint,
  ENV_PROFILES,
} = require('../src/config');

// With no explicit ingest, endpoints derive from the baked certs base (ADR-065
// revised) — `dev` in this checkout.
const DEV_CERTS = ENV_PROFILES.dev.certsBase;
const { buildSynthesisRequest } = require('../src/agent-synthesis');
const { buildAgentEvaluationRequest } = require('../src/agent-evaluation');

// Issue 111: two of the CLI's three model features never ran for anyone.

function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-111-'));
}

const INGEST = 'https://hub.example.com/works/ai-footprint/reports';

/* ---------- one rule, not four ---------- */

test('all three model endpoints derive from the SAME ingest sibling rule', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: INGEST };
  const base = 'https://hub.example.com/works/ai-footprint/';
  assert.equal(getSynthesisEndpoint(env), `${base}agent-synthesis`);
  assert.equal(getRoadmapEndpoint(env), `${base}roadmap-personalize`);
  // The one that already worked, asserted alongside so the rule is visibly ONE rule: a future reader can see the three share a base and differ only in the last segment.
  assert.equal(getAgentEvaluationEndpoint(env), `${base}agent-evaluation`);
});

test('THE REGRESSION GUARD: a config with only an ingest endpoint wires all three model calls', () => {
  // This is the shape `install.sh` actually writes — and the exact situation in which two of the three features did not exist.
  const dir = freshConfigDir();
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    // ADR-042: the shape install.sh writes is now a SINGLE endpoint.
    JSON.stringify({
      ingestEndpoint: 'http://localhost:3004/api/v1/ai-footprint/reports',
    }),
  );
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  assert.ok(getSynthesisEndpoint(env), 'synthesis has no endpoint on a standard install');
  assert.ok(getRoadmapEndpoint(env), 'roadmap personalization has no endpoint on a standard install');
  assert.ok(getAgentEvaluationEndpoint(env), 'agent evaluation has no endpoint on a standard install');
  // ADR-042: there is no second hop to also check. The three above ARE the
  // wiring, and all three still derive from the one ingest endpoint.
});

test('with no explicit ingest, the model endpoints derive from the baked certs base', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshConfigDir() };
  assert.equal(getSynthesisEndpoint(env), `${DEV_CERTS}/usage/agent-synthesis`);
  assert.equal(getRoadmapEndpoint(env), `${DEV_CERTS}/usage/roadmap-personalize`);
});

/* ---------- the egress comparison that replaced the legal gate ---------- */

const AGENTS = [{ name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null }];
const DESCRIPTIONS = [{ name: 'backend-developer', description: 'Writes backend code for the platform' }];
const DEFINITIONS = [{
  name: 'backend-developer',
  definition: 'Writes backend code for the platform\n\nBODY: never touch the payments module without a review.',
}];

test('the synthesis body is a STRICT SUBSET of the evaluation body, which already travels', () => {
  // The load-bearing test of this file.
  const synthesis = buildSynthesisRequest(AGENTS, DESCRIPTIONS, false);
  const evaluation = buildAgentEvaluationRequest(AGENTS, DEFINITIONS, 'es', false);

  const sKeys = Object.keys(synthesis.agents[0]).sort();
  const eKeys = Object.keys(evaluation.agents[0]).sort();
  // Same per-agent metadata on both sides, with prose under a different key.
  assert.deepEqual(sKeys, ['description', 'model', 'name', 'parent', 'tools']);
  assert.deepEqual(eKeys, ['definition', 'model', 'name', 'parent', 'tools']);

  // The prose itself: what synthesis sends is CONTAINED in what evaluation sends.
  const sent = synthesis.agents[0].description;
  assert.ok(sent.length > 0, 'the fixture must actually carry a description');
  assert.ok(
    evaluation.agents[0].definition.includes(sent),
    'the evaluation request must already contain everything the synthesis request sends',
  );
  // And the evaluation sends MORE (the body), which is the asymmetry that makes
  // this a subset and not a tie.
  assert.ok(evaluation.agents[0].definition.length > sent.length);
  assert.ok(evaluation.agents[0].definition.includes('BODY:'));
});

test('the synthesis request carries no field beyond the agent list and the consent flag', () => {
  // A second angle on the same boundary: nothing sneaks in at the request root.
  assert.deepEqual(Object.keys(buildSynthesisRequest(AGENTS, DESCRIPTIONS, false)), ['agents']);
  assert.deepEqual(
    Object.keys(buildSynthesisRequest(AGENTS, DESCRIPTIONS, true)).sort(),
    ['agents', 'traceContentConsent'],
  );
});
