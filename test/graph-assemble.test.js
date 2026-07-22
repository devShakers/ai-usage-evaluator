'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assembleContract } = require('../src/graph-assemble');

test('assembleContract validates kinds, drops dangling edges/dups, derives stats + topX', () => {
  const project = { name: 'Demo', slug: 'demo', tagline: 't' };
  const graph = {
    nodes: [
      { id: 'hub', label: 'Hub API', kind: 'entry' },
      { id: 'svc', label: 'Billing', kind: 'service', group: 'Billing' },
      { id: 'a', label: 'Cert agent', kind: 'agent' },
      { id: 'gem', label: 'Gemini', kind: 'model', domain: 'gemini.google.com' },
      { id: 'hs', label: 'HubSpot', kind: 'external', domain: 'hubspot.com' },
      { id: 'pg', label: 'Postgres', kind: 'store', domain: 'postgresql.org' },
      { id: 'a', label: 'dup', kind: 'agent' },       // duplicate id -> dropped
      { id: 'bad', label: 'nope', kind: 'nonsense' },  // invalid kind -> dropped
    ],
    edges: [
      { from: 'hub', to: 'svc', kind: 'triggers' },
      { from: 'svc', to: 'a', kind: 'triggers' },
      { from: 'a', to: 'gem', kind: 'calls' },
      { from: 'svc', to: 'pg', kind: 'writes', label: 'save' },
      { from: 'svc', to: 'ghost', kind: 'reads' },     // dangling -> dropped
      { from: 'svc', to: 'svc', kind: 'calls' },        // self -> dropped
    ],
  };
  const out = assembleContract(project, graph);
  assert.equal(out.version, 1);
  assert.equal(out.project.slug, 'demo');
  const ids = out.graph.nodes.map((n) => n.id);
  assert.ok(!ids.includes('bad'));
  assert.equal(ids.filter((i) => i === 'a').length, 1);
  assert.ok(!out.graph.edges.some((e) => e.to === 'ghost'));
  assert.ok(!out.graph.edges.some((e) => e.from === e.to));
  assert.deepEqual(out.stats, { agents: 1, models: 1, tools: 0, integrations: 1 });
  assert.deepEqual(out.topModels, [{ id: 'gem', label: 'Gemini', domain: 'gemini.google.com' }]);
  assert.deepEqual(out.topIntegrations, [{ id: 'hs', label: 'HubSpot', domain: 'hubspot.com' }]);
});

test('assembleContract returns null when there are no usable nodes (caller degrades)', () => {
  assert.equal(assembleContract({ name: 'x', slug: 'x' }, { nodes: [], edges: [] }), null);
  assert.equal(assembleContract({ name: 'x', slug: 'x' }, { nodes: [{ kind: 'bogus' }], edges: [] }), null);
});
