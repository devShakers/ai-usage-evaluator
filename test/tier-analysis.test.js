'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeTier } = require('../src/tier-analysis');
const { getCatalog } = require('../src/i18n');

/*
 * talents-ai-score: deterministic "why this tier" analysis. Every sentence
 * is a direct, mechanical readout of tier-engine.js's own ladder rule (see
 * its header table) plus the exact signal value that backs it — never an
 * LLM guess, never invented. This is what render-html.js's and
 * render-terminal.js's tier-analysis sections both render from, so both
 * outputs are guaranteed to agree.
 */

function report({ tools = [], agentCounts = { agents: 0 } } = {}) {
  return { tools, agentCounts };
}

function tool(id, detected, depth = {}) {
  return { id, detected, depth };
}

test('analyzeTier: T0 (nothing detected) — no criteria met, blocking is T1', () => {
  const t = getCatalog('es');
  const a = analyzeTier(report(), t.tierAnalysis);
  assert.equal(a.tier, 0);
  assert.equal(a.metCriteria.length, 0);
  assert.ok(a.blockingCriterion);
  assert.match(a.blockingCriterion, /T1/);
});

test('analyzeTier: T2 — T1 and T2 criteria met, blocking is T3 (mcp)', () => {
  const rep = report({
    tools: [tool('claude-code', true, { instructions: 1 })],
  });
  const t = getCatalog('es');
  const a = analyzeTier(rep, t.tierAnalysis);
  assert.equal(a.tier, 2);
  assert.equal(a.metCriteria.length, 2);
  assert.ok(a.metCriteria.some((c) => c.toTier === 1));
  assert.ok(a.metCriteria.some((c) => c.toTier === 2));
  assert.match(a.blockingCriterion, /T3/);
  assert.match(a.blockingCriterion, /mcpServers = 0/);
});

test('analyzeTier: every met-criterion text embeds the actual signal value backing it, never a made-up one', () => {
  const rep = report({
    tools: [tool('claude-code', true, { instructions: 1, mcpServers: 2, skills: 1 })],
  });
  const t = getCatalog('es');
  const a = analyzeTier(rep, t.tierAnalysis);
  const t3 = a.metCriteria.find((c) => c.toTier === 3);
  assert.match(t3.text, /mcpServers = 2/);
  const t4 = a.metCriteria.find((c) => c.toTier === 4);
  assert.match(t4.text, /custom = 1/);
});

test('analyzeTier: T7 (max tier) — all criteria met, blockingCriterion is null', () => {
  const rep = report({
    tools: [tool('claude-code', true, { instructions: 1, mcpServers: 1, skills: 1, hooks: 1 })],
    agentCounts: { agents: 2 },
  });
  const t = getCatalog('es');
  const a = analyzeTier(rep, t.tierAnalysis);
  assert.equal(a.tier, 7);
  assert.equal(a.metCriteria.length, 7);
  assert.equal(a.blockingCriterion, null);
});

test('analyzeTier: T4 -> T5 blocking lists EVERY missing sub-condition (agentic/mcp/custom), not just one', () => {
  const rep = report({
    tools: [tool('cursor', true, { instructions: 1, mcpServers: 1, skills: 1 })], // no agentic CLI
  });
  const t = getCatalog('es');
  const a = analyzeTier(rep, t.tierAnalysis);
  assert.equal(a.tier, 4);
  assert.match(a.blockingCriterion, /T5/);
  assert.match(a.blockingCriterion, /agéntica/i);
});

test('analyzeTier: renders in English too, with the same tier/signals, translated copy', () => {
  const rep = report({ tools: [tool('claude-code', true, { instructions: 1 })] });
  const tEs = getCatalog('es').tierAnalysis;
  const tEn = getCatalog('en').tierAnalysis;
  const aEs = analyzeTier(rep, tEs);
  const aEn = analyzeTier(rep, tEn);
  assert.equal(aEs.tier, aEn.tier);
  assert.notEqual(aEs.metCriteria[0].text, aEn.metCriteria[0].text);
  assert.match(aEn.blockingCriterion, /T3/);
});

test('analyzeTier: never throws on a malformed/empty report', () => {
  const t = getCatalog('es');
  assert.doesNotThrow(() => analyzeTier({}, t.tierAnalysis));
  assert.doesNotThrow(() => analyzeTier(null, t.tierAnalysis));
  assert.doesNotThrow(() => analyzeTier(undefined, t.tierAnalysis));
});
