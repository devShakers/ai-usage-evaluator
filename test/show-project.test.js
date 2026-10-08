'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestPositionDetail, fetchPositionDetail } = require('../src/show-project-client');
const { runShowProject } = require('../src/show-project-flow');
const { makeShowProjectTools, SHOW_PROJECT_SCHEMA } = require('../src/mcp-show-project-tools');
const { getCatalog } = require('../src/i18n');

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

function fakeIo() {
  const lines = [];
  return {
    lines,
    section: (t) => lines.push(`SECTION ${t}`),
    notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, "")),
    error: (t) => lines.push(`ERROR ${t}`),
    warn: (t) => lines.push(`WARN ${t}`),
    success: (t) => lines.push(`SUCCESS ${t}`),
    withProgress: (_l, task) => task(),
  };
}

const passRef = (raw) => (raw ? { ok: true, id: raw } : { ok: false, reason: 'no-id' });

const POSITION = {
  id: 'pos-1', projectId: 'prj-1', title: 'Backend dev', subtitle: 'Acme rebuild', match: 90,
  budget: { display: '3 000 €/mes' }, attendance: 'REMOTE', country: 'ES', requiredMonthlyHours: 120,
  skills: [{ id: 1, name: 'Node' }], languages: ['ES'], company: { name: 'Acme', restricted: false },
  description: 'Build the thing', goals: 'Ship it', faqs: [{ question: 'Remote?', answer: 'Yes' }],
  isSaved: true, hasApplied: false, canApply: true,
};

test('requestPositionDetail: parses {status:OK,data:{position,redirectUrl}} with Bearer', async () => {
  let auth;
  const { server, base } = await startServer((req, res) => {
    auth = req.headers.authorization;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { position: POSITION, redirectUrl: null } }));
  });
  try {
    const r = await requestPositionDetail({ hubAccessToken: 'hub-jwt' }, { positionId: 'pos-1', endpoint: `${base}/works/positions/pos-1/detail` });
    assert.equal(r.ok, true);
    assert.equal(r.position.title, 'Backend dev');
    assert.equal(auth, 'Bearer hub-jwt');
  } finally { server.close(); }
});

test('requestPositionDetail: 404 -> not-found; missing id/token guarded', async () => {
  const { server, base } = await startServer((req, res) => { res.writeHead(404); res.end('{}'); });
  try {
    assert.equal((await requestPositionDetail({ hubAccessToken: 't' }, { positionId: 'x', endpoint: `${base}/d` })).reason, 'not-found');
  } finally { server.close(); }
  assert.deepEqual(await requestPositionDetail({ hubAccessToken: 't' }, { positionId: null, endpoint: 'http://x/d' }), { ok: false, reason: 'no-id' });
  assert.deepEqual(await requestPositionDetail({}, { positionId: 'x', endpoint: 'http://x/d' }), { ok: false, reason: 'no-hub-token' });
});

test('fetchPositionDetail: resolves endpoint from config (null id -> no-id)', async () => {
  const none = await fetchPositionDetail({ getPositionDetailEndpoint: () => null }, { hubAccessToken: 't', positionId: 'x' });
  assert.equal(none.reason, 'no-endpoint');
  let passed;
  await fetchPositionDetail({ getPositionDetailEndpoint: (id) => `http://hub/works/positions/${id}/detail`, requestPositionDetail: async (c, o) => { passed = o; return { ok: true, position: POSITION }; } }, { hubAccessToken: 't', positionId: 'pos-1' });
  assert.equal(passed.endpoint, 'http://hub/works/positions/pos-1/detail');
});

test('runShowProject: renders detail without ids; --json keeps them', async () => {
  const io = fakeIo();
  await runShowProject({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: 'pos-1' }, deps: { resolveRef: passRef, fetchPositionDetail: async () => ({ ok: true, position: POSITION, redirectUrl: null }) } });
  const out = io.lines.join('\n');
  assert.match(out, /Backend dev/);
  assert.match(out, /Company: Acme/);
  assert.match(out, /Node/);
  assert.doesNotMatch(out, /pos-1|prj-1/);

  let raw = '';
  await runShowProject({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: 'pos-1', json: true }, deps: { resolveRef: passRef, fetchPositionDetail: async () => ({ ok: true, position: POSITION, redirectUrl: null }) } });
  assert.equal(JSON.parse(raw).position.id, 'pos-1');
});

