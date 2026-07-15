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

/*
 * ADR-008 (skill-code-certification): the 0-100 `score` was RECALIBRATED.
 * The old formula (`breadth*8 + instructions*6 + min(mcp,8)*5 + ...`, capped
 * at 100) SATURATED trivially — breadth alone (13 tools * 8 = 104 -> 100)
 * pinned the meter at 100 with zero configured depth, so it never
 * discriminated in the high band. The new model normalizes over a
 * theoretical max with per-dimension caps (weights sum to 100); the "hard"
 * signals (agentic + hooks + multi-agent = 34 pts) live at the top, so 100
 * is reserved for a genuinely maximized T7 setup. Deterministic and
 * reproducible: same input -> same score, no LLM/time/randomness.
 */

// A truly maximized setup: every dimension at or beyond its "full" target.
function maxedReport() {
  return report(
    [
      tool('claude-code', { instructions: 3, config: 1, mcpServers: 6, skills: 6, commands: 6, rules: 3, hooks: 2 }),
      tool('cursor', { instructions: 2 }),
      tool('aider'),
    ],
    { agents: 4 },
  );
}

test('classify (ADR-008): breadth-only setups NO LONGER saturate the score to 100', () => {
  // 13 tools, ZERO configured depth. Old formula: 13*8 = 104 -> 100.
  const tools = Array.from({ length: 13 }, (_, i) => tool(`t${i}`));
  const maturity = classify(report(tools));
  assert.ok(maturity.score < 30, `breadth-only should stay low, got ${maturity.score}`);
});

test('classify (ADR-008): 100 is reserved for a genuinely maximized setup', () => {
  assert.equal(classify(maxedReport()).score, 100);
});

test('classify (ADR-008): a strong-but-not-exhaustive setup lands clearly below 100', () => {
  // Rich T5: broad, well-configured, agentic — but no hooks, single agent.
  const strong = classify(
    report(
      [
        tool('claude-code', { instructions: 2, mcpServers: 3, skills: 4, commands: 2 }),
        tool('cursor', { instructions: 1 }),
        tool('windsurf'),
      ],
      { agents: 1 },
    ),
  );
  assert.ok(strong.score < 100, `strong setup should be < 100, got ${strong.score}`);
  assert.ok(strong.score >= 70, `strong setup should still score high (~70-90), got ${strong.score}`);
});

test('classify (ADR-008): the score discriminates in the HIGH band (good < excellent)', () => {
  // Same rich depth; the difference is only the hard top signals (hooks +
  // second agent). Moving from "good" to "excellent" must move the score.
  const good = classify(
    report(
      [tool('claude-code', { instructions: 2, mcpServers: 3, skills: 4, commands: 2 })],
      { agents: 1 },
    ),
  );
  const excellent = classify(
    report(
      [tool('claude-code', { instructions: 2, mcpServers: 3, skills: 4, commands: 2, hooks: 2 })],
      { agents: 3 },
    ),
  );
  assert.ok(
    excellent.score > good.score + 10,
    `excellent (${excellent.score}) must clear good (${good.score}) by a real margin`,
  );
});

test('classify (ADR-008): score is reproducible — same input yields the same score', () => {
  const r = maxedReport();
  assert.equal(classify(r).score, classify(r).score);
  const r2 = report([tool('claude-code', { instructions: 1, mcpServers: 1, skills: 2 })], { agents: 2 });
  assert.equal(classify(r2).score, classify(r2).score);
});

test('classify (ADR-008): score is always an integer clamped to [0,100]', () => {
  for (const r of [report([]), maxedReport(), report([tool('cursor', { instructions: 1 })])]) {
    const s = classify(r).score;
    assert.ok(Number.isInteger(s), `score must be an integer, got ${s}`);
    assert.ok(s >= 0 && s <= 100, `score out of range: ${s}`);
  }
});

/*
 * ADR-009 (skill-code-certification): the SCORE is now PROJECT-SCOPED. It is
 * computed from `report.projectScope` (signals inside THE CURRENT project only,
 * attached by scanner.js) instead of the home-inflated `tools[].depth` /
 * `agentCounts`, so different projects get different scores and the developer's
 * global `~/.claude` setup stops dominating. `computeScore` (ADR-008 model) is
 * unchanged; only its INPUT is re-scoped. The tier keeps its project ∪ home
 * scope. When `projectScope` is absent (older report shape / legacy fixture),
 * classify falls back to the previous computation — the tests above rely on it.
 */

function withProjectScope(baseReport, projectScope) {
  return { ...baseReport, projectScope };
}

test('classify (ADR-009): score is computed from projectScope when present', () => {
  // Rich home-inflated depth, but an EMPTY project scope -> score reflects the
  // (empty) project, not the home setup.
  const r = withProjectScope(
    report([tool('claude-code', { instructions: 3, mcpServers: 6, skills: 6, commands: 6, hooks: 2 })], { agents: 4 }),
    { breadth: 0, context: 0, mcp: 0, custom: 0, hasAgentic: false, hooks: 0, agentCount: 0 },
  );
  assert.equal(classify(r).score, 0);
});

test('classify (ADR-009): two projects with IDENTICAL tools/home but different projectScope score differently', () => {
  // Same tools + same (home-derived) depth + same agentCounts — the ONLY
  // difference is the per-project signals. This is exactly the backend-hub vs
  // nuply "both 92" case the ADR fixes.
  const tools = [tool('claude-code', { instructions: 2, mcpServers: 3, skills: 4, commands: 2, hooks: 1 })];
  const bare = withProjectScope(report(tools, { agents: 3 }), {
    breadth: 1, context: 0, mcp: 0, custom: 0, hasAgentic: false, hooks: 0, agentCount: 0,
  });
  const rich = withProjectScope(report(tools, { agents: 3 }), {
    breadth: 1, context: 1, mcp: 2, custom: 4, hasAgentic: true, hooks: 1, agentCount: 2,
  });
  assert.notEqual(classify(bare).score, classify(rich).score);
  assert.ok(classify(rich).score > classify(bare).score);
});

test('classify (ADR-009): a maxed projectScope reaches 100; the tier still comes from tools/agentCounts', () => {
  const r = withProjectScope(
    report([tool('claude-code', { instructions: 1, mcpServers: 1, skills: 1, hooks: 1 })], { agents: 4 }),
    { breadth: 3, context: 2, mcp: 2, custom: 4, hasAgentic: true, hooks: 1, agentCount: 2 },
  );
  const m = classify(r);
  assert.equal(m.score, 100);
  assert.equal(m.tierKey, 'T7'); // tier from the (project ∪ home) tool signals, unchanged
});

test('classify (ADR-009): projectScope absent -> falls back to the legacy mixed computation, never throws', () => {
  const legacy = report([tool('claude-code', { instructions: 2, mcpServers: 3, skills: 4, commands: 2 })], { agents: 1 });
  assert.ok(!('projectScope' in legacy));
  assert.doesNotThrow(() => classify(legacy));
  assert.ok(classify(legacy).score > 0);
});
