'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateGraph,
  assembleDeterministic,
  buildScrubbedSummary,
  mergeEnrichment,
  scrubString,
  CAPS,
} = require('../src/graph-generator');

function sampleScan() {
  return {
    project: { name: 'Demo Backend', slug: 'demo-backend', tagline: 'x', iconDomain: 'demo.com' },
    models: [
      { id: 'gemini-flash', label: 'Gemini 2.5 Flash', domain: 'gemini.google.com' },
      { id: 'haiku', label: 'Claude Haiku 4.5', domain: 'claude.ai' },
    ],
    tools: [{ id: 'shakers-ai', label: 'shakers-ai-api' }],
    integrations: [
      { id: 'hubspot', label: 'HubSpot', domain: 'hubspot.com' },
      { id: 'slack', label: 'Slack', domain: 'slack.com' },
    ],
    agents: [
      { id: 'cert', label: 'Skill cert', model: 'gemini-flash', group: 'AI', sourceRef: 'src/cert.ts:1' },
      { id: 'chat', label: 'Chat', toolId: 'shakers-ai' },
    ],
    entrypoints: ['src/apps/hub/'],
    stores: ['postgres'],
    technologies: ['NestJS', 'Prisma'],
  };
}

// A deterministic stub standing in for the real Gemini pass.
function stubLLM(enrichment, opts = {}) {
  return {
    model: opts.model || 'gemini-2.5-flash',
    async inferGraph() {
      return {
        ...enrichment,
        __model: opts.model || 'gemini-2.5-flash',
        __inputTokens: 123,
        __outputTokens: 45,
        __costUsd: 0.0001,
      };
    },
  };
}

test('deterministic assembly maps kinds, call edges, stats and topX', () => {
  const base = assembleDeterministic(sampleScan());
  const byId = Object.fromEntries(base.nodes.map((n) => [n.id, n]));
  assert.equal(byId['gemini-flash'].kind, 'model');
  assert.equal(byId['shakers-ai'].kind, 'tool');
  assert.equal(byId['hubspot'].kind, 'external');
  assert.equal(byId['cert'].kind, 'agent');
  // agent -> model|tool calls edges
  assert.ok(base.edges.some((e) => e.from === 'cert' && e.to === 'gemini-flash' && e.kind === 'calls'));
  assert.ok(base.edges.some((e) => e.from === 'chat' && e.to === 'shakers-ai' && e.kind === 'calls'));
  assert.deepEqual(base.stats, { agents: 2, models: 2, tools: 1, integrations: 2 });
  assert.equal(base.topModels.length, 2);
});

test('LLM enrichment adds service/store/entry + edges; deterministic stays authoritative', async () => {
  const enrichment = {
    nodes: [
      { id: 'hub-api', label: 'Hub API', kind: 'entry' },
      { id: 'svc', label: 'Certs service', kind: 'service' },
      { id: 'postgres', label: 'PostgreSQL', kind: 'store' },
      // illegal: cannot introduce an agent, cannot override a model's kind
      { id: 'ghost-agent', label: 'ghost', kind: 'agent' },
      { id: 'gemini-flash', label: 'Gemini', kind: 'store' },
    ],
    edges: [
      { from: 'hub-api', to: 'svc', kind: 'triggers' },
      { from: 'svc', to: 'cert', kind: 'triggers' },
      { from: 'svc', to: 'postgres', kind: 'writes', label: 'save' },
      // illegal: endpoint does not exist -> dropped
      { from: 'svc', to: 'nowhere', kind: 'reads' },
    ],
  };
  const out = await generateGraph({ scan: sampleScan(), llm: stubLLM(enrichment) });
  const ids = new Set(out.graph.nodes.map((n) => n.id));
  assert.ok(ids.has('hub-api') && ids.has('svc') && ids.has('postgres'));
  assert.ok(!ids.has('ghost-agent'), 'LLM must not introduce agent nodes');
  // model kind must NOT be overridden by the LLM
  assert.equal(out.graph.nodes.find((n) => n.id === 'gemini-flash').kind, 'model');
  // valid enrichment edges present, dangling edge dropped
  assert.ok(out.graph.edges.some((e) => e.from === 'svc' && e.to === 'postgres' && e.kind === 'writes'));
  assert.ok(!out.graph.edges.some((e) => e.to === 'nowhere'));
});

test('scrubbed summary is content-free and redacts secrets', () => {
  const scan = sampleScan();
  scan.project.name = 'Demo token=ghp_ABCDEFGHIJKLMNOP1234567890 secret';
  scan.agents[0].sourceRef = 'src/x.ts?apikey=sk_live_ABCDEFGHIJKLMNOPQRSTUV';
  const base = assembleDeterministic(scan);
  const summary = buildScrubbedSummary(scan, base);
  const blob = JSON.stringify(summary);
  assert.ok(!/ghp_[A-Za-z0-9]/.test(blob), 'GitHub token must be redacted');
  assert.ok(!/sk_live_[A-Za-z0-9]/.test(blob), 'secret key must be redacted');
  // summary only carries structural keys, never source contents
  assert.deepEqual(Object.keys(summary).sort(), ['detectedEdges', 'hints', 'nodes', 'project']);
  assert.ok(scrubString('password: hunter2') !== 'password: hunter2');
});

test('caps are enforced (nodes <= 60, edges <= 120)', async () => {
  const scan = sampleScan();
  // flood with LLM services + a fully-connected-ish set of edges
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 200; i++) nodes.push({ id: 'svc' + i, label: 'S' + i, kind: 'service' });
  for (let i = 0; i < 200; i++) edges.push({ from: 'svc' + i, to: 'svc' + ((i + 1) % 200), kind: 'triggers' });
  const out = await generateGraph({ scan, llm: stubLLM({ nodes, edges }) });
  assert.ok(out.graph.nodes.length <= CAPS.nodes, 'nodes capped');
  assert.ok(out.graph.edges.length <= CAPS.edges, 'edges capped');
});

test('instrumentation is emitted content-free; LLM failure degrades gracefully', async () => {
  const traces = [];
  const okOut = await generateGraph({ scan: sampleScan(), llm: stubLLM({ nodes: [], edges: [] }), onTrace: (e) => traces.push(e) });
  assert.equal(traces.length, 1);
  assert.equal(traces[0].event, 'graph.infer');
  assert.equal(traces[0].ok, true);
  assert.equal(traces[0].contentFree, true);
  assert.equal(traces[0].model, 'gemini-2.5-flash');
  assert.ok(!('content' in traces[0]) && !('prompt' in traces[0]));
  assert.ok(okOut.graph.nodes.length >= 5);

  const failTraces = [];
  const failLLM = { model: 'gemini-2.5-flash', async inferGraph() { throw new Error('boom'); } };
  const degraded = await generateGraph({ scan: sampleScan(), llm: failLLM, onTrace: (e) => failTraces.push(e) });
  assert.equal(failTraces[0].ok, false);
  // deterministic graph still returned
  assert.ok(degraded.graph.nodes.some((n) => n.kind === 'agent'));
});

test('generateGraph output matches the foglamp contract envelope', async () => {
  const out = await generateGraph({ scan: sampleScan(), llm: null });
  assert.equal(out.version, 1);
  assert.equal(out.project.slug, 'demo-backend');
  assert.ok(out.project.date && /^\d{4}-\d{2}-\d{2}$/.test(out.project.date));
  assert.ok(Array.isArray(out.topModels) && out.topModels.length <= CAPS.topModels);
  assert.ok(Array.isArray(out.graph.nodes) && Array.isArray(out.graph.edges));
});
