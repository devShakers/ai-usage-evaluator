'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestMyCandidatures, fetchApplications, normalizeApplication } = require('../src/applications-client');
const { runApplications } = require('../src/applications-flow');
const { makeApplicationsTools } = require('../src/mcp-applications-tools');
const { getCatalog } = require('../src/i18n');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function fakeIo() {
  const lines = [];
  return { lines, section: (t) => lines.push(`SECTION ${t}`), notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, '')), error: (t) => lines.push(`ERROR ${t}`), warn: () => {}, success: (t) => lines.push(`OK ${t}`), withProgress: (_l, task) => task() };
}

const ROWS = [
  { id: 'c1', project: { id: 'prj-1', name: 'Acme rebuild', status: 'ACTIVE' }, organization: { id: 'o1', name: 'Acme', logo: null }, position: { id: 'pos-1', name: 'Backend dev' }, status: 'APPLIED', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'c2', project: { id: 'prj-2', name: 'Zeta' }, organization: { id: 'o2', name: 'Zeta Inc' }, position: { id: 'pos-2', name: null }, status: 'SHORTLISTED', createdAt: '2026-01-02T00:00:00Z' },
];

test('requestMyCandidatures: parses paginated envelope + Bearer + criteria', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res) => { seen.url = req.url; seen.auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: ROWS, meta: { total: 2 } })); });
  try {
    const r = await requestMyCandidatures({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/candidatures/me` });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].positionId, 'pos-1');
    assert.equal(r.items[0].title, 'Backend dev');
    assert.equal(r.items[0].company, 'Acme');
    assert.equal(r.items[0].status, 'APPLIED');
    assert.equal(seen.auth, 'Bearer hub-jwt');
    assert.match(seen.url, /criteria=/);
  } finally { server.close(); }
});

test('normalizeApplication: title falls back to project name when position name is null', () => {
  const n = normalizeApplication(ROWS[1]);
  assert.equal(n.title, 'Zeta');
  assert.equal(n.positionId, 'pos-2');
});

test('fetchApplications: resolves endpoint from config', async () => {
  const none = await fetchApplications({ getMyCandidaturesEndpoint: () => null }, { hubAccessToken: 't' });
  assert.equal(none.reason, 'no-endpoint');
});

test('runApplications: renders title/company/status without ids + writes the position cache', async () => {
  let cached;
  const io = fakeIo();
  await runApplications({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchApplications: async () => ({ ok: true, items: ROWS.map(normalizeApplication), meta: { total: 2 } }), writePositionCache: (ids) => { cached = ids; } } });
  const out = io.lines.join('\n');
  assert.match(out, /Backend dev/);
  assert.match(out, /Status: APPLIED/);
  assert.doesNotMatch(out, /pos-1|prj-1/);
  assert.deepEqual(cached, ['pos-1', 'pos-2']); // number->positionId cache, display order
});

test('runApplications: --json keeps ids and does NOT write cache; empty state', async () => {
  let cached = null; let raw = '';
  await runApplications({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { json: true }, deps: { fetchApplications: async () => ({ ok: true, items: ROWS.map(normalizeApplication) }), writePositionCache: (ids) => { cached = ids; } } });
  assert.equal(JSON.parse(raw).items[0].positionId, 'pos-1');
  assert.equal(cached, null);

  const io2 = fakeIo();
  await runApplications({ io: io2, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchApplications: async () => ({ ok: true, items: [] }), writePositionCache: () => {} } });
  assert.match(io2.lines.join('\n'), /not applied to any project/);
});

test('list_applications tool: session-gated + list', async () => {
  const [tool] = makeApplicationsTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchApplications: async () => ({ ok: true, items: ROWS.map(normalizeApplication) }) });
  assert.equal(tool.name, 'list_applications');
  assert.equal((await tool.handler({})).applications.length, 2);
  const [gated] = makeApplicationsTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({}), /no active Shakers session/);
});
