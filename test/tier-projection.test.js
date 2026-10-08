'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { projectNextTier, DELTAS } = require('../src/tier-projection');
const { computeTierResult, computeTier, aggregateTierSignals } = require('../src/tier-engine');
const { classify } = require('../src/maturity');
const { scan } = require('../src/scanner');
const { renderTerminal } = require('../src/render-terminal');
const { getCatalog } = require('../src/i18n');

/* ---------- report builders, in the shape the scanner produces ---------- */

function tool(depth = {}, id = 'cursor') {
  return {
    id,
    name: id,
    detected: true,
    depth,
    footprint: null,
    recency: { lastModified: null, daysSinceModified: null, bucket: null },
  };
}

// Minimal reports that sit exactly on each tier. Built from the engine's own
// verdict (asserted below), never from a comment claiming a tier.
const AT_TIER = {
  0: { tools: [], agentCounts: {} },
  1: { tools: [tool()], agentCounts: {} },
  2: { tools: [tool({ instructions: 1 })], agentCounts: {} },
  3: { tools: [tool({ instructions: 1, mcpServers: 1 })], agentCounts: {} },
  4: { tools: [tool({ instructions: 1, mcpServers: 1, skills: 1 })], agentCounts: {} },
  5: { tools: [tool({ instructions: 1, mcpServers: 1, skills: 1 }, 'claude-code')], agentCounts: { agents: 1 } },
  6: { tools: [tool({ instructions: 1, mcpServers: 1, skills: 1 }, 'claude-code')], agentCounts: { agents: 2 } },
  7: { tools: [tool({ instructions: 1, mcpServers: 1, skills: 1, hooks: 1 }, 'claude-code')], agentCounts: { agents: 2 } },
};

test('the fixtures sit where they claim to: one report per tier, per the engine', () => {
  for (const [tier, report] of Object.entries(AT_TIER)) {
    assert.equal(computeTierResult(report).tier, Number(tier), `fixture ${tier} is not at tier ${tier}`);
  }
});

/* ---------- THE GUARD: the deltas really do reach the next tier ---------- */

test('for every tier, the jump deltas reach at least the next tier — checked with the real engine', () => {
  for (let from = 0; from <= 6; from += 1) {
    const projection = projectNextTier(AT_TIER[from]);
    assert.ok(projection, `no projection from T${from}, so the roadmap would show no "after"`);
    assert.equal(projection.current.tier, from);
    assert.ok(
      projection.projected.tier >= from + 1,
      `the deltas for T${from + 1} no longer satisfy its criterion: projected T${projection.projected.tier}`,
    );
    // The deltas exist for every reachable target, and only for those.
    assert.ok(DELTAS[from + 1], `no delta list for target tier ${from + 1}`);
  }
});

test('the projection never invents a tier the engine would not give for the same report', () => {
  // Recompute the projection independently: apply the SAME deltas to a fresh clone and ask the engine.
  for (let from = 0; from <= 6; from += 1) {
    const clone = JSON.parse(JSON.stringify(AT_TIER[from]));
    for (const apply of DELTAS[from + 1]) apply(clone);
    const independent = computeTier(aggregateTierSignals(clone));
    assert.equal(projectNextTier(AT_TIER[from]).projected.tier, independent);
  }
});

test('T7 has no projection at all — an "after" at the top of the ladder would be invented', () => {
  assert.equal(projectNextTier(AT_TIER[7]), null);
});

test('a missing or unusable report projects nothing rather than guessing', () => {
  assert.equal(projectNextTier(null), null);
  assert.equal(projectNextTier(undefined), null);
  assert.equal(projectNextTier('not a report'), null);
});

test('the projection never mutates the report it was given', () => {
  const report = AT_TIER[2];
  const before = JSON.stringify(report);
  projectNextTier(report);
  assert.equal(JSON.stringify(report), before, 'the caller is rendering this same object');
});

test('the score moves with the engine, not with a guess', () => {
  const projection = projectNextTier(AT_TIER[2]);
  assert.equal(projection.current.score, classify(AT_TIER[2]).score, 'the "before" IS the real evaluation');
  assert.ok(projection.projected.score >= projection.current.score, 'satisfying a criterion never lowers the meter');
  assert.equal(typeof projection.projected.score, 'number');
});

