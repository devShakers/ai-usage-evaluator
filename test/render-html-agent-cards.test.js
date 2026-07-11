'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score: the agent cards tree is now the SOLE agents view
 * (consolidates and replaces the earlier separate deterministic org-chart
 * tree section, which duplicated this same data, and the earlier Mermaid
 * graph attempt — both illegible or redundant). Hierarchy is now VISUAL
 * (nesting + rail connector), not a text line — the coordinator's ask was
 * "ver qué subagentes cuelgan de qué agente sin leer".
 *
 * Data mapping under test (never invented, only fields the report has):
 *   title = symbolicName (if synthesis exists this run) else the real name
 *   badge = the real (structural) agent name — always present when a
 *           symbolic title is shown
 *   phrase = whatItDoes (only when synthesis exists)
 *   chips  = tools[] + one chip for model (ADR-009 structural data, never
 *            depends on synthesis)
 *   hierarchy = nesting under an implicit "Orchestrator" root header when
 *               no parent is declared, or under the named parent card when
 *               one is, recursively for deeper explicit chains.
 *
 * Explicitly NOT rendered (no data backing it): L1/L2 maturity framing,
 * "human judgment", "evidence", "edit ontology".
 */

const BASE_REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-10T00:00:00.000Z',
  anonId: 'anon123',
  platform: 'darwin',
  environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v20.0.0', editorsInstalled: [] },
  summary: { totalDetected: 0, categories: [] },
  tools: [],
  agents: [],
  agentCounts: { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  technologies: [],
};

const MATURITY = { level: 2, key: 'integrated', name: 'Integrado', score: 40, emoji: '🧭', next: 'siguiente paso' };

// NOTE: the CSS block also contains the literal strings "agent-cards-grid"/
// "agent-tree" (the stylesheet selectors), so lookups below always search
// for the actual element markup, never a bare substring match that would
// collide with the `<style>` block.
function treeSectionOf(html) {
  const start = html.indexOf('<div class="agent-tree">');
  assert.ok(start !== -1, 'expected an agent-tree element');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

// --- no agents at all --------------------------------------------------------

test('renderHtml: no agents -> renders an empty state, never throws, no tree', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /Agentes/);
  assert.equal(html.includes('<div class="agent-tree">'), false);
});

test('renderHtml: missing report.agents entirely (older report) does not throw, renders empty state', () => {
  const { agents, ...reportWithoutAgents } = BASE_REPORT;
  assert.doesNotThrow(() => renderHtml(reportWithoutAgents, MATURITY, 'es'));
});

// --- fallback: agents present, no synthesis ----------------------------------

test('renderHtml: agents without synthesis -> title is the real name, chips are tools+model, no badge', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read', 'Write'], model: 'sonnet', parent: null }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /agent-title">backend-developer</);
  assert.equal(section.includes('agent-badge'), false);
  assert.match(section, /Read/);
  assert.match(section, /Write/);
  assert.match(section, /sonnet/);
});

// talents-ai-score: an earlier fix forced a deterministic FILLER phrase
// (derived from tools/model) whenever synthesis didn't cover an agent —
// every card got the SAME templated sentence, read as noise ("molesta").
// That was reverted to "no phrase at all". Real-browser user testing then
// rejected THAT too: the user does not accept a card with only name+model,
// no description whatsoever. Current, final behavior — a description is
// ALWAYS present, in priority order:
//   1. The synthesis result's whatItDoes (unchanged, richest option).
//   2. The agent's OWN raw `description` from its `.claude/agents/*.md`
//      frontmatter (report.agentDescriptions, bin/report.js) — this is
//      deterministic, local, straight from the file the talent wrote
//      themselves: a legitimate "description based on your own files".
//   3. Only as a LAST RESORT (no synthesis, no declared description at
//      all): a minimal, name-derived line — never a full templated
//      sentence repeated verbatim across cards.

test('renderHtml: agents without synthesis but WITH a raw frontmatter description -> phrase shows that description verbatim', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'ddd-enforcer', tools: [], model: 'opus', parent: null }],
    agentDescriptions: [{ name: 'ddd-enforcer', description: 'Scans a module directory for DDD pattern violations and fixes them.' }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /class="agent-phrase">Scans a module directory for DDD pattern violations and fixes them\.</);
});

