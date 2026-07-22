'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { requestGraphInference, makeGraphInferLlm, GRAPH_INFER_PROMPT_VERSION } = require('../src/graph-infer-client');
const { generateGraph } = require('../src/graph-generator');

// Mirrors the REAL backend DTO validation (InferGraphInputDto):
//   - summary: @IsObject()            -> 400 if not a plain object
//   - promptVersion: @IsIn(ACCEPTED)  -> 400 if unknown
// Keeping the stub's rule identical to the DTO is what stops the stub↔DTO
// drift that bit us before. ACCEPTED must include the client's frozen version.
const ACCEPTED_PROMPT_VERSIONS = ['graph-infer-v1'];

function startStub({ handler } = {}) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let dto;
      try { dto = JSON.parse(body); } catch { res.writeHead(400).end('{}'); return; }
      // DTO validation, mirrored
      if (!dto || typeof dto.summary !== 'object' || Array.isArray(dto.summary) || dto.summary == null) {
        res.writeHead(400).end(JSON.stringify({ message: 'summary must be an object' }));
        return;
      }
      if (typeof dto.promptVersion !== 'string' || !ACCEPTED_PROMPT_VERSIONS.includes(dto.promptVersion)) {
        res.writeHead(400).end(JSON.stringify({ message: 'unknown promptVersion' }));
        return;
      }
      if (handler) return handler(dto, res);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        nodes: [{ id: 'svc', label: 'Svc', kind: 'service' }],
        edges: [{ from: 'svc', to: 'postgres', kind: 'writes' }],
      }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ server, url: `http://127.0.0.1:${port}/graph-inference` });
  }));
}

test('client frozen promptVersion is in the backend accepted set (DTO alignment)', () => {
  assert.equal(GRAPH_INFER_PROMPT_VERSION, 'graph-infer-v1');
  assert.ok(ACCEPTED_PROMPT_VERSIONS.includes(GRAPH_INFER_PROMPT_VERSION));
});

test('requestGraphInference sends {summary,promptVersion} the DTO accepts and returns the delta', async () => {
  let seen = null;
  const { server, url } = await startStub({
    handler: (dto, res) => {
      seen = dto;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ nodes: [{ id: 'x', label: 'X', kind: 'service' }], edges: [] }));
    },
  });
  try {
    const out = await requestGraphInference({ project: { name: 'p', slug: 'p' }, nodes: [], detectedEdges: [], hints: {} }, { endpoint: url });
    assert.deepEqual(out.nodes, [{ id: 'x', label: 'X', kind: 'service' }]);
    assert.equal(seen.promptVersion, 'graph-infer-v1');
    assert.equal(typeof seen.summary, 'object');
  } finally { server.close(); }
});

test('resilience: non-2xx / bad json / no endpoint all resolve to null', async () => {
  assert.equal(await requestGraphInference({ a: 1 }, { endpoint: '' }), null);
  const bad = await startStub({ handler: (_d, res) => { res.writeHead(500).end('nope'); } });
  try { assert.equal(await requestGraphInference({ x: 1 }, { endpoint: bad.url }), null); } finally { bad.server.close(); }
  const junk = await startStub({ handler: (_d, res) => { res.writeHead(200).end('not json'); } });
  try { assert.equal(await requestGraphInference({ x: 1 }, { endpoint: junk.url }), null); } finally { junk.server.close(); }
});

test('makeGraphInferLlm enriches generateGraph; endpoint failure degrades to deterministic', async () => {
  const scan = {
    project: { name: 'p', slug: 'p' },
    models: [{ id: 'gemini', label: 'Gemini', domain: 'gemini.google.com' }],
    agents: [{ id: 'a', label: 'Agent', model: 'gemini' }],
    integrations: [], tools: [], technologies: [], stores: ['postgresql'],
  };
  // enrich: add a store node + edge referencing the deterministic agent
  const { server, url } = await startStub({
    handler: (_d, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ nodes: [{ id: 'postgres', label: 'PostgreSQL', kind: 'store' }], edges: [{ from: 'a', to: 'postgres', kind: 'writes' }] }));
    },
  });
  try {
    const llm = makeGraphInferLlm({ endpoint: url });
    const out = await generateGraph({ scan, llm });
    assert.ok(out.graph.nodes.some((n) => n.id === 'postgres' && n.kind === 'store'), 'LLM store node merged');
    assert.ok(out.graph.edges.some((e) => e.from === 'a' && e.to === 'postgres' && e.kind === 'writes'), 'enrichment edge merged');
  } finally { server.close(); }

  // endpoint down -> degrade to deterministic (agent + model + calls edge only)
  const llmDown = makeGraphInferLlm({ endpoint: 'http://127.0.0.1:1/graph-inference' });
  const degraded = await generateGraph({ scan, llm: llmDown });
  assert.ok(degraded.graph.nodes.some((n) => n.id === 'a' && n.kind === 'agent'));
  assert.ok(!degraded.graph.nodes.some((n) => n.kind === 'store'), 'no fabricated nodes when enrichment fails');
});