test('runShowProject: no id -> error; hidden position -> notVisible', async () => {
  const io = fakeIo();
  const r = await runShowProject({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { resolveRef: passRef, fetchPositionDetail: async () => ({ ok: true }) } });
  assert.equal(r.ok, false);
  const io2 = fakeIo();
  await runShowProject({ io: io2, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: 'x' }, deps: { resolveRef: passRef, fetchPositionDetail: async () => ({ ok: true, position: null, redirectUrl: '/x' }) } });
  assert.match(io2.lines.join('\n'), /not available to you/);
});

test('runShowProject: --json on a hidden position emits JSON (not the human notVisible text)', async () => {
  let raw = '';
  const io = fakeIo();
  const r = await runShowProject({ io, rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: 'x', json: true }, deps: { resolveRef: passRef, fetchPositionDetail: async () => ({ ok: true, position: null, redirectUrl: '/find-projects/p' }) } });
  const parsed = JSON.parse(raw); // must be valid JSON, not "not available to you"
  assert.equal(parsed.ok, true);
  assert.equal(parsed.position, null);
  assert.equal(parsed.redirectUrl, '/find-projects/p');
  assert.equal(io.lines.length, 0); // nothing human-printed in json mode
  assert.equal(r.position, null);
});

test('runShowProject: number ref resolves via cache; no-cache + out-of-range map to copy', async () => {
  // Integer -> resolved id, then fetched.
  let fetchedId;
  const io = fakeIo();
  await runShowProject({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: '3' }, deps: { resolveRef: (raw) => (raw === '3' ? { ok: true, id: 'uuid-3' } : passRef(raw)), fetchPositionDetail: async ({ positionId }) => { fetchedId = positionId; return { ok: true, position: POSITION, redirectUrl: null }; } } });
  assert.equal(fetchedId, 'uuid-3');

  const io2 = fakeIo();
  const r2 = await runShowProject({ io: io2, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: '2' }, deps: { resolveRef: () => ({ ok: false, reason: 'no-cache' }), fetchPositionDetail: async () => ({ ok: true, position: POSITION }) } });
  assert.equal(r2.ok, false);
  assert.match(io2.lines.join('\n'), /No recent listing/);

  const io3 = fakeIo();
  const r3 = await runShowProject({ io: io3, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: '99' }, deps: { resolveRef: () => ({ ok: false, reason: 'out-of-range', count: 5 }), fetchPositionDetail: async () => ({ ok: true, position: POSITION }) } });
  assert.equal(r3.ok, false);
  assert.match(io3.lines.join('\n'), /not in the last listing \(there are 5\)/);
});

test('show_project tool: session-gated + requires id + returns position', async () => {
  const [tool] = makeShowProjectTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchPositionDetail: async () => ({ ok: true, position: POSITION, redirectUrl: null }) });
  assert.equal(tool.name, 'show_project');
  assert.deepEqual(SHOW_PROJECT_SCHEMA.required, ['id']);
  assert.deepEqual(await tool.handler({}), { ok: false, reason: 'no-id' });
  assert.equal((await tool.handler({ id: 'pos-1' })).position.title, 'Backend dev');
  const [gated] = makeShowProjectTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({ id: 'x' }), /no active Shakers session/);
});

test('runShowProject: resolves skill i18n keys in the detail (and --json)', async () => {
  const io = fakeIo();
  const P = { ...POSITION, skills: [{ id: 1, name: 'staticDataSkillsSkill_3' }] };
  const deps = { resolveRef: passRef, fetchPositionDetail: async () => ({ ok: true, position: P, redirectUrl: null }), fetchTranslationMap: async () => ({ ok: true, map: new Map([['staticDataSkillsSkill_3', 'Sales Strategy']]) }) };
  await runShowProject({ io, lang: 'en', session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: 'pos-1' }, deps });
  const out = io.lines.join('\n');
  assert.match(out, /Skills: Sales Strategy/);
  assert.doesNotMatch(out, /staticDataSkillsSkill/);

  let raw = '';
  await runShowProject({ io: fakeIo(), rawOut: (s) => { raw += s; }, lang: 'en', session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { id: 'pos-1', json: true }, deps });
  assert.equal(JSON.parse(raw).position.skills[0].name, 'Sales Strategy'); // resolved in --json too
});
