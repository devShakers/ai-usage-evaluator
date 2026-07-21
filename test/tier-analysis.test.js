'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeTier, buildLadder } = require('../src/tier-analysis');
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
  const a = analyzeTier(report(), t);
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
  const a = analyzeTier(rep, t);
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
  const a = analyzeTier(rep, t);
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
  const a = analyzeTier(rep, t);
  assert.equal(a.tier, 7);
  assert.equal(a.metCriteria.length, 7);
  assert.equal(a.blockingCriterion, null);
});

test('analyzeTier: T4 -> T5 blocking lists EVERY missing sub-condition (agentic/mcp/custom), not just one', () => {
  const rep = report({
    tools: [tool('cursor', true, { instructions: 1, mcpServers: 1, skills: 1 })], // no agentic CLI
  });
  const t = getCatalog('es');
  const a = analyzeTier(rep, t);
  assert.equal(a.tier, 4);
  assert.match(a.blockingCriterion, /T5/);
  assert.match(a.blockingCriterion, /agéntica/i);
});

test('analyzeTier: renders in English too, with the same tier/signals, translated copy', () => {
  const rep = report({ tools: [tool('claude-code', true, { instructions: 1 })] });
  const tEs = getCatalog('es');
  const tEn = getCatalog('en');
  const aEs = analyzeTier(rep, tEs);
  const aEn = analyzeTier(rep, tEn);
  assert.equal(aEs.tier, aEn.tier);
  assert.notEqual(aEs.metCriteria[0].text, aEn.metCriteria[0].text);
  assert.match(aEn.blockingCriterion, /T3/);
});

test('analyzeTier: never throws on a malformed/empty report', () => {
  const t = getCatalog('es');
  assert.doesNotThrow(() => analyzeTier({}, t));
  assert.doesNotThrow(() => analyzeTier(null, t));
  assert.doesNotThrow(() => analyzeTier(undefined, t));
});

// talents-ai-score, i18n audit: tier-engine.js's own `tierName` field is
// Spanish-only by design (domain logic, not i18n) — analyzeTier must
// override it with the LOCALIZED name (src/i18n.js's `tierNames`
// catalog, keyed by the stable `tierKey`), never leak the raw Spanish
// name into an English-locale analysis.
test('analyzeTier: tierName is localized (never the raw Spanish tier-engine name) when analyzing in English', () => {
  const rep = report({ tools: [tool('claude-code', true, { instructions: 1 })] });
  const tEn = getCatalog('en');
  const a = analyzeTier(rep, tEn);
  assert.equal(a.tier, 2);
  assert.equal(a.tierName, 'Bench with notes'); // English tierNames.T2, not "Banco con notas"
  assert.equal(/[áéíóúñ]/i.test(a.tierName), false);
});

test('analyzeTier: tierName is the Spanish name when analyzing in Spanish', () => {
  const rep = report({ tools: [tool('claude-code', true, { instructions: 1 })] });
  const tEs = getCatalog('es');
  const a = analyzeTier(rep, tEs);
  assert.equal(a.tierName, 'Banco con notas');
});

/* ---- buildLadder: NESTED levels→tiers, grouping derived from BAND_BY_TIER ---- */

test('buildLadder: nests tiers under their maturity level, grouping DERIVED from bandForTier', () => {
  const t = getCatalog('es');
  const { levels } = buildLadder(report(), t);
  // Five maturity levels, in order.
  assert.deepEqual(levels.map((l) => l.level), [0, 1, 2, 3, 4]);
  // The grouping must match BAND_BY_TIER=[0,1,2,3,3,4,4,4] inverted — NOT hardcoded.
  assert.deepEqual(levels.map((l) => l.tierKeys), [
    ['T0'],
    ['T1'],
    ['T2'],
    ['T3', 'T4'],
    ['T5', 'T6', 'T7'],
  ]);
  // Every tier appears exactly once across the nested structure (8 total).
  const allTierKeys = levels.flatMap((l) => l.tiers.map((x) => x.tierKey));
  assert.equal(allTierKeys.length, 8);
  assert.equal(new Set(allTierKeys).size, 8);
});

test('buildLadder: marks the current level/tier and flags pending tiers with an unlock criterion', () => {
  // A T2 setup (one detected tool with context) → band/level 2.
  const rep = report({ tools: [tool('claude-code', true, { instructions: 1 })] });
  const t = getCatalog('es');
  const { currentTier, currentBand, levels } = buildLadder(rep, t);
  assert.equal(currentTier, 2);
  assert.equal(currentBand, 2);

  const flat = levels.flatMap((l) => l.tiers);
  const t2 = flat.find((x) => x.tierKey === 'T2');
  const t3 = flat.find((x) => x.tierKey === 'T3');
  assert.equal(t2.status, 'current');
  assert.equal(t3.status, 'pending');
  assert.ok(t3.unlock, 'a pending tier carries its unlock criterion');
  // done tiers carry no unlock text.
  assert.equal(flat.find((x) => x.tierKey === 'T0').status, 'done');
  assert.equal(flat.find((x) => x.tierKey === 'T0').unlock, null);
  // The level owning the current tier is itself current.
  assert.equal(levels.find((l) => l.level === 2).status, 'current');
});

test('buildLadder: renders localized names in EN too (no raw Spanish tier-engine names)', () => {
  const t = getCatalog('en');
  const { levels } = buildLadder(report(), t);
  const t0 = levels[0].tiers[0];
  assert.equal(t0.tierKey, 'T0');
  assert.equal(t0.name, 'Empty bench'); // t.tierNames.T0 (en), never the Spanish "Banco vacío"
  assert.equal(levels[0].name, 'No AI footprint');
});
