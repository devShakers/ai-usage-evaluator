'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score, post-ADR-010 pivot: Mermaid (a graph) turned out
 * illegible even after tuning (sizing/theme/implicit hierarchy) — the user
 * wants clear, LARGE role cards instead, Mermaid or not. This replaces the
 * Mermaid diagram with a pure HTML/CSS card grid: no vendored library, no
 * `<script>`, zero-network by construction.
 *
 * Data mapping under test (never invented, only fields the report has):
 *   title = symbolicName (if synthesis exists this run) else the real name
 *   badge = the real (structural) agent name — always present when a
 *           symbolic title is shown
 *   phrase = whatItDoes (only when synthesis exists)
 *   chips  = tools[] + one chip for model (ADR-009 structural data, never
 *            depends on synthesis)
 *   "Reports to: <parent>" or "...Orchestrator" when no parent declared
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

// NOTE: the CSS block also contains the literal string "agent-cards-grid"
// (the `.agent-cards-grid{...}` selector), so lookups below always search
// for the actual element markup (`<div class="agent-cards-grid">`), never
// a bare substring match that would collide with the stylesheet.
function cardsSectionOf(html) {
  const start = html.indexOf('<div class="agent-cards-grid">');
  assert.ok(start !== -1, 'expected an agent-cards-grid element');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

// --- no agents at all --------------------------------------------------------

test('renderHtml: no agents -> renders an empty state, never throws, no cards grid', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /Agentes/);
  assert.equal(html.includes('<div class="agent-cards-grid">'), false);
});

// --- fallback: agents present, no synthesis ----------------------------------

test('renderHtml: agents without synthesis -> title is the real name, chips are tools+model, no phrase/badge', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read', 'Write'], model: 'sonnet', parent: null }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = cardsSectionOf(html);
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
  const section = cardsSectionOf(html);
  assert.match(section, /agent-title">The Builder</);
  assert.match(section, /agent-badge[^>]*>backend-developer</);
  assert.match(section, /agent-phrase">Writes backend code end to end</);
});

test('renderHtml: only SOME agents have a synthesis match -> the rest fall back individually within the same grid', () => {
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
  const section = cardsSectionOf(html);
  assert.match(section, /The Builder/);
  assert.match(section, /agent-title">reviewer</); // no synthesis match -> falls back to real name
});

// --- hierarchy: "Reports to: ..." --------------------------------------------

test('renderHtml: no parent declared -> "Reports to: Orchestrator" (mirrors the implicit root, ADR-009)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: [], model: null, parent: null }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(cardsSectionOf(html), /Reporta a:\s*Orchestrator/);
});

test('renderHtml: explicit parent declared -> "Reports to: <parent>"', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orchestrator', tools: [], model: 'opus', parent: null },
      { name: 'backend-developer', tools: [], model: 'sonnet', parent: 'orchestrator' },
    ],
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(cardsSectionOf(html), /Reporta a:\s*orchestrator/);
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
    agents: [{ name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null }],
    agentSynthesis: { agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes code' }], edges: [] },
  };
  const html = renderHtml(report, MATURITY, 'en');
  assert.match(html, /Agents/);
  assert.match(html, /Reports to:\s*Orchestrator/);
  assert.match(html, /The Builder/);
});
