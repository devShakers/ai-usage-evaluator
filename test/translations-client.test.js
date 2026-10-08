'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestTranslations, fetchTranslationMap, resolveName, clearCache } = require('../src/translations-client');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const ROWS = [
  { id: '1', namespace: 'static-data', key: 'staticDataSkillsSkill_3', en: 'Sales Strategy', es: 'Estrategia de ventas' },
  { id: '2', namespace: 'static-data', key: 'staticDataSkillsSkill_9', en: 'Node.js', es: 'Node.js' },
];

test('requestTranslations: sends ?namespace= + Bearer, returns rows', async () => {
  let url; let auth;
  const { server, base } = await startServer((req, res) => { url = req.url; auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: ROWS })); });
  try {
    const r = await requestTranslations({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/translations` });
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 2);
    assert.match(url, /namespace=static-data/);
    assert.equal(auth, 'Bearer hub-jwt');
  } finally { server.close(); }
});

test('fetchTranslationMap: builds a key->text map for the lang (es), caches it', async () => {
  clearCache();
  let calls = 0;
  const deps = { getTranslationsEndpoint: () => 'http://x/translations', requestTranslations: async () => { calls += 1; return { ok: true, rows: ROWS }; } };
  const r = await fetchTranslationMap(deps, { hubAccessToken: 't', lang: 'es' });
  assert.equal(r.ok, true);
  assert.equal(r.map.get('staticDataSkillsSkill_3'), 'Estrategia de ventas');
  const r2 = await fetchTranslationMap(deps, { hubAccessToken: 't', lang: 'es' });
  assert.equal(r2.ok, true);
  assert.equal(calls, 1); // cached, not refetched
  clearCache();
});

test('fetchTranslationMap: en lang + failure degrades to {ok:false, map:null}', async () => {
  clearCache();
  const en = await fetchTranslationMap({ getTranslationsEndpoint: () => 'http://x', requestTranslations: async () => ({ ok: true, rows: ROWS }) }, { hubAccessToken: 't', lang: 'en' });
  assert.equal(en.map.get('staticDataSkillsSkill_3'), 'Sales Strategy');
  clearCache();
  const fail = await fetchTranslationMap({ getTranslationsEndpoint: () => 'http://x', requestTranslations: async () => ({ ok: false, reason: 'http-500' }) }, { hubAccessToken: 't', lang: 'en' });
  assert.equal(fail.ok, false);
  assert.equal(fail.map, null);
  clearCache();
});

test('resolveName: maps a known key, passes plain/unknown through', () => {
  const map = new Map([['staticDataSkillsSkill_3', 'Sales Strategy']]);
  assert.equal(resolveName(map, 'staticDataSkillsSkill_3'), 'Sales Strategy');
  assert.equal(resolveName(map, 'staticDataSkillsSkill_999'), 'staticDataSkillsSkill_999'); // unknown key -> unchanged
  assert.equal(resolveName(map, 'Marketing'), 'Marketing'); // already-plain -> unchanged
  assert.equal(resolveName(null, 'staticDataSkillsSkill_3'), 'staticDataSkillsSkill_3'); // no map -> unchanged
});
