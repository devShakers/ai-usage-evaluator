'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestLanguages, requestLanguageCatalog, requestSetLanguages, fetchLanguages } = require('../src/lang-client');
const { runLang } = require('../src/lang-flow');
const { makeLangTools } = require('../src/mcp-lang-tools');
const { getCatalog } = require('../src/i18n');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => handler(req, res, b));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function fakeIo() {
  const lines = [];
  return { lines, section: (t) => lines.push(`SECTION ${t}`), notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, '')), error: (t) => lines.push(`ERROR ${t}`), warn: () => {}, success: (t) => lines.push(`OK ${t}`), withProgress: (_l, task) => task() };
}
function setIo(answers, confirmValue) {
  const q = [...answers];
  const io = fakeIo();
  io.ask = async () => (q.length ? q.shift() : '');
  io.confirm = async () => confirmValue;
  return io;
}

// The hub sends `language.name` as an i18n KEY — the client must resolve by code.
const CURRENT = [{ talentId: 't', language: { id: 1, name: 'staticDataLanguagesName_1', code: 'ES' }, level: 'NATIVE' }];

test('requestLanguages: resolves the name by CODE, never the raw i18n key', async () => {
  let auth;
  const { server, base } = await startServer((req, res) => { auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: CURRENT })); });
  try {
    const r = await requestLanguages({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/talents/me/work-details/languages` });
    assert.equal(r.ok, true);
    assert.deepEqual(r.languages, [{ id: 1, code: 'ES', name: 'Spanish', level: 'NATIVE' }]); // 'Spanish' from code, not the key
    assert.doesNotMatch(r.languages[0].name, /staticDataLanguagesName/);
    assert.equal(auth, 'Bearer hub-jwt');
  } finally { server.close(); }
});

test('requestLanguageCatalog: names resolved by code (key ignored); no auth header', async () => {
  let auth = 'unset';
  const { server, base } = await startServer((req, res) => { auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: [{ id: 1, name: 'staticDataLanguagesName_1', code: 'ES' }, { id: 2, name: 'staticDataLanguagesName_2', code: 'EN' }] })); });
  try {
    const r = await requestLanguageCatalog({}, { endpoint: `${base}/static-data/languages` });
    assert.equal(r.ok, true);
    assert.deepEqual(r.catalog.map((l) => l.name), ['Spanish', 'English']);
    assert.equal(auth, undefined);
  } finally { server.close(); }
});

test('requestSetLanguages: PATCH with the full {languages:[{id,level}]} body', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res, body) => { seen.method = req.method; seen.body = body; res.writeHead(200); res.end('{}'); });
  try {
    const r = await requestSetLanguages({ hubAccessToken: 't', languages: [{ id: 1, level: 'NATIVE' }, { id: 2, level: 'ADVANCED' }] }, { endpoint: `${base}/l` });
    assert.equal(r.ok, true);
    assert.equal(seen.method, 'PATCH');
    assert.deepEqual(JSON.parse(seen.body).languages, [{ id: 1, level: 'NATIVE' }, { id: 2, level: 'ADVANCED' }]);
  } finally { server.close(); }
});

test('fetchLanguages: resolves via config getter (guard no-endpoint)', async () => {
  assert.equal((await fetchLanguages({ getLanguagesEndpoint: () => null }, { hubAccessToken: 't' })).reason, 'no-endpoint');
});

test('runLang view: renders name+level; --json keeps ids', async () => {
  const io = fakeIo();
  await runLang({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchLanguages: async () => ({ ok: true, languages: [{ id: 1, code: 'ES', name: 'Spanish', level: 'NATIVE' }] }) } });
  const out = io.lines.join('\n');
  assert.match(out, /Spanish: native/);
  assert.doesNotMatch(out, /\bid\b|: 1\b/);

  let raw = '';
  await runLang({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { json: true }, deps: { fetchLanguages: async () => ({ ok: true, languages: [{ id: 1, code: 'ES', name: 'Spanish', level: 'NATIVE' }] }) } });
  assert.equal(JSON.parse(raw).languages[0].id, 1);
});

function setDeps(picks, over = {}) {
  const q = [...picks];
  return {
    fetchLanguages: async () => ({ ok: true, languages: [{ id: 1, code: 'ES', name: 'Spanish', level: 'NATIVE' }] }),
    fetchLanguageCatalog: async () => ({ ok: true, catalog: [{ id: 1, name: 'Spanish', code: 'ES' }, { id: 2, name: 'English', code: 'EN' }] }),
    saveLanguages: async () => ({ ok: true }),
    promptSelect: async () => (q.length ? q.shift() : null),
    ...over,
  };
}

test('runLang --set: merges into the full replace-all set, confirms, PATCHes', async () => {
  let sent;
  const io = setIo([], true);
  const r = await runLang({
    io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true },
    deps: setDeps([{ id: 2, name: 'English' }, { label: 'advanced', value: 'ADVANCED' }], { saveLanguages: async ({ languages }) => { sent = languages; return { ok: true }; } }),
  });
  assert.equal(r.ok, true);
  // Spanish (existing) preserved + English added.
  assert.deepEqual(sent, [{ id: 1, level: 'NATIVE' }, { id: 2, level: 'ADVANCED' }]);
});

test('runLang --set: cancel picker cancels; non-interactive refused', async () => {
  const io = setIo([], true);
  const rCancel = await runLang({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([null], { saveLanguages: async () => { throw new Error('no'); } }) });
  assert.equal(rCancel.cancelled, true);
  const rNi = await runLang({ io: setIo([], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: false }, deps: setDeps([]) });
  assert.equal(rNi.reason, 'non-interactive');
});

test('get_languages tool: read-only, session-gated', async () => {
  const [tool] = makeLangTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchLanguages: async () => ({ ok: true, languages: [{ id: 1, name: 'Spanish', level: 'NATIVE' }] }) });
  assert.equal(tool.name, 'get_languages');
  assert.equal((await tool.handler({})).languages.length, 1);
  const [gated] = makeLangTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({}), /no active Shakers session/);
});
