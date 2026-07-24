'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTierResult, computeTier, aggregateTierSignals, bandForTier, setupLevelForTier, AGENTIC_IDS } = require('../src/tier-engine');

/*
 * talents-ai-score, issue 019 (ADR-014): deterministic T0-T7 tier engine +
 * 0-4 band derived from tier (single source of truth, level-model.md).
 * Ladder rule: "tu tier = el más alto cuyos criterios cumples TODOS" —
 * checked strictly bottom-up, never skipping a tier whose own criterion
 * isn't met even if a HIGHER tier's raw signal happens to be present.
 *
 * Every test builds a minimal synthetic `report`-shaped object — no file
 * scanning here, this module only aggregates signals already produced by
 * scanner.js/agent-org-chart.js.
 */

function report({ tools = [], agentCounts = { agents: 0 } } = {}) {
  return { tools, agentCounts };
}

function tool(id, depth = {}) {
  return { id, detected: true, depth };
}

// --- each tier, minimal combination -------------------------------------------

test('T0: no tools detected at all', () => {
  const result = computeTierResult(report({ tools: [] }));
  assert.equal(result.tier, 0);
  assert.equal(result.tierKey, 'T0');
});

test('T1: at least one tool detected, no context', () => {
  const result = computeTierResult(report({ tools: [tool('cursor')] }));
  assert.equal(result.tier, 1);
});

test('T2: T1 + context (instructions/config/rules) >= 1', () => {
  const result = computeTierResult(report({ tools: [tool('cursor', { instructions: 1 })] }));
  assert.equal(result.tier, 2);
});

test('T3: T2 + mcpServers >= 1', () => {
  const result = computeTierResult(report({ tools: [tool('cursor', { instructions: 1, mcpServers: 1 })] }));
  assert.equal(result.tier, 3);
});

test('T4: T3 + custom (skills/commands/rules) >= 1', () => {
  const result = computeTierResult(report({
    tools: [tool('cursor', { instructions: 1, mcpServers: 1, skills: 1 })],
  }));
  assert.equal(result.tier, 4);
});

test('T5: T4 + an agentic CLI detected (hasAgentic)', () => {
  const result = computeTierResult(report({
    tools: [tool('claude-code', { instructions: 1, mcpServers: 1, skills: 1 })],
  }));
  assert.equal(result.tier, 5);
});

test('T5: amazon-q-developer counts as agentic too (closed decision #4)', () => {
  const result = computeTierResult(report({
    tools: [tool('amazon-q-developer', { instructions: 1, mcpServers: 1, skills: 1 })],
  }));
  assert.equal(result.tier, 5);
  assert.ok(AGENTIC_IDS.includes('amazon-q-developer'));
});

test('T6: T5 + agentCounts.agents >= 2', () => {
  const result = computeTierResult(report({
    tools: [tool('claude-code', { instructions: 1, mcpServers: 1, skills: 1 })],
    agentCounts: { agents: 2 },
  }));
  assert.equal(result.tier, 6);
});

test('T7: T6 + hooks >= 1', () => {
  const result = computeTierResult(report({
    tools: [tool('claude-code', { instructions: 1, mcpServers: 1, skills: 1, hooks: 1 })],
    agentCounts: { agents: 2 },
  }));
  assert.equal(result.tier, 7);
});

// --- ladder integrity: never skip a tier whose OWN criterion isn't met -------

test('ladder: mcpServers present but NO context -> capped at T1, does not jump to T3', () => {
  const result = computeTierResult(report({ tools: [tool('cursor', { mcpServers: 1 })] }));
  assert.equal(result.tier, 1);
});

test('ladder: hooks present but no context/mcp/custom -> capped at T1, does not jump to T7', () => {
  const result = computeTierResult(report({ tools: [tool('claude-code', { hooks: 1 })] }));
  assert.equal(result.tier, 1);
});

test('ladder: agentCounts.agents >= 2 without an agentic CLI/mcp/custom -> capped at T1, does not jump to T6', () => {
  const result = computeTierResult(report({ tools: [tool('cursor')], agentCounts: { agents: 5 } }));
  assert.equal(result.tier, 1);
});

test('ladder: hasAgentic without mcp/custom -> capped at T2 (T5 needs BOTH mcp and custom too, not just an agentic CLI)', () => {
  const result = computeTierResult(report({ tools: [tool('claude-code', { instructions: 1 })] }));
  assert.equal(result.tier, 2); // context present -> T2, but no mcp/custom -> not T3/T4/T5
});