test('renderHtml: multiple agents without synthesis, each with its OWN raw description -> distinct phrases, never identical filler', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'ddd-enforcer', tools: [], model: 'opus', parent: null },
      { name: 'hub-mr-reviewer', tools: [], model: 'opus', parent: null },
      { name: 'test-writer', tools: [], model: 'sonnet', parent: null },
    ],
    agentDescriptions: [
      { name: 'ddd-enforcer', description: 'Scans a module directory for DDD pattern violations.' },
      { name: 'hub-mr-reviewer', description: 'Revisor experto de Merge Requests del repo shakers-hub-backend.' },
      { name: 'test-writer', description: 'Use this agent to create tests, write tests, add test coverage.' },
    ],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /Scans a module directory for DDD pattern violations\./);
  assert.match(section, /Revisor experto de Merge Requests/);
  assert.match(section, /Use this agent to create tests/);
});

test('renderHtml: an agent with NEITHER synthesis NOR a declared description gets a minimal, name-derived last-resort phrase — never blank, never a repeated filler sentence', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'bare-agent', tools: [], model: null, parent: null }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /class="agent-phrase"/); // a phrase IS present — never a blank card
  assert.match(section, /Bare agent/i); // derived from the name, not a canned sentence
});

test('renderHtml: an EMPTY declared description (blank/whitespace-only frontmatter) still falls through to the last-resort name-derived phrase, not a blank one', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'quiet-agent', tools: [], model: null, parent: null }],
    agentDescriptions: [{ name: 'quiet-agent', description: '   ' }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /class="agent-phrase"/);
  assert.match(section, /Quiet agent/i);
});

test('renderHtml: raw description matching tolerates the same name-formatting differences as synthesis matching (case/whitespace)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: [], model: 'sonnet', parent: null }],
    agentDescriptions: [{ name: '  Backend-Developer  ', description: 'Handles backend work end to end.' }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /Handles backend work end to end\./);
});

// Deliberately NOT scrubbed for secrets here (unlike the ephemeral
// synthesis request): that heuristic redaction turned out to mangle
// ordinary example file paths a talent legitimately writes in their own
// description text (real-world example found live-testing against
// shakers-hub-backend's actual agents: "...for src/modules/.../foo.ts"
// became "[REDACTED]"), for content that never leaves the machine and
// gains no safety benefit from it — the talent is looking at their OWN
// file, on their OWN machine. Still always HTML-escaped so it can never
// break out of the markup (XSS via a maliciously crafted description).
test('renderHtml: raw description is HTML-escaped before display (never a raw markup injection), but NOT secret-scrubbed (local-only, would mangle legitimate content)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'leaky', tools: [], model: null, parent: null }],
    agentDescriptions: [{ name: 'leaky', description: 'Add test coverage for src/modules/foo/bar.service.ts <script>alert(1)</script>' }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  // The example path survives verbatim — not redacted into noise.
  assert.match(section, /src\/modules\/foo\/bar\.service\.ts/);
  // But real markup injection is neutralized via HTML-escaping.
  assert.equal(section.includes('<script>alert(1)</script>'), false);
});

// --- enriched: agents + synthesis --------------------------------------------

test('renderHtml: agent with a synthesis match -> title is symbolicName, badge is the real name, phrase is whatItDoes', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read', 'Write'], model: 'sonnet', parent: null }],
    agentSynthesis: {
      agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code end to end' }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /agent-title">The Builder</);
  assert.match(section, /agent-badge[^>]*>backend-developer</);
  assert.match(section, /agent-phrase">Writes backend code end to end</);
});

test('renderHtml: only SOME agents have a synthesis match -> the rest fall back individually within the same tree', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null },
      { name: 'reviewer', tools: ['Read'], model: 'opus', parent: null },
    ],
    agentSynthesis: {
      agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /The Builder/);
  assert.match(section, /agent-title">reviewer</); // no synthesis match -> falls back to real name
});

test('renderHtml: when BOTH synthesis and a raw description exist for the same agent, synthesis wins (richer, still takes priority)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null }],
    agentDescriptions: [{ name: 'backend-developer', description: 'RAW frontmatter description text.' }],
    agentSynthesis: {
      agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'SYNTHESIZED polished description.' }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /SYNTHESIZED polished description\./);
  assert.equal(section.includes('RAW frontmatter description text.'), false);
});

