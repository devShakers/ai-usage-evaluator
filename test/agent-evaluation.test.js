'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  PROMPT_VERSION,
  MAX_DEFINITION_CHARS,
  buildAgentEvaluationRequest,
  requestAgentEvaluation,
} = require('../src/agent-evaluation');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => handler(JSON.parse(raw || '{}'), res, req));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const urlFor = (server) => `http://127.0.0.1:${server.address().port}/works/ai-footprint/agent-evaluation`;

test('buildAgentEvaluationRequest: frozen-contract shape — definition (scrubbed), tools, model, parent, promptVersion', () => {
  const body = buildAgentEvaluationRequest(
    [{ name: 'a', tools: ['Read'], model: 'opus', parent: null }],
    [{ name: 'a', description: 'contact me at secret@example.com for AKIA1234567890ABCDEF stuff' }],
  );
  assert.equal(body.promptVersion, 'agent-eval-v1');
  assert.equal(PROMPT_VERSION, 'agent-eval-v1');
  const a = body.agents[0];
  assert.equal(a.name, 'a');
  assert.deepEqual(a.tools, ['Read']);
  assert.equal(a.model, 'opus');
  assert.equal(a.parent, null);
  assert.ok('definition' in a && !('description' in a), 'field is `definition`, not `description`');
  assert.equal(/secret@example\.com|AKIA1234567890ABCDEF/.test(a.definition), false, 'secrets scrubbed');
});

test('buildAgentEvaluationRequest: caps each definition to MAX_DEFINITION_CHARS (prefix, no ellipsis)', () => {
  assert.equal(MAX_DEFINITION_CHARS, 2000);
  // Long, secret-free text (spaced words so scrub's long-token rule doesn't fire).
  const long = 'clear boundaries and structure. '.repeat(300); // ~9600 chars
  assert.ok(long.length > MAX_DEFINITION_CHARS);
  const body = buildAgentEvaluationRequest([{ name: 'a' }], [{ name: 'a', definition: long }]);
  assert.equal(body.agents[0].definition.length, MAX_DEFINITION_CHARS);
  assert.equal(body.agents[0].definition, long.slice(0, MAX_DEFINITION_CHARS)); // plain prefix, no ellipsis
  assert.equal(body.agents[0].definition.endsWith('…'), false);
});

test('buildAgentEvaluationRequest: a short definition is sent whole (under the cap)', () => {
  const body = buildAgentEvaluationRequest([{ name: 'a' }], [{ name: 'a', definition: 'short and clear' }]);
  assert.equal(body.agents[0].definition, 'short and clear');
});

test('requestAgentEvaluation: null when no endpoint (graceful degrade)', async () => {
  assert.equal(await requestAgentEvaluation({ agents: [] }, { endpoint: null }), null);
});

test('requestAgentEvaluation: valid response is normalized (NO score; rationale/classification/improvements)', async () => {
  const server = await startServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ evaluations: [
      { name: 'a', rationale: 'clear boundaries' },
      { name: 'b', rationale: 'thin' },
    ] }));
  });
  try {
    const r = await requestAgentEvaluation(buildAgentEvaluationRequest([{ name: 'a' }, { name: 'b' }], []), { endpoint: urlFor(server) });
    assert.equal(r.promptVersion, 'agent-eval-v1');
    // No numeric score anymore. classification/improvements default when the
    // server omits them — classification degrades to unclassified.
    assert.deepEqual(r.evaluations[0], {
      name: 'a', rationale: 'clear boundaries', description: null,
      classification: { catalogId: null, category: null, role: null, level: null, method: 'unclassified' },
      improvements: [],
    });
    assert.equal('score' in r.evaluations[0], false);
    assert.equal(r.evaluations.length, 2);
  } finally {
    server.close();
  }
});

test('ADR-026: buildAgentEvaluationRequest carries a valid locale; requestAgentEvaluation carries the description', async () => {
  // locale on the request body (only for es/en; anything else omitted).
  assert.equal(buildAgentEvaluationRequest([{ name: 'a' }], [], 'es').locale, 'es');
  assert.equal('locale' in buildAgentEvaluationRequest([{ name: 'a' }], [], 'fr'), false);

  let received;
  const server = await startServer((body, res) => {
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      evaluations: [{ name: 'a', score: 80, rationale: 'ok', description: 'Hace cosas.' }],
    }));
  });
  try {
    const r = await requestAgentEvaluation(
      buildAgentEvaluationRequest([{ name: 'a' }], [], 'es'),
      { endpoint: urlFor(server) },
    );
    assert.equal(received.locale, 'es'); // forwarded to the backend
    assert.equal(r.evaluations[0].description, 'Hace cosas.');
  } finally {
    server.close();
  }
});

