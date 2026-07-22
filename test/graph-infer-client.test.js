'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { analyzeCodebase, makeCodebaseAnalyzer, ANALYZE_PROMPT_VERSION } = require('../src/graph-infer-client');

// Mirrors the REAL backend DTO validation (InferGraphInputDto):
//   - context: @IsObject()            -> 400 if not a plain object
//   - promptVersion: @IsIn(ACCEPTED)  -> 400 if unknown
// Keeping the stub's rule identical to the DTO is what stops stub↔DTO drift.
const ACCEPTED_PROMPT_VERSIONS = ['codebase-analyze-v1', 'graph-infer-v1'];

function startStub({ handler } = {}) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let dto;
      try { dto = JSON.parse(body); } catch { res.writeHead(400).end('{}'); return; }
      if (!dto || typeof dto.context !== 'object' || Array.isArray(dto.context) || dto.context == null) {
        res.writeHead(400).end(JSON.stringify({ message: 'context must be an object' })); return;
      }
      if (typeof dto.promptVersion !== 'string' || !ACCEPTED_PROMPT_VERSIONS.includes(dto.promptVersion)) {
        res.writeHead(400).end(JSON.stringify({ message: 'unknown promptVersion' })); return;
      }
      if (handler) return handler(dto, res);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ nodes: [{ id: 'svc', label: 'Svc', kind: 'service' }], edges: [] }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/graph-inference` })));
}

test('client frozen promptVersion is in the backend accepted set (DTO alignment)', () => {
  assert.equal(ANALYZE_PROMPT_VERSION, 'codebase-analyze-v1');
  assert.ok(ACCEPTED_PROMPT_VERSIONS.includes(ANALYZE_PROMPT_VERSION));
});

test('analyzeCodebase sends {context,promptVersion} the DTO accepts and returns the graph', async () => {
  let seen = null;
  const { server, url } = await startStub({
    handler: (dto, res) => {
      seen = dto;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ nodes: [{ id: 'hub', label: 'Hub API', kind: 'entry' }, { id: 'm', label: 'Gemini', kind: 'model' }], edges: [{ from: 'hub', to: 'm', kind: 'calls' }] }));
    },
  });
  try {
    const out = await analyzeCodebase({ project: { name: 'p', slug: 'p' }, modules: ['x'] }, { endpoint: url });
    assert.equal(out.nodes.length, 2);
    assert.equal(out.edges.length, 1);
    assert.equal(seen.promptVersion, 'codebase-analyze-v1');
    assert.equal(typeof seen.context, 'object');
  } finally { server.close(); }
});

test('resilience: non-2xx / bad json / no endpoint all resolve to null', async () => {
  assert.equal(await analyzeCodebase({ a: 1 }, { endpoint: '' }), null);
  const bad = await startStub({ handler: (_d, res) => { res.writeHead(500).end('nope'); } });
  try { assert.equal(await analyzeCodebase({ x: 1 }, { endpoint: bad.url }), null); } finally { bad.server.close(); }
  const junk = await startStub({ handler: (_d, res) => { res.writeHead(200).end('not json'); } });
  try { assert.equal(await analyzeCodebase({ x: 1 }, { endpoint: junk.url }), null); } finally { junk.server.close(); }
});

test('makeCodebaseAnalyzer.analyze returns {nodes,edges,latencyMs}; failure => null', async () => {
  const { server, url } = await startStub();
  try {
    const a = makeCodebaseAnalyzer({ endpoint: url });
    const r = await a.analyze({ project: { name: 'p', slug: 'p' } });
    assert.ok(Array.isArray(r.nodes) && typeof r.latencyMs === 'number');
  } finally { server.close(); }
  const down = makeCodebaseAnalyzer({ endpoint: 'http://127.0.0.1:1/graph-inference' });
  assert.equal(await down.analyze({ x: 1 }), null);
});