// talents-ai-score bugfix: matching used to be exact-string-equality, which
// silently misses an agent when the synthesis response echoes its name
// back with harmless formatting differences (case, surrounding
// whitespace, or wrapped in backticks/quotes/markdown emphasis) — the
// agent then got NEITHER symbolicName NOR whatItDoes even though the
// synthesis response DID cover it. Matching is now normalized (trim +
// case-fold + strip wrapping quote/backtick/asterisk characters).
test('renderHtml: synthesis name matching tolerates case/whitespace/backtick formatting differences from the LLM response', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null }],
    agentSynthesis: {
      agents: [{ name: '`Backend-Developer` ', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /The Builder/);
  assert.match(section, /agent-phrase">Writes backend code</);
});

test('renderHtml: synthesis matching still never collides two genuinely DIFFERENT agent names', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null },
      { name: 'backend-developer-2', tools: ['Read'], model: 'sonnet', parent: null },
    ],
    agentSynthesis: {
      agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /agent-title">The Builder</);
  assert.match(section, /agent-title">backend-developer-2</); // distinct agent, no false match
});

// --- hierarchy is VISUAL now: nesting + rail, not a text line ----------------

test('renderHtml: no parent declared -> a single "Orchestrator" root header, all agents in the top-level grid (2-level tree)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'backend-developer', tools: [], model: 'sonnet', parent: null },
      { name: 'reviewer', tools: [], model: 'opus', parent: null },
    ],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /agent-root-header">Orchestrator</);
  // No nested <div class="agent-children"> wrapper for a flat, 2-level tree.
  assert.equal(section.includes('<div class="agent-children">'), false);
  // The old VISIBLE text-line hierarchy is retired (an aria-label carries
  // the same info now, for accessibility — not rendered as visible text).
  assert.equal(section.includes('<div class="agent-reports">'), false);
});

test('renderHtml: explicit parent -> the child card is nested (visually indented) BENEATH the parent card, not just after it in the flat grid', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orchestrator-lead', tools: [], model: 'opus', parent: null },
      { name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: 'orchestrator-lead' },
    ],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  const parentCardIdx = section.indexOf('agent-title">orchestrator-lead');
  const childrenWrapIdx = section.indexOf('agent-children');
  const childCardIdx = section.indexOf('agent-title">backend-developer');
  assert.ok(parentCardIdx !== -1 && childrenWrapIdx !== -1 && childCardIdx !== -1);
  assert.ok(parentCardIdx < childrenWrapIdx && childrenWrapIdx < childCardIdx, 'expected: parent card, then its agent-children wrapper, then the nested child card');
});

test('renderHtml: multi-level explicit nesting (3 levels deep) recurses correctly', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'root-agent', tools: [], model: 'opus', parent: null },
      { name: 'mid-agent', tools: [], model: 'sonnet', parent: 'root-agent' },
      { name: 'leaf-agent', tools: ['Read'], model: 'sonnet', parent: 'mid-agent' },
    ],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  const rootIdx = section.indexOf('agent-title">root-agent');
  const midIdx = section.indexOf('agent-title">mid-agent');
  const leafIdx = section.indexOf('agent-title">leaf-agent');
  assert.ok(rootIdx !== -1 && midIdx !== -1 && leafIdx !== -1);
  assert.ok(rootIdx < midIdx && midIdx < leafIdx, 'expected document order root -> mid -> leaf, reflecting the nesting depth');
  // Two separate levels of nesting -> two "agent-children" wrappers.
  const childrenWraps = (section.match(/class="agent-children"/g) || []).length;
  assert.equal(childrenWraps, 2);
});

// --- card width stays stable regardless of nesting depth ---------------------
// The bug: deeper cards kept shrinking because .agent-children's indentation
// (margin/padding-left) ate into a card that had no width floor of its own,
// so title/phrase/chips got squeezed into a narrower and narrower box the
// deeper the tree went. Fix: every .agent-node gets a fixed width/flex-basis
// (indentation offsets the block, never resizes it), and the tree container
// scrolls horizontally instead of squeezing cards when it runs out of room.

test('CSS: .agent-node has a fixed width/flex-basis, decoupled from nesting depth', () => {
  const html = renderHtml({ ...BASE_REPORT, agents: [{ name: 'a', tools: [], model: null, parent: null }] }, MATURITY, 'es');
  assert.match(html, /\.agent-node\{[^}]*flex:0 0 400px/);
  assert.match(html, /\.agent-node\{[^}]*width:400px/);
  // Not shrinkable to 0 (the old bug's root cause).
  assert.equal(/\.agent-node\{[^}]*min-width:0/.test(html), false);
});

