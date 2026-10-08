'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestDeclareAgent, requestRelateAgentPortfolios } = require('../src/agents-client');

function startServer(onBody) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (onBody) onBody(JSON.parse(raw || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'OK', data: { name: 'x' } }));
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
const urlOf = (s) => `http://127.0.0.1:${s.address().port}/declare`;
const creds = { accessToken: 'tok', hubAccessToken: 'hub' };

test('a string/slug catalogId is OMITTED from the declare body (BUG 2)', async () => {
  let body = null;
  const server = await startServer((b) => (body = b));
  try {
    const r = await requestDeclareAgent(
      { name: 'A', catalogId: 'dev-1', whatItDoes: 'x', accessToken: creds.accessToken, hubAccessToken: creds.hubAccessToken },
      { endpoint: urlOf(server) },
    );
    // ADR-041: declare now threads back the created agent id for the relate
    // step. The fixture's `data` carries no `id`, so it resolves to null.
    assert.deepEqual(r, { ok: true, agentId: null });
    assert.equal('catalogId' in body, false, 'slug catalogId must never reach Hub');
    assert.equal(body.name, 'A');
  } finally {
    server.close();
  }
});

test('a numeric-string catalogId ("12") is still OMITTED (Hub wants a real number, not a string)', async () => {
  let body = null;
  const server = await startServer((b) => (body = b));
  try {
    await requestDeclareAgent(
      { name: 'B', catalogId: '12', accessToken: creds.accessToken, hubAccessToken: creds.hubAccessToken },
      { endpoint: urlOf(server) },
    );
    assert.equal('catalogId' in body, false);
  } finally {
    server.close();
  }
});

test('an integer catalogId IS forwarded (the valid Hub num_id case)', async () => {
  let body = null;
  const server = await startServer((b) => (body = b));
  try {
    await requestDeclareAgent(
      { name: 'C', catalogId: 7, accessToken: creds.accessToken, hubAccessToken: creds.hubAccessToken },
      { endpoint: urlOf(server) },
    );
    assert.equal(body.catalogId, 7);
  } finally {
    server.close();
  }
});

// ADR-041 — the declare response threads back the created agent id (relayed from Hub), normalized to a string, so the relate step can PATCH `:id`.
function startDeclareServerWithData(data) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'OK', data }));
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('declare threads back the created agent id (numeric id -> string)', async () => {
  const server = await startDeclareServerWithData({ id: 42, name: 'A' });
  try {
    const r = await requestDeclareAgent(
      { name: 'A', accessToken: creds.accessToken, hubAccessToken: creds.hubAccessToken },
      { endpoint: `http://127.0.0.1:${server.address().port}/declare` },
    );
    assert.deepEqual(r, { ok: true, agentId: '42' });
  } finally {
    server.close();
  }
});

test('requestRelateAgentPortfolios PATCHes { items } (portfolioId only) DIRECT to hub (Bearer = hub token)', async () => {
  let method = null;
  let auth = null;
  let hubToken = null;
  let body = null;
  const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      method = req.method;
      auth = req.headers.authorization;
      hubToken = req.headers['x-hub-token'];
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        body = JSON.parse(raw || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: [{ id: 'r1', portfolioId: 'pf-1', impact: 'shipped 2x faster' }] }));
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const r = await requestRelateAgentPortfolios(
      {
        agentId: '42',
        items: [
          { portfolioId: 'pf-1' },
          { portfolioId: 'pf-2' },
        ],
        hubAccessToken: 'hub.tok',
      },
      { endpoint: `http://127.0.0.1:${server.address().port}/works/me/agents/42/portfolios` },
    );
    assert.deepEqual(r, { ok: true });
    assert.equal(method, 'PATCH');
    // DIRECT to hub: the hub token IS the Authorization, never an X-Hub-Token relay.
    assert.equal(auth, 'Bearer hub.tok');
    assert.equal(hubToken, undefined);
    assert.deepEqual(body.items, [
      { portfolioId: 'pf-1' },
      { portfolioId: 'pf-2' },
    ]);
  } finally {
    server.close();
  }
});

test('requestRelateAgentPortfolios fails locally with no hub token / no agent (never a request)', async () => {
  assert.deepEqual(
    await requestRelateAgentPortfolios({ agentId: '1', items: [], hubAccessToken: '' }, { endpoint: 'http://x/y' }),
    { ok: false, reason: 'no-hub-token' },
  );
  assert.deepEqual(
    await requestRelateAgentPortfolios({ agentId: '', items: [], hubAccessToken: 'h' }, { endpoint: 'http://x/y' }),
    { ok: false, reason: 'no-agent' },
  );
  assert.deepEqual(
    await requestRelateAgentPortfolios({ agentId: '1', items: [], hubAccessToken: 'h' }, { endpoint: null }),
    { ok: false, reason: 'no-endpoint' },
  );
});
