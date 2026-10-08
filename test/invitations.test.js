'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestReceivedInvitations, fetchInvitations, normalizeInvitation } = require('../src/invitations-client');
const { runInvitations } = require('../src/invitations-flow');
const { makeInvitationsTools } = require('../src/mcp-invitations-tools');
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

const INV = [
  { projectId: 'prj-1', projectMongoId: 'abc', name: 'Acme rebuild', invitationChatId: 'chat-1' },
  { projectId: 'prj-2', projectMongoId: null, name: 'Zeta', invitationChatId: null },
];

test('requestReceivedInvitations: parses {status:OK,data:[...]} + Bearer', async () => {
  let auth;
  const { server, base } = await startServer((req, res) => { auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: INV })); });
  try {
    const r = await requestReceivedInvitations({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/positions/received-invitations` });
    assert.equal(r.ok, true);
    assert.equal(r.items.length, 2);
    assert.equal(r.items[0].name, 'Acme rebuild');
    assert.equal(auth, 'Bearer hub-jwt');
  } finally { server.close(); }
});

test('requestReceivedInvitations: guards + bad response', async () => {
  assert.deepEqual(await requestReceivedInvitations({}, { endpoint: 'http://x' }), { ok: false, reason: 'no-hub-token' });
  const { server, base } = await startServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: { nope: 1 } })); });
  try {
    assert.deepEqual(await requestReceivedInvitations({ hubAccessToken: 't' }, { endpoint: `${base}/x` }), { ok: false, reason: 'bad-response' });
  } finally { server.close(); }
});

test('normalizeInvitation: keeps only projectId/name/invitationChatId', () => {
  assert.deepEqual(normalizeInvitation(INV[0]), { projectId: 'prj-1', name: 'Acme rebuild', invitationChatId: 'chat-1' });
});

test('fetchInvitations: resolves endpoint from config', async () => {
  const none = await fetchInvitations({ getReceivedInvitationsEndpoint: () => null }, { hubAccessToken: 't' });
  assert.equal(none.reason, 'no-endpoint');
});

test('runInvitations: renders names without ids; empty + json', async () => {
  const io = fakeIo();
  await runInvitations({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchInvitations: async () => ({ ok: true, items: INV.map((i) => ({ projectId: i.projectId, name: i.name, invitationChatId: i.invitationChatId })) }) } });
  const out = io.lines.join('\n');
  assert.match(out, /Acme rebuild/);
  assert.match(out, /with chat/);
  assert.doesNotMatch(out, /prj-1|prj-2/);
  assert.match(out, /Total: 2/);

  const io2 = fakeIo();
  await runInvitations({ io: io2, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchInvitations: async () => ({ ok: true, items: [] }) } });
  assert.match(io2.lines.join('\n'), /no unread invitations/);

  let raw = '';
  await runInvitations({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { json: true }, deps: { fetchInvitations: async () => ({ ok: true, items: INV }) } });
  assert.equal(JSON.parse(raw).items[0].projectId, 'prj-1');
});

test('list_invitations tool: session-gated + list', async () => {
  const [tool] = makeInvitationsTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchInvitations: async () => ({ ok: true, items: INV }) });
  assert.equal(tool.name, 'list_invitations');
  assert.equal((await tool.handler({})).invitations.length, 2);
  const [gated] = makeInvitationsTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({}), /no active Shakers session/);
});