// Sibling-clip fix (talents-ai-score): root siblings must WRAP, never clip.
// The horizontal scroll no longer lives on .agent-tree (which used to drag
// the wrappable root grid into a shared scroll canvas inflated by any deep
// chain, clipping the second sibling). It is scoped down to each root subtree
// owner instead.
test('CSS: root siblings wrap and are NOT in a horizontal-scroll canvas (never clip)', () => {
  const html = renderHtml({ ...BASE_REPORT, agents: [{ name: 'a', tools: [], model: null, parent: null }] }, MATURITY, 'es');
  // The root sibling grid wraps.
  assert.match(html, /\.agent-cards-grid\{[^}]*flex-wrap:wrap/);
  // The tree container no longer establishes a horizontal-scroll context for
  // the siblings — so they can never be clipped by an off-screen scroll canvas.
  assert.doesNotMatch(html, /\.agent-tree\{[^}]*overflow-x:auto/);
});

test('CSS: horizontal scroll is scoped to a root subtree owner, so ONLY deep nesting scrolls', () => {
  const html = renderHtml({ ...BASE_REPORT, agents: [{ name: 'a', tools: [], model: null, parent: null }] }, MATURITY, 'es');
  // A root node that owns children (.has-children, a direct child of the
  // grid) is the sole horizontal-scroll viewport, spanning its own row.
  assert.match(html, /\.agent-cards-grid>\.agent-node\.has-children\{[^}]*overflow-x:auto/);
  assert.match(html, /\.agent-cards-grid>\.agent-node\.has-children\{[^}]*flex-basis:100%/);
});

test('renderHtml: a root node WITH children carries the has-children scroll hook; a leaf does NOT', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'lead', tools: [], model: 'opus', parent: null },
      { name: 'child', tools: [], model: 'sonnet', parent: 'lead' },
      { name: 'loner', tools: [], model: 'sonnet', parent: null },
    ],
  };
  const section = treeSectionOf(renderHtml(report, MATURITY, 'es'));
  // The parent gets the hook; the standalone leaf never does.
  assert.match(section, /class="agent-node has-children"[\s\S]*agent-title">lead</);
  assert.match(section, /class="agent-node"[\s\S]*agent-title">loner</);
});

// Responsive audit (talents-ai-score): the page must NEVER produce a
// horizontal page scrollbar at any viewport width. The one deep-nesting case
// scrolls inside its OWN block. Three narrow-viewport guards, verified by
// real headless render at 320/360/375/520/780/1200px (body.scrollWidth ===
// viewport at every width):
//   1. ROOT cards shrink to fit a narrow viewport (width:min(400px,100%))
//      instead of holding a fixed 400px that spills past ~400px and below.
//   2. The subtree scroll owner is bulletproof (min-width:0) so a long
//      unbreakable token can't push it — and thus the page — past 100%.
//   3. A page-level overflow-x:clip guard on .wrap as a final safety net.
test('CSS: ROOT agent cards are responsive (min(400px,100%)) so they never overflow a narrow viewport', () => {
  const html = renderHtml({ ...BASE_REPORT, agents: [{ name: 'a', tools: [], model: null, parent: null }] }, MATURITY, 'es');
  assert.match(html, /\.agent-cards-grid>\.agent-node\{[^}]*width:min\(400px,100%\)/);
  // Still capped at 400 (grow:0) so on wide screens they wrap, never stretch.
  assert.match(html, /\.agent-cards-grid>\.agent-node\{[^}]*flex:0 1 400px/);
  // NESTED nodes keep the fixed base width (stable, legible deep cards).
  assert.match(html, /\.agent-node\{[^}]*width:400px/);
});

test('CSS: the subtree scroll owner has min-width:0 so it (and the page) can never be widened past 100%', () => {
  const html = renderHtml({ ...BASE_REPORT, agents: [{ name: 'a', tools: [], model: null, parent: null }] }, MATURITY, 'es');
  assert.match(html, /\.agent-cards-grid>\.agent-node\.has-children\{[^}]*min-width:0/);
  assert.match(html, /\.agent-cards-grid>\.agent-node\.has-children\{[^}]*max-width:100%/);
});

test('CSS: the report wrap carries an overflow-x:clip page-level guard (no horizontal page scrollbar, ever)', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /\.wrap\{[^}]*overflow-x:clip/);
});

test('CSS: chips wrap onto multiple lines (never one-per-line) inside a stable-width card', () => {
  const html = renderHtml({ ...BASE_REPORT, agents: [{ name: 'a', tools: [], model: null, parent: null }] }, MATURITY, 'es');
  assert.match(html, /\.agent-chips\{[^}]*flex-wrap:wrap/);
});

