'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestSocials, requestSetSocials, fetchSocials, normalizeSocial } = require('../src/socials-client');
const { runSocials, setNetworks } = require('../src/socials-flow');
const { makeSocialsTools } = require('../src/mcp-socials-tools');
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

test('requestSocials: parses the fixed network fields; 404 -> empty (not error)', async () => {
  const { server, base } = await startServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: { id: 'x', linkedin: 'https://lnkd/me', github: null, website: '', twitter: 'https://x/me' } })); });
  try {
    const r = await requestSocials({ hubAccessToken: 't' }, { endpoint: `${base}/works/me/social` });
    assert.equal(r.ok, true);
    assert.equal(r.social.linkedin, 'https://lnkd/me');
    assert.equal(r.social.github, null);
    assert.equal(r.social.website, null); // empty string -> null
    assert.equal(r.social.twitter, 'https://x/me');
  } finally { server.close(); }
  const { server: s2, base: b2 } = await startServer((req, res) => { res.writeHead(404); res.end('{}'); });
  try {
    const r = await requestSocials({ hubAccessToken: 't' }, { endpoint: `${b2}/s` });
    assert.equal(r.ok, true); // 404 -> empty object, normal
    assert.equal(r.social.linkedin, null);
  } finally { s2.close(); }
});

test('requestSetSocials: PUT the whole object (all 8 networks, value or null)', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res, body) => { seen.method = req.method; seen.body = body; res.writeHead(200); res.end('{}'); });
  try {
    const r = await requestSetSocials({ hubAccessToken: 't', social: { linkedin: 'https://lnkd/me', github: 'https://gh/me' } }, { endpoint: `${base}/s` });
    assert.equal(r.ok, true);
    assert.equal(seen.method, 'PUT');
    const body = JSON.parse(seen.body);
    assert.equal(body.linkedin, 'https://lnkd/me');
    assert.equal(body.github, 'https://gh/me');
    assert.equal(body.website, null); // absent -> explicitly null (deterministic)
    assert.ok('behance' in body);
  } finally { server.close(); }
});

test('fetchSocials: resolves via config getter (guard no-endpoint)', async () => {
  assert.equal((await fetchSocials({ getMeSocialEndpoint: () => null }, { hubAccessToken: 't' })).reason, 'no-endpoint');
});

test('normalizeSocial + setNetworks', () => {
  const s = normalizeSocial({ linkedin: 'a', github: '', website: 'c' });
  assert.deepEqual(setNetworks(s), ['linkedin', 'website']);
});

test('runSocials view: lists set networks only; --json keeps the whole object', async () => {
  const social = normalizeSocial({ linkedin: 'https://lnkd/me', github: 'https://gh/me' });
  const io = fakeIo();
  await runSocials({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchSocials: async () => ({ ok: true, social }) } });
  const out = io.lines.join('\n');
  assert.match(out, /LinkedIn: https:\/\/lnkd\/me/);
  assert.match(out, /GitHub: https:\/\/gh\/me/);
  assert.doesNotMatch(out, /Twitter/); // unset network not shown

  let raw = '';
  await runSocials({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { json: true }, deps: { fetchSocials: async () => ({ ok: true, social }) } });
  assert.equal(JSON.parse(raw).social.linkedin, 'https://lnkd/me');
});

function setDeps(picks, over = {}) {
  const q = [...picks];
  return {
    fetchSocials: async () => ({ ok: true, social: normalizeSocial({ linkedin: 'https://lnkd/me' }) }),
    saveSocials: async () => ({ ok: true }),
    promptSelect: async () => (q.length ? q.shift() : null),
    ...over,
  };
}

test('runSocials --set: sets a url (merged whole object), confirms, PUTs', async () => {
  let sent;
  const io = setIo(['https://gh/me'], true);
  const r = await runSocials({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([{ label: 'GitHub', value: 'github' }], { saveSocials: async ({ social }) => { sent = social; return { ok: true }; } }) });
  assert.equal(r.ok, true);
  assert.equal(sent.linkedin, 'https://lnkd/me'); // preserved
  assert.equal(sent.github, 'https://gh/me'); // added
});

test('runSocials --set: empty url clears the network', async () => {
  let sent;
  const io = setIo([''], true); // empty -> clear
  await runSocials({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([{ label: 'LinkedIn', value: 'linkedin' }], { saveSocials: async ({ social }) => { sent = social; return { ok: true }; } }) });
  assert.equal(sent.linkedin, null); // cleared
  assert.match(io.lines.join('\n'), /OK .*removed/);
});

test('runSocials --set: cancel picker; non-interactive refused', async () => {
  const rCancel = await runSocials({ io: setIo([], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([null], { saveSocials: async () => { throw new Error('no'); } }) });
  assert.equal(rCancel.cancelled, true);
  const rNi = await runSocials({ io: setIo([], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: false }, deps: setDeps([]) });
  assert.equal(rNi.reason, 'non-interactive');
});

test('list_socials tool: read-only, session-gated', async () => {
  const [tool] = makeSocialsTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchSocials: async () => ({ ok: true, social: normalizeSocial({ linkedin: 'a' }) }) });
  assert.equal(tool.name, 'list_socials');
  assert.equal((await tool.handler({})).social.linkedin, 'a');
  const [gated] = makeSocialsTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({}), /no active Shakers session/);
});