// --- mtime/recency never gates (ADR-003, level-model.md closed decision #3) --

test('recency/mtime on a tool never changes the tier, only structural signals do', () => {
  const withoutRecency = report({ tools: [tool('cursor', { instructions: 1, mcpServers: 1 })] });
  const withStaleRecency = report({
    tools: [{ ...tool('cursor', { instructions: 1, mcpServers: 1 }), recency: { bucket: 'stale', daysSinceModified: 400 } }],
  });
  assert.equal(computeTierResult(withoutRecency).tier, computeTierResult(withStaleRecency).tier);
});

// --- band derivation (single source of truth) --------------------------------

test('bandForTier: maps every tier to the level-model.md band', () => {
  assert.equal(bandForTier(0), 0);
  assert.equal(bandForTier(1), 1);
  assert.equal(bandForTier(2), 2);
  assert.equal(bandForTier(3), 3);
  assert.equal(bandForTier(4), 3);
  assert.equal(bandForTier(5), 4);
  assert.equal(bandForTier(6), 4);
  assert.equal(bandForTier(7), 4);
});

test('computeTierResult: exposes tier, band, and the raw signals used', () => {
  const result = computeTierResult(report({ tools: [tool('cursor', { instructions: 1 })] }));
  assert.equal(result.tier, 2);
  assert.equal(result.band, 2);
  assert.ok(result.signals);
  assert.equal(result.signals.context, 1);
});

test('aggregateTierSignals: ignores non-detected tools entirely', () => {
  const signals = aggregateTierSignals(report({
    tools: [{ id: 'aider', detected: false, depth: { instructions: 5, mcpServers: 5 } }],
  }));
  assert.equal(signals.totalDetected, 0);
  assert.equal(signals.context, 0);
});

test('computeTier: never throws on missing/malformed report fields', () => {
  assert.doesNotThrow(() => computeTier(aggregateTierSignals({})));
  assert.doesNotThrow(() => computeTierResult({}));
});

// --- Setup Level derivation (ADR-016) ----------------------------------------
// The 3-value Setup Level REPLACES the retired 0-4 band on every display
// surface. Mapping: (T0)->Not certified · T1-T2->S1 · T3-T4->S2 · T5-T7->S3.

test('setupLevelForTier: maps every tier to its framework Setup Level', () => {
  assert.equal(setupLevelForTier(0).key, 'none'); // T0 -> Not certified
  assert.equal(setupLevelForTier(1).key, 'S1');
  assert.equal(setupLevelForTier(2).key, 'S1');
  assert.equal(setupLevelForTier(3).key, 'S2');
  assert.equal(setupLevelForTier(4).key, 'S2');
  assert.equal(setupLevelForTier(5).key, 'S3');
  assert.equal(setupLevelForTier(6).key, 'S3');
  assert.equal(setupLevelForTier(7).key, 'S3');
});

test('setupLevelForTier: exposes stable code + monotonically non-decreasing rank', () => {
  assert.equal(setupLevelForTier(0).code, null); // "Not certified" has no S-code
  assert.equal(setupLevelForTier(1).code, 'S1');
  assert.equal(setupLevelForTier(7).code, 'S3');
  // Rank never decreases as the tier climbs (monotonic rollup) — a higher tier
  // can never map to a lower Setup Level.
  let prev = -1;
  for (let tier = 0; tier <= 7; tier++) {
    const rank = setupLevelForTier(tier).rank;
    assert.ok(rank >= prev, `rank must be non-decreasing at tier ${tier} (got ${rank} after ${prev})`);
    prev = rank;
  }
});

test('setupLevelForTier: defensive on out-of-range / bad tier -> Not certified', () => {
  assert.equal(setupLevelForTier(99).key, 'none');
  assert.equal(setupLevelForTier(-1).key, 'none');
  assert.equal(setupLevelForTier(undefined).key, 'none');
});

test('computeTierResult: exposes the Setup Level alongside the tier', () => {
  const result = computeTierResult(report({ tools: [tool('claude-code', { instructions: 1, mcpServers: 1, skills: 1 })] }));
  assert.equal(result.tier, 5);
  assert.equal(result.setupLevel.key, 'S3'); // T5 -> S3
  assert.equal(result.setupLevel.code, 'S3');
});