test('v4: carries the classification (catalogId/category/role/level/method) and improvements verbatim', async () => {
  const server = await startServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ evaluations: [{
      name: 'a', score: 72, rationale: 'ok', description: 'Reviews PRs.',
      classification: { catalogId: 'dev-3', category: 'developer', role: 'Code Reviewer', level: 'L2', method: 'deterministic' },
      improvements: ['  add non-goals  ', 'declare tools', 42, '', 'add an example', 'a fourth'],
    }] }));
  });
  try {
    const r = await requestAgentEvaluation(buildAgentEvaluationRequest([{ name: 'a' }], []), { endpoint: urlFor(server) });
    assert.deepEqual(r.evaluations[0].classification, {
      catalogId: 'dev-3', category: 'developer', role: 'Code Reviewer', level: 'L2', method: 'deterministic',
    });
    // trimmed, non-strings dropped, capped to 3
    assert.deepEqual(r.evaluations[0].improvements, ['add non-goals', 'declare tools', 'add an example']);
  } finally {
    server.close();
  }
});

test('v4: a classification with a null catalogId or unknown method degrades to unclassified', async () => {
  const server = await startServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ evaluations: [
      { name: 'a', score: 50, rationale: 'x', classification: { catalogId: null, category: 'developer', role: 'X', level: 'L1', method: 'llm' } },
      { name: 'b', score: 50, rationale: 'y', classification: { catalogId: 'dev-1', category: 'developer', role: 'X', level: 'L1', method: 'bogus' } },
    ] }));
  });
  try {
    const r = await requestAgentEvaluation(buildAgentEvaluationRequest([{ name: 'a' }, { name: 'b' }], []), { endpoint: urlFor(server) });
    // null id ⇒ nothing to show ⇒ unclassified
    assert.deepEqual(r.evaluations[0].classification, { catalogId: null, category: null, role: null, level: null, method: 'unclassified' });
    // real id but unknown method ⇒ treated as llm-inferred (conservative)
    assert.equal(r.evaluations[1].classification.catalogId, 'dev-1');
    assert.equal(r.evaluations[1].classification.method, 'llm');
    assert.deepEqual(r.evaluations[1].improvements, []); // absent improvements ⇒ []
  } finally {
    server.close();
  }
});

test('requestAgentEvaluation: degradation by OMISSION — fewer evaluations than agents, dropped by name', async () => {
  const server = await startServer((body, res) => {
    // Score only the first agent; omit the rest (like the real backend).
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ evaluations: [{ name: body.agents[0].name, score: 70, rationale: 'ok' }] }));
  });
  try {
    const r = await requestAgentEvaluation(buildAgentEvaluationRequest([{ name: 'a' }, { name: 'b' }, { name: 'c' }], []), { endpoint: urlFor(server) });
    assert.equal(r.evaluations.length, 1);
    assert.equal(r.evaluations[0].name, 'a');
  } finally {
    server.close();
  }
});

test('requestAgentEvaluation: entries without a usable name are dropped (never trusts a nameless entry)', async () => {
  const server = await startServer((_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ evaluations: [
      { rationale: 'no name' },
      { name: 'b', rationale: 'y' },
    ] }));
  });
  try {
    const r = await requestAgentEvaluation(buildAgentEvaluationRequest([{ name: 'a' }, { name: 'b' }], []), { endpoint: urlFor(server) });
    assert.equal(r.evaluations.length, 1);
    assert.equal(r.evaluations[0].name, 'b');
  } finally {
    server.close();
  }
});

test('requestAgentEvaluation: non-200 -> null; malformed JSON -> null; unexpected shape -> null', async () => {
  const s500 = await startServer((_b, res) => { res.writeHead(500); res.end('nope'); });
  const sBad = await startServer((_b, res) => { res.writeHead(200); res.end('{not json'); });
  const sShape = await startServer((_b, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ nope: true })); });
  try {
    const body = buildAgentEvaluationRequest([{ name: 'a' }], []);
    assert.equal(await requestAgentEvaluation(body, { endpoint: urlFor(s500) }), null);
    assert.equal(await requestAgentEvaluation(body, { endpoint: urlFor(sBad) }), null);
    assert.equal(await requestAgentEvaluation(body, { endpoint: urlFor(sShape) }), null);
  } finally {
    s500.close(); sBad.close(); sShape.close();
  }
});

test('requestAgentEvaluation: re-scrubs definitions at the network boundary', async () => {
  let received = null;
  const server = await startServer((body, res) => {
    received = body;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ evaluations: [] }));
  });
  try {
    // Bypass the builder: send a raw definition carrying a secret.
    await requestAgentEvaluation(
      { promptVersion: 'agent-eval-v1', agents: [{ name: 'a', definition: 'token sk-ABCDEFGHIJKLMNOP1234', tools: [], model: null, parent: null }] },
      { endpoint: urlFor(server) },
    );
    assert.equal(/sk-ABCDEFGHIJKLMNOP1234/.test(received.agents[0].definition), false, 'secret re-scrubbed at boundary');
  } finally {
    server.close();
  }
});
