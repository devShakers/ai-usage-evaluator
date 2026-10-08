'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestMeCertifications, fetchMeCertifications } = require('../src/certifications-client');
const { runCertifications, groupByState } = require('../src/certifications-flow');
const { makeCertificationsTools } = require('../src/mcp-certifications-tools');
const { getCatalog } = require('../src/i18n');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function fakeIo() {
  const lines = [];
  return { lines, section: (t) => lines.push(`SECTION ${t}`), notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, "")), error: (t) => lines.push(`ERROR ${t}`), warn: () => {}, success: (t) => lines.push(`OK ${t}`), withProgress: (_l, task) => task() };
}

const PAGE = {
  mainRole: { clusterId: 'pm', name: 'Product Manager', category: 'product', progress: { certified: 1, total: 3 } },
  growingInto: [],
  dimensions: [
    { slug: 'priorizacion', name: 'Prioritization', state: 'CERTIFIED', band: 'ADVANCED', expiresAt: null },
    { slug: 'discovery', name: 'Discovery', state: 'UNCERTIFIED', band: null },
    { slug: 'roadmap', name: 'Roadmap', state: 'EXPIRED', band: 'PROFICIENT' },
  ],
  skillsRatio: { certified: 0, total: 46 },
};

test('requestMeCertifications: parses page shape (mainRole cluster + dims state/band)', async () => {
  let auth;
  const { server, base } = await startServer((req, res) => { auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: PAGE })); });
  try {
    const r = await requestMeCertifications({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/certifications/me` });
    assert.equal(r.ok, true);
    assert.equal(r.mainRole.name, 'Product Manager');
    assert.equal(r.mainRole.certified, 1);
    assert.equal(r.dimensions.length, 3);
    assert.equal(r.dimensions[0].band, 'ADVANCED');
    assert.equal(auth, 'Bearer hub-jwt');
  } finally { server.close(); }
});

test('groupByState: splits certified/uncertified/expired', () => {
  const g = groupByState(PAGE.dimensions);
  assert.deepEqual(g.certified.map((d) => d.slug), ['priorizacion']);
  assert.deepEqual(g.uncertified.map((d) => d.slug), ['discovery']);
  assert.deepEqual(g.expired.map((d) => d.slug), ['roadmap']);
});

test('fetchMeCertifications: reuses getMyCertificationsEndpoint', async () => {
  const none = await fetchMeCertifications({ getMyCertificationsEndpoint: () => null }, { hubAccessToken: 't' });
  assert.equal(none.reason, 'no-endpoint');
});

test('runCertifications: renders role + 3 state groups with band', async () => {
  const io = fakeIo();
  // The real client flattens the cluster's progress → {certified,total}.
  const mainRole = { name: 'Product Manager', certified: 1, total: 3 };
  await runCertifications({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchMeCertifications: async () => ({ ok: true, mainRole, growingInto: [], dimensions: PAGE.dimensions }) } });
  const out = io.lines.join('\n');
  assert.match(out, /Main role: Product Manager \(1\/3\)/);
  assert.match(out, /SECTION Certified/);
  assert.match(out, /Prioritization — ADVANCED/);
  assert.match(out, /SECTION Expired/);
  assert.match(out, /SECTION Uncertified/);
});

test('runCertifications: --json passthrough; fetch failure', async () => {
  let raw = '';
  await runCertifications({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { json: true }, deps: { fetchMeCertifications: async () => ({ ok: true, mainRole: PAGE.mainRole, growingInto: [], dimensions: PAGE.dimensions }) } });
  assert.equal(JSON.parse(raw).dimensions.length, 3);
  const io = fakeIo();
  const r = await runCertifications({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchMeCertifications: async () => ({ ok: false, reason: 'http-500' }) } });
  assert.equal(r.ok, false);
});

test('list_certifications tool: session-gated', async () => {
  const [tool] = makeCertificationsTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchMeCertifications: async () => ({ ok: true, mainRole: PAGE.mainRole, growingInto: [], dimensions: PAGE.dimensions }) });
  assert.equal(tool.name, 'list_certifications');
  assert.equal((await tool.handler({})).dimensions.length, 3);
  const [gated] = makeCertificationsTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({}), /no active Shakers session/);
});