test('renderHtml: card width is IDENTICAL at every nesting depth (root, mid, leaf) — the actual bug from the screenshot', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'root-agent', tools: ['Read', 'Write', 'Bash'], model: 'opus', parent: null },
      { name: 'mid-agent', tools: ['Read', 'Write'], model: 'sonnet', parent: 'root-agent' },
      { name: 'leaf-agent', tools: ['Read'], model: 'sonnet', parent: 'mid-agent' },
    ],
    agentSynthesis: {
      agents: [
        { name: 'root-agent', symbolicName: 'The Conductor', whatItDoes: 'Delegates work to specialists' },
        { name: 'mid-agent', symbolicName: 'The Builder', whatItDoes: 'Implements backend endpoints' },
        { name: 'leaf-agent', symbolicName: 'The Cartographer', whatItDoes: 'Diffs schema changes against production before they land' },
      ],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  // Every .agent-node in the whole tree — root, mid, leaf alike — renders
  // from the exact same markup (no per-depth width override anywhere),
  // so there is exactly one place a width could come from: the shared
  // `.agent-node` CSS rule (asserted above), applied uniformly regardless
  // of how many `.agent-children` wrappers the node is nested inside.
  // `agent-node` may carry the ` has-children` modifier now, so match the
  // class token with a trailing boundary (quote or space), not a bare quote.
  const nodeCount = (section.match(/class="agent-node[ "]/g) || []).length;
  assert.equal(nodeCount, 3);
  // The width-bearing rule (`.agent-node{display:flex...width:400px}`) is
  // declared exactly once — distinct from the unrelated positioning rule
  // for nested rail connectors (`.agent-children .agent-node{...}`, which
  // never touches width). No depth-specific override exists anywhere.
  const widthRuleCount = (html.match(/\.agent-node\{display:flex[^}]*width:400px/g) || []).length;
  assert.equal(widthRuleCount, 1, 'expected a single, depth-independent .agent-node width rule');
});

test('renderHtml: dangling/self parent reference falls back to the implicit root, defensively, never throws', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orphan', tools: [], model: 'sonnet', parent: 'does-not-exist' },
      { name: 'self-parent', tools: [], model: 'sonnet', parent: 'self-parent' },
    ],
  };
  assert.doesNotThrow(() => renderHtml(report, MATURITY, 'es'));
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /orphan/);
  assert.match(section, /self-parent/);
});

// --- accessibility: the visual nesting still carries a machine-readable relation ---

test('renderHtml: each card carries an aria-label describing what it reports to, for screen readers', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orchestrator-lead', tools: [], model: 'opus', parent: null },
      { name: 'backend-developer', tools: [], model: 'sonnet', parent: 'orchestrator-lead' },
    ],
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /aria-label="orchestrator-lead\. Reporta a: Orchestrator"/);
  assert.match(html, /aria-label="backend-developer\. Reporta a: orchestrator-lead"/);
});

// --- never invents data not present in the report ----------------------------

test('renderHtml: never renders maturity/human-judgment/evidence/ontology framing the report has no data for', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null }],
    agentSynthesis: {
      agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  for (const forbidden of [/L1\b/, /L2\b/, /human judgment/i, /evidence/i, /edit ontology/i]) {
    assert.doesNotMatch(html, forbidden);
  }
});

test('renderHtml: never includes agent description content in the tree, even if it slipped onto the object', () => {
  const secretMarker = 'PROJECT-CODENAME-DO-NOT-LEAK';
  const report = {
    ...BASE_REPORT,
    agents: [{
      name: 'leaky-agent',
      tools: ['Read'],
      model: 'sonnet',
      parent: null,
      description: `Confidential client details: ${secretMarker}`,
    }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.equal(treeSectionOf(html).includes(secretMarker), false);
});

// --- zero-network, no vendored Mermaid anymore -------------------------------

test('renderHtml: no vendored library, no Mermaid references anywhere — pure HTML/CSS, still zero-network', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read', 'Write', 'Bash'], model: 'sonnet', parent: null }],
    agentSynthesis: {
      agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.equal(/mermaid/i.test(html), false);
  // The report's existing small animation script (fill bar / row stagger)
  // predates this feature and stays — that's not a network call either way.
  // What must be gone is the ~3.2MB vendored library payload.
  assert.ok(html.length < 200_000, `expected a lightweight report (no vendored library), got ${html.length} bytes`);
});

test('renderHtml: works in English too', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orchestrator-lead', tools: [], model: 'opus', parent: null },
      { name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: 'orchestrator-lead' },
    ],
    agentSynthesis: { agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes code' }], edges: [] },
  };
  const html = renderHtml(report, MATURITY, 'en');
  assert.match(html, /Agents/);
  assert.match(html, /agent-root-header">Orchestrator</);
  assert.match(html, /The Builder/);
});
