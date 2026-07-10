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

test('renderHtml: agents without synthesis -> title is the real name, chips are tools+model, no phrase/badge', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read', 'Write'], model: 'sonnet', parent: null }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = treeSectionOf(html);
  assert.match(section, /agent-title">backend-developer</);
  assert.equal(section.includes('agent-badge'), false);
  assert.equal(section.includes('agent-phrase'), false);
  assert.match(section, /Read/);
  assert.match(section, /Write/);
  assert.match(section, /sonnet/);
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
  assert.match(html, /\.agent-node\{[^}]*flex:0 0 328px/);
  assert.match(html, /\.agent-node\{[^}]*width:328px/);
  // Not shrinkable to 0 (the old bug's root cause).
  assert.equal(/\.agent-node\{[^}]*min-width:0/.test(html), false);
});

test('CSS: the tree container scrolls horizontally instead of squeezing cards when it runs out of room', () => {
  const html = renderHtml({ ...BASE_REPORT, agents: [{ name: 'a', tools: [], model: null, parent: null }] }, MATURITY, 'es');
  assert.match(html, /\.agent-tree\{[^}]*overflow-x:auto/);
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
  const nodeCount = (section.match(/class="agent-node"/g) || []).length;
  assert.equal(nodeCount, 3);
  // The width-bearing rule (`.agent-node{display:flex...width:328px}`) is
  // declared exactly once — distinct from the unrelated positioning rule
  // for nested rail connectors (`.agent-children .agent-node{...}`, which
  // never touches width). No depth-specific override exists anywhere.
  const widthRuleCount = (html.match(/\.agent-node\{display:flex[^}]*width:328px/g) || []).length;
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
