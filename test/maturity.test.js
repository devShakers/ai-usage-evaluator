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
 * ADR-010 (skill-code-certification): the project-scoped score of ADR-009 is
 * REVERTED. The score is computed over the merged (project ∪ home) signals
 * again — `tools[].depth` (via depthTotals) + `agentCounts` — exactly as it was
 * after ADR-008. ADR-009 drove notes too low (project-level AI config is
 * sparse, so almost everything sat near the floor); the user chose the previous
 * behaviour back (a rich setup lands back in the ~90 band). A
 * `report.projectScope`, if present on an older report, is now IGNORED.
 */

test('classify (ADR-010): report.projectScope is IGNORED — score uses the merged signals', () => {
  const tools = [
    tool('claude-code', { instructions: 2, config: 1, mcpServers: 3, skills: 4, commands: 4, rules: 1, hooks: 2 }),
    tool('cursor', { instructions: 1 }),
    tool('aider'),
  ];
  const base = report(tools, { agents: 3 });
  // An all-zero projectScope would have forced score 0 under ADR-009; after the
  // revert it must be ignored, so the score matches the projectScope-free report.
  const withEmptyScope = {
    ...base,
    projectScope: { breadth: 0, context: 0, mcp: 0, custom: 0, hasAgentic: false, hooks: 0, agentCount: 0 },
  };
  assert.equal(classify(withEmptyScope).score, classify(base).score);
  assert.ok(classify(base).score > 0);
});

test('classify (ADR-010): a rich merged setup is back in the ~90 band (pre-ADR-009 behaviour)', () => {
  // The kind of setup that scored ~92 before ADR-009 and dropped near the floor
  // under it. Everything strong except a single agent (multiAgent not maxed).
  const tools = [
    tool('claude-code', { instructions: 3, config: 1, mcpServers: 4, skills: 6, commands: 4, rules: 2, hooks: 2 }),
    tool('cursor', { instructions: 2 }),
    tool('windsurf'),
    tool('aider'),
  ];
  const m = classify(report(tools, { agents: 1 }));
  assert.ok(m.score >= 88, `rich setup should be back in the ~90 band, got ${m.score}`);
});
