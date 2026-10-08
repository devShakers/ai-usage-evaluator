'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestAiProfile, fetchAiProfile } = require('../src/profile-client');
const { runProfile } = require('../src/profile-flow');
const { makeProfileTools } = require('../src/mcp-profile-tools');
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

const AIPROFILE = { setup: { tier: 'T5', level: 'ORCHESTRATED' }, usage: { level: 'RIGOROUS' }, cell: 'Orchestrated · Rigorous', isAiNative: true, vision: { text: 'AI is leverage.' }, howIWork: { body: 'I pair with agents daily.' } };

function deps(over = {}) {
  return {
    fetchAiProfile: async () => ({ ok: true, aiProfile: { setupTier: 'T5', setupLevel: 'ORCHESTRATED', usageLevel: 'RIGOROUS', cell: 'Orchestrated · Rigorous', isAiNative: true, agentsOnProfile: 4, vision: 'AI is leverage.', howIWork: 'I pair with agents daily.' } }),
    fetchPricingRate: async () => ({ ok: true, pricing: { fullTimeSelected: true, fullTimePrice: { amount: 5000, currency: 'EUR' } } }),
    fetchMeCertifications: async () => ({ ok: true, mainRole: { name: 'Product Manager', certified: 1, total: 3 }, growingInto: [], dimensions: [], skillsRatio: { certified: 2, total: 12 } }),
    fetchMeProfile: async () => ({ ok: true, headline: 'Senior Product Manager' }),
    fetchTalentMeProfile: async () => ({ ok: true, completedProfilePercentage: 80, freelanceType: 'FREELANCE', onboardingStatus: 'DONE' }),
    fetchLanguages: async () => ({ ok: true, languageCodes: ['ES', 'EN'], languageCount: 2 }),
    fetchAvailability: async () => ({ ok: true, availability: { available: true, monthlyHours: '40' } }),
    ...over,
  };
}

test('requestAiProfile: parses ai-profile read model + Bearer', async () => {
  let auth;
  const { server, base } = await startServer((req, res) => { auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: AIPROFILE })); });
  try {
    const r = await requestAiProfile({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/me/ai-profile` });
    assert.equal(r.ok, true);
    assert.equal(r.aiProfile.setupTier, 'T5');
    assert.equal(r.aiProfile.cell, 'Orchestrated · Rigorous');
    assert.equal(r.aiProfile.vision, 'AI is leverage.');
    assert.equal(auth, 'Bearer hub-jwt');
  } finally { server.close(); }
});

test('fetchAiProfile: reuses getAiProfileEndpoint', async () => {
  const none = await fetchAiProfile({ getAiProfileEndpoint: () => null }, { hubAccessToken: 't' });
  assert.equal(none.reason, 'no-endpoint');
});

test('fetchLanguages: resolves via config.getLanguagesEndpoint (regression: was getSetLanguagesEndpoint, undefined -> crash)', async () => {
  const { fetchLanguages } = require('../src/profile-client');
  assert.equal(typeof require('../src/config').getLanguagesEndpoint, 'function'); // the exact symbol the fix points at
  let hit;
  const r = await fetchLanguages(
    { getLanguagesEndpoint: () => 'http://hub/works/talents/me/work-details/languages', getMapped: (endpoint, _t, _ms, map) => { hit = endpoint; return { ok: true, ...map([{ language: { code: 'ES' } }, { language: { code: 'EN' } }]) }; } },
    { hubAccessToken: 't' },
  );
  assert.match(hit, /works\/talents\/me\/work-details\/languages/);
  assert.deepEqual(r.languageCodes, ['ES', 'EN']);
});

test('runProfile: composes headline, role, completion, rate, availability, languages, counts, AI summary', async () => {
  const io = fakeIo();
  await runProfile({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: deps() });
  const out = io.lines.join('\n');
  assert.match(out, /Headline: Senior Product Manager/);
  assert.match(out, /Main role: Product Manager/);
  assert.match(out, /Work modality: FREELANCE/);
  assert.match(out, /Profile completed: 80%/);
  assert.match(out, /Per-project rate: 5000 EUR/);
  assert.match(out, /Availability: open to work · 40 h\/month/);
  assert.match(out, /Languages: ES, EN/);
  assert.match(out, /Skills: 12/);
  assert.match(out, /Agents: 4/);
  assert.match(out, /AI fluency cell: Orchestrated/);
  assert.match(out, /Your vision on AI/);
});

test('runProfile: degrades when a source fails; hard failure only when all primaries fail', async () => {
  const io = fakeIo();
  await runProfile({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: deps({ fetchPricingRate: async () => ({ ok: false, reason: 'not-found' }), fetchLanguages: async () => ({ ok: false, reason: 'x' }) }) });
  assert.match(io.lines.join('\n'), /Main role: Product Manager/); // still renders the rest

  const io2 = fakeIo();
  const allFail = { fetchAiProfile: async () => ({ ok: false, reason: 'x' }), fetchPricingRate: async () => ({ ok: false, reason: 'x' }), fetchMeCertifications: async () => ({ ok: false, reason: 'x' }), fetchMeProfile: async () => ({ ok: false, reason: 'x' }), fetchTalentMeProfile: async () => ({ ok: false, reason: 'x' }) };
  const r = await runProfile({ io: io2, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: deps(allFail) });
  assert.equal(r.ok, false);
});

test('runProfile: --json passthrough', async () => {
  let raw = '';
  await runProfile({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { json: true }, deps: deps() });
  const j = JSON.parse(raw);
  assert.equal(j.mainRole.name, 'Product Manager');
  assert.equal(j.aiProfile.setupTier, 'T5');
});

test('get_profile tool: session-gated + returns composed data', async () => {
  const [tool] = makeProfileTools({
    loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active',
    getCatalog: () => getCatalog('en'), detectFlowLang: () => 'en',
    runProfile, makeProfileDeps: () => deps(),
  });
  assert.equal(tool.name, 'get_profile');
  const r = await tool.handler({});
  assert.equal(r.ok, true);
  assert.equal(r.mainRole.name, 'Product Manager');
  const [gated] = makeProfileTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({}), /no active Shakers session/);
});