test('THE CASCADE: one missing criterion can hold back several tiers, and the projection says so', () => {
  const held = {
    tools: [tool({ instructions: 1, skills: 1, hooks: 1 }, 'claude-code')],
    agentCounts: { agents: 2 },
  };
  assert.equal(computeTierResult(held).tier, 2, 'the premise: held at T2 by one criterion');
  const projection = projectNextTier(held);
  assert.equal(projection.projected.tier, 7);
  assert.equal(projection.cascaded, true);
  // And it is not a coincidence of the fixture: the engine agrees on the same data.
  assert.equal(projection.projected.tierKey, 'T7');
});

/* ---------- what the talent reads ---------- */

// The caveat is WRAPPED (issue 087's rule) and coloured, so it is never one contiguous substring of the raw output.
function plain(out) {
  return String(out).replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
}

let tmpRoot;
let tmpHome;
let originalHome;

// HOME IS ISOLATED, and it was not at first — a defect this file's own control exposed while verifying issue 112.
test('setup: a real scanned project, with HOME isolated, for the render assertions', () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-084-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-084-home-'));
  originalHome = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
  fs.writeFileSync(path.join(tmpRoot, 'CLAUDE.md'), '# Context\n');
});

for (const lang of ['es', 'en']) {
  test(`roadmap [${lang}]: shows the before, the after, and labels the after as a projection`, () => {
    const t = getCatalog(lang);
    const report = scan({ root: tmpRoot });
    const out = renderTerminal(report, classify(report), lang, { showRoadmap: true });
    const projection = projectNextTier(report);
    assert.ok(projection, 'the fixture must be projectable or this test proves nothing');

    assert.ok(out.includes(t.html.roadmapNowLabel), 'the "before" heading is missing');
    assert.ok(out.includes(t.html.roadmapProjectionLabel), 'the "after" heading is missing');
    // The unambiguous label. This is the criterion that keeps the block from
    // reading as a promise (issue 077's lesson), so it is asserted on the output.
    assert.ok(out.includes(`[${t.html.roadmapProjectionTag}]`), 'the projection is not labelled as one');
    assert.ok(plain(out).includes(plain(t.html.roadmapProjectionNote)), 'the caveat is missing');

    // Same scale on both sides: both lines carry the same `/100` meter and the
    // localized tier name, so they compare at a glance.
    for (const side of [projection.current, projection.projected]) {
      const name = t.tierNames[side.tierKey];
      assert.ok(out.includes(`${side.tierKey} · ${name}`), `${side.tierKey} (${name}) is not on screen`);
      assert.ok(out.includes(`${side.score}/100`), `the ${side.score}/100 meter is not on screen`);
    }
  });
}

test('roadmap: no projection block at the top of the ladder (nothing is invented)', () => {
  const t = getCatalog('es');
  const out = renderTerminal(AT_TIER[7], classify(AT_TIER[7]), 'es', { showRoadmap: true });
  assert.equal(out.includes(t.html.roadmapProjectionLabel), false);
  assert.equal(out.includes(`[${t.html.roadmapProjectionTag}]`), false);
  // Control: the T7 roadmap itself still renders (the block is absent, not the section).
  assert.ok(out.includes(t.html.roadmapHeading));
});

test('the projection block respects the colour gate (issue 079): no raw escapes when colour is off', () => {
  // `renderTerminal` colours through `src/ansi.js`'s palette, which is gated on
  // the stream. Asserted on the OUTPUT, the way 079 requires.
  const prev = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const report = scan({ root: tmpRoot });
    const out = renderTerminal(report, classify(report), 'es', { showRoadmap: true });
    const t = getCatalog('es');
    assert.ok(out.includes(t.html.roadmapProjectionLabel), 'the block is still there without colour');
    assert.equal(/\x1b\[/.test(out), false, 'no ANSI escape survives NO_COLOR');
  } finally {
    if (prev === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = prev;
  }
});

test('teardown', () => {
  if (originalHome === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHome;
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
});
