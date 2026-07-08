'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score, issue 009 (ADR-009): the local HTML report renders the
 * deterministic agent org chart (nodes = agents, tools/model per node,
 * hierarchy). Structure + names only — the same invariant as the parser and
 * the payload: descriptions/prompts are never part of `report.agents`, so
 * they can't leak into the HTML either, but we assert it here too as a
 * belt-and-suspenders check on the render layer itself.
 */

const BASE_REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-08T00:00:00.000Z',
  anonId: 'anon123',
  platform: 'darwin',
  environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v20.0.0', editorsInstalled: [] },
  summary: { totalDetected: 1, categories: ['AGENTIC_CLI'] },
  tools: [{ id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', category: 'CLI agéntica', detected: true, depth: {}, signalCount: 1, footprint: null, recency: {}, version: null }],
  agents: [],
  agentCounts: { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
};

const MATURITY = { level: 2, key: 'integrated', name: 'Integrado', score: 40, emoji: '🧭', next: 'siguiente paso' };

test('renderHtml: no agents detected -> renders the org chart section with an empty state, never throws', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /organigrama/i);
  assert.doesNotThrow(() => renderHtml(BASE_REPORT, MATURITY, 'en'));
});

test('renderHtml: renders each agent as a node with its name, tools and model', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'backend-developer', tools: ['Read', 'Write', 'Bash'], model: 'sonnet', parent: null },
      { name: 'reviewer', tools: ['Read'], model: 'opus', parent: null },
    ],
    agentCounts: { agents: 2, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /backend-developer/);
  assert.match(html, /reviewer/);
  assert.match(html, /Read/);
  assert.match(html, /Write/);
  assert.match(html, /Bash/);
  assert.match(html, /sonnet/);
  assert.match(html, /opus/);
});

test('renderHtml: renders hierarchy — a subagent with an explicit parent nests under its orchestrator node', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orchestrator', tools: [], model: 'opus', parent: null },
      { name: 'subagent', tools: ['Read'], model: 'sonnet', parent: 'orchestrator' },
    ],
    agentCounts: { agents: 2, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  };
  const html = renderHtml(report, MATURITY, 'es');
  const orchestratorIdx = html.indexOf('orchestrator');
  const subagentIdx = html.indexOf('subagent');
  assert.ok(orchestratorIdx !== -1 && subagentIdx !== -1);
  assert.ok(subagentIdx > orchestratorIdx, 'subagent node should be nested after its parent node in the markup');
});

// The "view raw JSON" debug section at the footer intentionally mirrors the
// FULL local report object as-is (existing, deliberate transparency feature,
// unrelated to this issue) — so this test scopes its assertion to the
// org-chart SECTION itself (the rendered node/cards), which is the surface
// this issue actually adds and which must never echo `description` even if
// an unexpected extra field slipped onto an agent object.
function orgChartSectionHtml(html) {
  const start = html.indexOf('org-tree');
  const end = html.indexOf('</section>', start);
  assert.ok(start !== -1, 'expected an org-tree section in the rendered HTML');
  return html.slice(start, end === -1 ? undefined : end);
}

test('renderHtml: the org-chart section never includes agent description content, even if it slipped onto the object', () => {
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
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.equal(orgChartSectionHtml(html).includes(secretMarker), false);
});

test('renderHtml: works in English too', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  };
  const html = renderHtml(report, MATURITY, 'en');
  assert.match(html, /org chart/i);
  assert.match(html, /backend-developer/);
});

test('renderHtml: missing report.agents (report predating ADR-009) does not throw, renders empty state', () => {
  const { agents, ...reportWithoutAgents } = BASE_REPORT;
  assert.doesNotThrow(() => renderHtml(reportWithoutAgents, MATURITY, 'es'));
});
