'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGraphScan, modelNode, slug } = require('../src/graph-scan');
const { generateGraph } = require('../src/graph-generator');

// Fake detectors so the adapter is tested without touching the filesystem.
function fakeScan() {
  return ({ root }) => ({
    root,
    agents: [
      { name: 'Orchestrator', model: 'claude-opus-4', parent: null, aiProduct: 'Claude Code', tools: ['Read'] },
      { name: 'Reviewer', model: 'claude-haiku-4-5', parent: 'Orchestrator', aiProduct: 'Claude Code' },
      { name: 'Planner', model: 'gemini-2.5-flash', parent: 'Orchestrator', aiProduct: 'Gemini CLI' },
    ],
    technologies: ['NestJS', 'Prisma', 'PostgreSQL'],
    tools: { 'claude-code': { installed: true }, cursor: { installed: false } },
  });
}
function fakeClassify() {
  return () => ({
    level: 4, key: 'orchestrator', name: 'Orquestador', score: 82,
    tier: 6, tierKey: 'T6', tierName: 'Multi-agente',
    setupLevel: { key: 'S3', code: 'S3', rank: 3, emoji: '●' }, // T6 -> S3
  });
}

test('adapter maps agents, derives models, resolves parent hierarchy', () => {
  const { scan } = buildGraphScan('/tmp/my-project', { scanFn: fakeScan(), classifyFn: fakeClassify() });
  assert.equal(scan.project.slug, 'my-project');
  assert.equal(scan.agents.length, 3);
  // models are per-EXACT-id (opus + haiku + gemini) — never collapsed to a vendor family
  const modelIds = scan.models.map((m) => m.id).sort();
  assert.deepEqual(modelIds, ['claude-haiku-4-5', 'claude-opus-4', 'gemini-2.5-flash']);
  const rev = scan.agents.find((a) => a.id === 'reviewer');
  assert.equal(rev.model, 'claude-haiku-4-5');
  assert.equal(rev.parent, 'orchestrator');
  // store hint derived from Prisma/Postgres tech
  assert.ok(scan.stores.includes('postgresql'));
  // no private helper field leaks
  assert.ok(!('_parentName' in rev));
});

test('footprint drawer is built from the live maturity + technologies (#3)', () => {
  const { footprint } = buildGraphScan('/tmp/p', { scanFn: fakeScan(), classifyFn: fakeClassify() });
  // ADR-016: Setup Level (S3) is the drawer's headline rollup; tier chip carries T6.
  assert.equal(footprint.setup.key, 'S3');
  assert.equal(footprint.setup.rank, 3);
  assert.equal(footprint.tier.key, 'T6');
  assert.equal(footprint.tier.name, 'Multi-agente');
  assert.equal(footprint.score, 82);
  assert.ok(footprint.technologies.includes('Prisma'));
  assert.ok(footprint.tools.includes('Claude Code'));
  assert.ok(!footprint.tools.includes('Cursor')); // not installed
  assert.equal(footprint.ladder.length, 4); // Not certified + S1/S2/S3
});

test('generateGraph over the adapter scan emits calls + hierarchy triggers edges', async () => {
  const { scan } = buildGraphScan('/tmp/p', { scanFn: fakeScan(), classifyFn: fakeClassify() });
  const out = await generateGraph({ scan, llm: null });
  // agent -> model calls
  assert.ok(out.graph.edges.some((e) => e.from === 'reviewer' && e.to === 'claude-haiku-4-5' && e.kind === 'calls'));
  assert.ok(out.graph.edges.some((e) => e.from === 'planner' && e.to === 'gemini-2.5-flash' && e.kind === 'calls'));
  // orchestrator -> subagent triggers (hierarchy)
  assert.ok(out.graph.edges.some((e) => e.from === 'orchestrator' && e.to === 'reviewer' && e.kind === 'triggers'));
  assert.ok(out.graph.edges.some((e) => e.from === 'orchestrator' && e.to === 'planner' && e.kind === 'triggers'));
  // agents + models present as nodes with correct kinds
  assert.equal(out.graph.nodes.find((n) => n.id === 'orchestrator').kind, 'agent');
  assert.equal(out.graph.nodes.find((n) => n.id === 'claude-haiku-4-5').kind, 'model');
});

test('modelNode resolves EXACT ids: aliases, exact ids, inherit, and provider domains', () => {
  // Bare Claude aliases → current exact ids.
  assert.equal(modelNode('opus').id, 'claude-opus-4-8');
  assert.equal(modelNode('sonnet').id, 'claude-sonnet-5');
  assert.equal(modelNode('haiku').id, 'claude-haiku-4-5-20251001');
  // Already-qualified ids kept verbatim (keyed by exact id).
  assert.equal(modelNode('gemini-2.5-pro').id, 'gemini-2.5-pro');
  assert.equal(modelNode('gemini-2.5-pro').domain, 'gemini.google.com');
  assert.equal(modelNode('claude-sonnet-5').domain, 'claude.ai');
  assert.equal(modelNode('gpt-4o').domain, 'openai.com');
  // Honest on inherit / missing — no fabricated id.
  assert.equal(modelNode('inherit').id, 'inherit');
  assert.equal(modelNode('inherit').domain, null);
  assert.equal(modelNode(''), null);
  assert.equal(modelNode(undefined), null);
  assert.equal(slug('My Cool Agent!'), 'my-cool-agent');
});
