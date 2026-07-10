'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classify, LEVELS } = require('../src/maturity');
const { AGENTIC_IDS } = require('../src/tier-engine');

/*
 * talents-ai-score, issue 019 (ADR-014): classify()'s 0-4 band is now
 * RECALIBRATED to derive from the tier engine (single source of truth,
 * level-model.md) instead of its own independent ad-hoc rules. This is the
 * FIRST dedicated test file for maturity.js (previously only exercised
 * indirectly via fixture objects in render/share tests).
 */

function tool(id, depth = {}) {
  return { id, detected: true, depth };
}

function report(tools, agentCounts = { agents: 0 }) {
  return { tools, agentCounts, summary: { totalDetected: tools.filter((t) => t.detected).length, categories: [] } };
}

test('classify: no tools detected -> band 0 ("Sin rastro de IA")', () => {
  const maturity = classify(report([]));
  assert.equal(maturity.level, 0);
  assert.equal(maturity.key, 'none');
});

test('classify: exposes tier alongside the band (single source of truth, issue 019)', () => {
  const maturity = classify(report([tool('cursor', { instructions: 1 })]));
  assert.equal(maturity.tier, 2);
  assert.equal(maturity.tierKey, 'T2');
  assert.equal(maturity.level, 2); // band derived FROM the tier
});

test('classify: band mapping matches level-model.md exactly (T0-T7 -> 0,1,2,3,3,4,4,4)', () => {
  assert.equal(classify(report([])).level, 0); // T0
  assert.equal(classify(report([tool('cursor')])).level, 1); // T1
  assert.equal(classify(report([tool('cursor', { instructions: 1 })])).level, 2); // T2
  assert.equal(classify(report([tool('cursor', { instructions: 1, mcpServers: 1 })])).level, 3); // T3
  assert.equal(classify(report([tool('cursor', { instructions: 1, mcpServers: 1, skills: 1 })])).level, 3); // T4 -> band 3
  assert.equal(
    classify(report([tool('claude-code', { instructions: 1, mcpServers: 1, skills: 1 })])).level,
    4,
  ); // T5 -> band 4
});

test('classify: amazon-q-developer counts as agentic (closed decision #4) — reaches band 4 via T5', () => {
  const maturity = classify(report([tool('amazon-q-developer', { instructions: 1, mcpServers: 1, skills: 1 })]));
  assert.equal(maturity.hasAgentic, true);
  assert.equal(maturity.tier, 5);
  assert.equal(maturity.level, 4);
  assert.ok(AGENTIC_IDS.includes('amazon-q-developer'));
});

test('classify: RECALIBRATION — breadth-only setups (many tools, no context) no longer reach band 3', () => {
  // Under the OLD ad-hoc rules, breadth >= 3 alone reached level 3. Under
  // the tier-derived band (issue 019), T2's context requirement gates
  // that — three tools with zero configured context stay capped at T1.
  const maturity = classify(report([tool('cursor'), tool('windsurf'), tool('aider')]));
  assert.equal(maturity.tier, 1);
  assert.equal(maturity.level, 1);
});

test('classify: LEVELS metadata (name/emoji) resolves correctly for the band actually reached', () => {
  assert.equal(LEVELS.length, 5);
  const maturity = classify(report([tool('cursor', { instructions: 1 })])); // band 2
  const expected = LEVELS.find((l) => l.level === 2);
  assert.equal(maturity.name, expected.name);
  assert.equal(maturity.emoji, expected.emoji);
});

test('classify: never throws on an empty/malformed report', () => {
  assert.doesNotThrow(() => classify({ tools: [] }));
});
