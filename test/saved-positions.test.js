'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestSavePosition, requestUnsavePosition, savePosition, unsavePosition } = require('../src/saved-positions-client');
const { runToggleSave } = require('../src/saved-positions-flow');
const { makeSavedPositionsTools } = require('../src/mcp-saved-positions-tools');
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
  return { lines, section: (t) => lines.push(t), notify: (t) => lines.push(t), error: (t) => lines.push(`ERROR ${t}`), warn: () => {}, success: (t) => lines.push(`OK ${t}`), withProgress: (_l, task) => task() };
}

test('requestSavePosition: POST {positionId} + Bearer -> ok', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res, body) => {
    seen.method = req.method; seen.auth = req.headers.authorization; seen.body = body;
    res.writeHead(201); res.end('{}');
  });
  try {
    const r = await requestSavePosition({ hubAccessToken: 'hub-jwt' }, { positionId: 'pos-1', endpoint: `${base}/works/saved-positions` });
    assert.equal(r.ok, true);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.auth, 'Bearer hub-jwt');
    assert.deepEqual(JSON.parse(seen.body), { positionId: 'pos-1' });
  } finally { server.close(); }
});

test('requestUnsavePosition: DELETE -> ok (204)', async () => {
  let method;
  const { server, base } = await startServer((req, res) => { method = req.method; res.writeHead(204); res.end(); });
  try {
    const r = await requestUnsavePosition({ hubAccessToken: 't' }, { positionId: 'pos-1', endpoint: `${base}/works/saved-positions/pos-1` });
    assert.equal(r.ok, true);
    assert.equal(method, 'DELETE');
  } finally { server.close(); }
});

test('save/unsave: guards (no id / no token / no endpoint)', async () => {
  assert.deepEqual(await requestSavePosition({ hubAccessToken: 't' }, { endpoint: 'http://x' }), { ok: false, reason: 'no-id' });
  assert.deepEqual(await requestUnsavePosition({}, { positionId: 'x', endpoint: 'http://x' }), { ok: false, reason: 'no-hub-token' });
  const noEp = await unsavePosition({ getUnsavePositionEndpoint: () => null }, { hubAccessToken: 't', positionId: 'x' });
  assert.equal(noEp.reason, 'no-endpoint');
});

test('savePosition/unsavePosition: resolve endpoints from config', async () => {
  let saveEp; let unsaveArg;
  await savePosition({ getSavePositionEndpoint: () => 'http://hub/works/saved-positions', requestSavePosition: async (c, o) => { saveEp = o.endpoint; return { ok: true }; } }, { hubAccessToken: 't', positionId: 'p' });
  assert.equal(saveEp, 'http://hub/works/saved-positions');
  await unsavePosition({ getUnsavePositionEndpoint: (id) => { unsaveArg = id; return `http://hub/works/saved-positions/${id}`; }, requestUnsavePosition: async () => ({ ok: true }) }, { hubAccessToken: 't', positionId: 'p' });
  assert.equal(unsaveArg, 'p');
});

const passRef = (raw) => (raw ? { ok: true, id: raw } : { ok: false, reason: 'no-id' });

test('runToggleSave: save success + no id error + not-found', async () => {
  const io = fakeIo();
  await runToggleSave({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), mode: 'save', opts: { id: 'p' }, deps: { resolveRef: passRef, savePosition: async () => ({ ok: true }), unsavePosition: async () => ({ ok: true }) } });
  assert.match(io.lines.join('\n'), /OK Saved/);

  const io2 = fakeIo();
  const r = await runToggleSave({ io: io2, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), mode: 'unsave', opts: {}, deps: { resolveRef: passRef } });
  assert.equal(r.ok, false);

  const io3 = fakeIo();
  await runToggleSave({ io: io3, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), mode: 'save', opts: { id: 'p' }, deps: { resolveRef: passRef, savePosition: async () => ({ ok: false, reason: 'not-found' }), unsavePosition: async () => ({}) } });
  assert.match(io3.lines.join('\n'), /ERROR .*not found/);
});

test('runToggleSave: number ref resolves via cache; no-cache/out-of-range copy', async () => {
  let savedId;
  await runToggleSave({ io: fakeIo(), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), mode: 'save', opts: { id: '2' }, deps: { resolveRef: (raw) => (raw === '2' ? { ok: true, id: 'uuid-2' } : passRef(raw)), savePosition: async ({ positionId }) => { savedId = positionId; return { ok: true }; }, unsavePosition: async () => ({}) } });
  assert.equal(savedId, 'uuid-2');

  const io = fakeIo();
  const r = await runToggleSave({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), mode: 'unsave', opts: { id: '7' }, deps: { resolveRef: () => ({ ok: false, reason: 'out-of-range', count: 3 }), savePosition: async () => ({}), unsavePosition: async () => ({}) } });
  assert.equal(r.ok, false);
  assert.match(io.lines.join('\n'), /not in the last listing \(there are 3\)/);
});

test('save_project/unsave_project tools: session-gated + toggle', async () => {
  const tools = makeSavedPositionsTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', savePosition: async () => ({ ok: true }), unsavePosition: async () => ({ ok: true }) });
  const names = tools.map((t) => t.name);
  assert.deepEqual(names, ['save_project', 'unsave_project']);
  assert.deepEqual(await tools[0].handler({ id: 'p' }), { ok: true, positionId: 'p' });
  assert.deepEqual(await tools[1].handler({}), { ok: false, reason: 'no-id' });
  const [gated] = makeSavedPositionsTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({ id: 'p' }), /no active Shakers session/);
});
