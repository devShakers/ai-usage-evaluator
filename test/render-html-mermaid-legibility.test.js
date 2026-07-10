'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score, post-ADR-010 legibility fix: the first cut of the agent
 * diagram rendered as an illegible horizontal strip of tiny, disconnected,
 * low-contrast cards whenever the synthesis returned `edges: []` (every
 * agent with `parent: null`). Fixes verified here:
 *   1. Implicit "Orchestrator" root when no edges are declared (mirrors the
 *      deterministic org chart, ADR-009) — always a real tree.
 *   2. Node label = symbolic name + real name ONLY; `whatItDoes` moves to a
 *      caption list below the diagram, keyed by symbolic name.
 *   3. Legible sizing (min/max-height + scroll, `useMaxWidth: false`) and a
 *      theme picked from `prefers-color-scheme` for dark-mode contrast.
 *   4. Direction heuristic (TD normally, LR with many agents).
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

function diagramSectionOf(html) {
  const start = html.indexOf('<div class="card diagram-wrap">');
  const end = html.indexOf('</section>', start);
  assert.ok(start !== -1, 'expected a diagram-wrap section');
  return html.slice(start, end);
}

// --- 1. implicit root when no edges declared --------------------------------

test('buildMermaidSource (via renderHtml): no edges declared -> injects an implicit Orchestrator root connected to every agent', () => {
  const report = {
    ...BASE_REPORT,
    agentSynthesis: {
      agents: [
        { name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' },
        { name: 'reviewer', symbolicName: 'The Reviewer', whatItDoes: 'Reviews PRs' },
        { name: 'qa-tester', symbolicName: 'The Tester', whatItDoes: 'Writes tests' },
      ],
      edges: [], // every agent came back with parent: null
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = diagramSectionOf(html);
  assert.match(section, /Orchestrator/);
  // Every agent gets an edge FROM the implicit root.
  const arrowCount = (section.match(/--&gt;/g) || []).length;
  assert.equal(arrowCount, 3, 'expected one edge from the root to each of the 3 agents');
});

test('buildMermaidSource (via renderHtml): explicit edges provided -> no implicit root injected', () => {
  const report = {
    ...BASE_REPORT,
    agentSynthesis: {
      agents: [
        { name: 'orchestrator', symbolicName: 'The Conductor', whatItDoes: 'Coordinates' },
        { name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' },
      ],
      edges: [{ from: 'orchestrator', to: 'backend-developer' }],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = diagramSectionOf(html);
  assert.equal(section.includes('Orchestrator'), false, 'should not inject a SECOND, implicit root when real edges exist');
  const arrowCount = (section.match(/--&gt;/g) || []).length;
  assert.equal(arrowCount, 1);
});

// --- 2. node label excludes whatItDoes; legend carries it --------------------

test('diagram node label carries only the symbolic + real name; whatItDoes lives in the legend below, not squeezed into the node', () => {
  const longDescription = 'Writes backend endpoints, designs the data model, and reviews migrations end to end';
  const report = {
    ...BASE_REPORT,
    agentSynthesis: {
      agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: longDescription }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const section = diagramSectionOf(html);

  const mermaidSourceStart = section.indexOf('<pre class="mermaid">');
  const mermaidSourceEnd = section.indexOf('</pre>');
  const mermaidSource = section.slice(mermaidSourceStart, mermaidSourceEnd);
  assert.equal(mermaidSource.includes(longDescription), false, 'whatItDoes must not be inside the node/diagram source');
  assert.match(mermaidSource, /The Builder/);
  assert.match(mermaidSource, /backend-developer/);

  // The legend, right after the diagram, carries the full description.
  assert.match(section, /diagram-legend/);
  assert.match(section, new RegExp(longDescription));
});

// --- 3. sizing + theme -------------------------------------------------------

test('diagram container has real sizing (min/max-height + scroll), not a collapsed strip', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /\.diagram-wrap\{[^}]*min-height:280px/);
  assert.match(html, /\.diagram-wrap\{[^}]*max-height:70vh/);
  assert.match(html, /\.diagram-wrap\{[^}]*overflow:auto/);
});

test('mermaid.initialize picks a theme from prefers-color-scheme and disables forced shrink-to-fit', () => {
  const report = {
    ...BASE_REPORT,
    agentSynthesis: { agents: [{ name: 'a', symbolicName: 'A', whatItDoes: 'x' }], edges: [] },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(html, /theme:\s*prefersDark\s*\?\s*'dark'\s*:\s*'default'/);
  assert.match(html, /useMaxWidth:\s*false/);
});

// --- 4. direction heuristic ---------------------------------------------------

test('diagram direction: TD for a handful of agents', () => {
  const report = {
    ...BASE_REPORT,
    agentSynthesis: {
      agents: [1, 2, 3].map((i) => ({ name: `agent-${i}`, symbolicName: `Agent ${i}`, whatItDoes: 'x' })),
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(diagramSectionOf(html), /flowchart TD/);
});

test('diagram direction: LR when there are many agents', () => {
  const report = {
    ...BASE_REPORT,
    agentSynthesis: {
      agents: Array.from({ length: 9 }, (_, i) => ({ name: `agent-${i}`, symbolicName: `Agent ${i}`, whatItDoes: 'x' })),
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(diagramSectionOf(html), /flowchart LR/);
});
