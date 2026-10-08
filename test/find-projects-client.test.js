'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  requestFindProjects,
  fetchFindProjects,
  buildCriteria,
  normalizeItem,
  TABS,
} = require('../src/find-projects-client');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function okPaginated(res, data, meta) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'OK', data, meta }));
}

const SAMPLE = [
  { positionId: 'pos-1', title: 'Backend dev', projectId: 'prj-1', projectName: 'Acme rebuild', description: 'x', attendance: 'REMOTE', requiredMonthlyHours: 80, match: 92, isSaved: true, company: { name: 'Acme', restricted: false }, budget: { from: 3000, to: 5000, unit: 'MONTH', display: '3 000 – 5 000 €/mes' }, skillNames: ['Node'], languages: ['ES'] },
  { positionId: 'pos-2', title: 'PM', projectId: 'prj-2', projectName: 'Zeta', match: null, isSaved: false, company: { name: null, restricted: true }, budget: null, skillNames: [], languages: [] },
];

/* -------- requestFindProjects: envelope + Bearer + criteria -------- */

test('requestFindProjects: parses {status:OK,data:[...],meta} and sends Bearer + criteria (limit/offset)', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res) => {
    seen.url = req.url;
    seen.auth = req.headers.authorization;
    okPaginated(res, SAMPLE, { page: 2, pageSize: 15, total: 213, totalPages: 15 });
  });
  try {
    const r = await requestFindProjects({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/positions/find`, limit: 15, offset: 15 });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 2);
    assert.equal(r.meta.total, 213);
    assert.equal(seen.auth, 'Bearer hub-jwt');
    const criteria = JSON.parse(decodeURIComponent(seen.url.split('criteria=')[1]));
    assert.equal(criteria.limit, 15);
    assert.equal(criteria.offset, 15);
  } finally {
    server.close();
  }
});

test('requestFindProjects: filters + saved tab all ride the criteria conditions', async () => {
  let url = '';
  const { server, base } = await startServer((req, res) => { url = req.url; okPaginated(res, [], null); });
  try {
    await requestFindProjects({ hubAccessToken: 't' }, { tab: 'saved', endpoint: `${base}/find`, attendance: 'REMOTE', country: 'ES' });
    const criteria = JSON.parse(decodeURIComponent(url.split('criteria=')[1]));
    const byField = Object.fromEntries(criteria.filter.conditions.map((c) => [c.field, c]));
    assert.deepEqual(byField.savedByMe, { field: 'savedByMe', operator: 'EQUALS', value: true });
    assert.deepEqual(byField.attendance, { field: 'attendance', operator: 'IN', value: ['REMOTE'] });
    assert.deepEqual(byField.country, { field: 'country', operator: 'IN', value: ['ES'] });
  } finally {
    server.close();
  }
});

test('requestFindProjects: no hub token / no endpoint -> reason, no network', async () => {
  assert.deepEqual(await requestFindProjects({}, { endpoint: 'http://127.0.0.1:1/find' }), { ok: false, reason: 'no-hub-token' });
  assert.deepEqual(await requestFindProjects({ hubAccessToken: 't' }, {}), { ok: false, reason: 'no-endpoint' });
});

test('requestFindProjects: non-2xx -> mapped reason; non-array data -> bad-response', async () => {
  const err = await startServer((req, res) => { res.writeHead(401); res.end('{}'); });
  try {
    const r = await requestFindProjects({ hubAccessToken: 't' }, { endpoint: `${err.base}/find` });
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  } finally {
    err.server.close();
  }
  const bad = await startServer((req, res) => okPaginated(res, { nope: true }, null));
  try {
    const r = await requestFindProjects({ hubAccessToken: 't' }, { endpoint: `${bad.base}/find` });
    assert.deepEqual(r, { ok: false, reason: 'bad-response' });
  } finally {
    bad.server.close();
  }
});

/* -------- fetchFindProjects: resolves endpoint + threads pagination/filters -------- */

test('fetchFindProjects: null when no endpoint; else delegates with resolved endpoint + opts', async () => {
  const none = await fetchFindProjects({ getFindPositionsEndpoint: () => null }, { hubAccessToken: 't' });
  assert.deepEqual(none, { ok: false, reason: 'no-endpoint' });

  let passed;
  const r = await fetchFindProjects(
    {
      getFindPositionsEndpoint: () => 'http://hub/works/positions/find',
      requestFindProjects: async (creds, opts) => { passed = { creds, opts }; return { ok: true, items: [], meta: null }; },
    },
    { hubAccessToken: 'hub-jwt', tab: 'all', limit: 20, offset: 40, attendance: 'HYBRID', country: 'PT' },
  );
  assert.equal(r.ok, true);
  assert.equal(passed.creds.hubAccessToken, 'hub-jwt');
  assert.equal(passed.opts.endpoint, 'http://hub/works/positions/find');
  assert.equal(passed.opts.limit, 20);
  assert.equal(passed.opts.offset, 40);
  assert.equal(passed.opts.attendance, 'HYBRID');
  assert.equal(passed.opts.country, 'PT');
});

/* -------- pure helpers -------- */

test('buildCriteria: limit/offset always; conditions only for the applied filters/tab', () => {
  assert.deepEqual(buildCriteria('all', { limit: 15, offset: 30 }), { limit: 15, offset: 30 });
  const saved = buildCriteria('saved', { limit: 10, offset: 0, attendance: 'REMOTE' });
  assert.equal(saved.filter.conditions.length, 2);
  assert.ok(saved.filter.conditions.some((c) => c.field === 'savedByMe'));
  assert.ok(saved.filter.conditions.some((c) => c.field === 'attendance'));
});

test('TABS: only all + saved (no client-derived recommended)', () => {
  assert.deepEqual(TABS, ['all', 'saved']);
});

test('normalizeItem: defensive shape (missing budget/company/arrays)', () => {
  const n = normalizeItem({ positionId: 'p', match: undefined, isSaved: 'yes' });
  assert.equal(n.budget, null);
  assert.equal(n.match, null);
  assert.equal(n.isSaved, false); // only strict true counts
  assert.deepEqual(n.skillNames, []);
  assert.equal(n.company.restricted, false);
});

test('countOpenPositions: one row filtered by the role (cluster) and the list total, for the main-role step', async () => {
  let url = '';
  const { server, base } = await startServer((req, res) => { url = req.url; okPaginated(res, SAMPLE.slice(0, 1), { page: 1, pageSize: 1, total: 12, totalPages: 12 }); });
  try {
    const { countOpenPositions } = require('../src/find-projects-client');
    const r = await countOpenPositions({ getFindPositionsEndpoint: () => `${base}/works/positions/find` }, { hubAccessToken: 'hub-jwt', clusterId: 'data-engineer' });
    assert.deepEqual(r, { ok: true, total: 12 });
    const criteria = JSON.parse(decodeURIComponent(url.split('criteria=')[1]));
    assert.equal(criteria.limit, 1);
    assert.deepEqual(criteria.filter.conditions, [{ field: 'clusterIds', operator: 'IN', value: ['data-engineer'] }]);
  } finally {
    server.close();
  }
});

test('countOpenPositions: no total in the answer is a named failure, not a zero', async () => {
  const { server, base } = await startServer((req, res) => okPaginated(res, [], null));
  try {
    const { countOpenPositions } = require('../src/find-projects-client');
    const r = await countOpenPositions({ getFindPositionsEndpoint: () => `${base}/f` }, { hubAccessToken: 'h', clusterId: 'x' });
    assert.deepEqual(r, { ok: false, reason: 'no-total' });
  } finally {
    server.close();
  }
});
