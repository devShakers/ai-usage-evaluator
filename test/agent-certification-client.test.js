'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  capDefinition,
  MAX_AGENT_CERT_DEFINITION_CHARS,
} = require('../src/agent-certification-client');

/*
 * skill-code-certification (`certify agents`) — oversized-definition regression.
 *
 * BUG: `certify agents` (incl. --fast/superadmin) 400'd on the verdict ONLY for a
 * large agent (hub-mr-reviewer, ~35k chars). Root cause: the flow egressed the
 * FULL agent definition uncapped, and the backend DTO caps it at @MaxLength
 * (MAX_AGENT_CERT_DEFINITION_CHARS). A short agent passed; a large one didn't.
 *
 * FIX: capDefinition scrubs THEN slices to MAX so the sent definition is always
 * `<= MAX` (backend @MaxLength is inclusive) — no agent can 400 the verdict on
 * size. Realistic agents sit well under the cap and are untouched.
 */

test('MAX matches the backend @MaxLength (single source of truth) and is generous', () => {
  assert.equal(MAX_AGENT_CERT_DEFINITION_CHARS, 50000);
});

test('a normal-sized definition is passed through untouched (not truncated)', () => {
  const def = 'Reviews merge requests and enforces the DDD boundaries of the module.';
  const { definition, truncated } = capDefinition(def);
  assert.equal(truncated, false);
  assert.equal(definition, def);
});

// Prose (not a single long char run, which scrubSecrets would treat as a token).
const PROSE = 'The agent reviews merge requests and enforces DDD boundaries. ';
const prose = (targetLen) => PROSE.repeat(Math.ceil(targetLen / PROSE.length)).slice(0, targetLen);

test('an oversized definition is sliced to exactly MAX and flagged truncated', () => {
  const huge = prose(MAX_AGENT_CERT_DEFINITION_CHARS + 15000); // ~ hub-mr-reviewer scale
  const { definition, truncated } = capDefinition(huge);
  assert.equal(truncated, true);
  assert.equal(definition.length, MAX_AGENT_CERT_DEFINITION_CHARS);
  // Inclusive @MaxLength(MAX) accepts a payload of exactly MAX → never 400 on size.
  assert.ok(definition.length <= MAX_AGENT_CERT_DEFINITION_CHARS);
});

test('a definition of exactly MAX chars is NOT truncated (boundary)', () => {
  const exact = prose(MAX_AGENT_CERT_DEFINITION_CHARS);
  const { definition, truncated } = capDefinition(exact);
  assert.equal(truncated, false);
  assert.equal(definition.length, MAX_AGENT_CERT_DEFINITION_CHARS);
});

test('scrub runs BEFORE the slice so a secret cannot leak past the cut', () => {
  // Put a secret right at the cut boundary; after scrub it becomes [REDACTED]
  // and the sliced result must not contain the raw token.
  const secret = 'token=abcdef1234567890abcdef';
  const raw = prose(MAX_AGENT_CERT_DEFINITION_CHARS - 5) + secret + prose(10000);
  const { definition } = capDefinition(raw);
  assert.ok(!definition.includes('abcdef1234567890abcdef'));
  assert.ok(definition.length <= MAX_AGENT_CERT_DEFINITION_CHARS);
});

test('null / empty definition is safe', () => {
  assert.deepEqual(capDefinition(null), { definition: '', truncated: false });
  assert.deepEqual(capDefinition(''), { definition: '', truncated: false });
});
