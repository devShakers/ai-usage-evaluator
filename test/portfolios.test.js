'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestPortfolios, fetchPortfolios, normalizePortfolio, TYPES } = require('../src/portfolios-client');
const { runPortfolioList } = require('../src/portfolios-flow');
const { makePortfolioTools } = require('../src/mcp-portfolios-tools');
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

const ROW = {
  id: 'p1', name: 'Senior Backend Engineer', type: 'EXPERIENCE', clientName: 'Acme',
  startDate: '2023-01-01T00:00:00.000Z', endDate: '2024-06-01T00:00:00.000Z', isCurrent: false,
  location: 'Madrid', aboutDescription: 'Built things', aboutUrl: 'https://x', skillIds: [{ id: 1, name: 'Node' }, { id: 2, name: 'Go' }], projectId: null,
};

test('TYPES maps the two commands to the hub type filter', () => {
  assert.deepEqual(TYPES, { experiences: 'EXPERIENCE', portfolios: 'PORTFOLIO' });
});

test('requestPortfolios: sends ?type= + Bearer, normalizes the row', async () => {
  let url; let auth;
  const { server, base } = await startServer((req, res) => { url = req.url; auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: [ROW] })); });
  try {
    const r = await requestPortfolios({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/me/portfolios`, type: 'EXPERIENCE' });
    assert.equal(r.ok, true);
    assert.match(url, /type=EXPERIENCE/);
    assert.equal(auth, 'Bearer hub-jwt');
    assert.deepEqual(r.items[0].skills, ['Node', 'Go']);
    assert.equal(r.items[0].company, 'Acme');
    assert.equal(r.items[0].name, 'Senior Backend Engineer');
  } finally { server.close(); }
});

test('fetchPortfolios: resolves endpoint + maps kind->type', async () => {
  const none = await fetchPortfolios({ getMePortfoliosEndpoint: () => null }, { hubAccessToken: 't', kind: 'experiences' });
  assert.equal(none.reason, 'no-endpoint');
  let passedType;
  await fetchPortfolios({ getMePortfoliosEndpoint: () => 'http://hub/works/me/portfolios', requestPortfolios: async (c, o) => { passedType = o.type; return { ok: true, items: [] }; } }, { hubAccessToken: 't', kind: 'portfolios' });
  assert.equal(passedType, 'PORTFOLIO');
});

test('runPortfolioList (experiences): renders company/dates/skills, no ids; count', async () => {
  const io = fakeIo();
  await runPortfolioList({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), kind: 'experiences', opts: {}, deps: { fetchPortfolios: async ({ kind }) => { assert.equal(kind, 'experiences'); return { ok: true, items: [normalizePortfolio(ROW)] }; } } });
  const out = io.lines.join('\n');
  assert.match(out, /SECTION Your experiences/);
  assert.match(out, /Senior Backend Engineer — Acme/);
  assert.match(out, /Dates: 2023-01-01 → 2024-06-01/);
  assert.match(out, /Skills: Node, Go/);
  assert.doesNotMatch(out, /p1/); // no ids in human render
  assert.match(out, /Total: 1/);
});

test('runPortfolioList (portfolios): uses the portfolios namespace + kind', async () => {
  const io = fakeIo();
  await runPortfolioList({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), kind: 'portfolios', opts: {}, deps: { fetchPortfolios: async ({ kind }) => { assert.equal(kind, 'portfolios'); return { ok: true, items: [normalizePortfolio({ ...ROW, type: 'PORTFOLIO', isCurrent: true, endDate: null })] }; } } });
  const out = io.lines.join('\n');
  assert.match(out, /SECTION Your portfolio/);
  assert.match(out, /Dates: 2023-01-01 → ongoing/); // isCurrent -> "ongoing"
});

test('runPortfolioList: --json keeps ids; empty state', async () => {
  let raw = '';
  await runPortfolioList({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), kind: 'experiences', opts: { json: true }, deps: { fetchPortfolios: async () => ({ ok: true, items: [normalizePortfolio(ROW)] }) } });
  assert.equal(JSON.parse(raw).items[0].id, 'p1');

  const io = fakeIo();
  await runPortfolioList({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), kind: 'experiences', opts: {}, deps: { fetchPortfolios: async () => ({ ok: true, items: [] }) } });
  assert.match(io.lines.join('\n'), /not added any experiences/);
});

test('runPortfolioList: --json skips the loader label (clean JSON)', async () => {
  const io = { ...fakeIo(), progressed: false };
  io.withProgress = (_l, task) => { io.progressed = true; return task(); };
  await runPortfolioList({ io, rawOut: () => {}, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), kind: 'experiences', opts: { json: true }, deps: { fetchPortfolios: async () => ({ ok: true, items: [] }) } });
  assert.equal(io.progressed, false);
});

test('MCP: list_experiences + list_portfolios, read-only, session-gated, kind-filtered', async () => {
  const kinds = [];
  const tools = makePortfolioTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchPortfolios: async ({ kind }) => { kinds.push(kind); return { ok: true, items: [normalizePortfolio(ROW)] }; } });
  assert.deepEqual(tools.map((t) => t.name), ['list_experiences', 'list_portfolios']);
  await tools[0].handler({});
  await tools[1].handler({});
  assert.deepEqual(kinds, ['experiences', 'portfolios']);
  const [gated] = makePortfolioTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({}), /no active Shakers session/);
});

test('runPortfolioList: resolves skill i18n keys via the translations map', async () => {
  const io = fakeIo();
  const rowWithKeys = { ...ROW, skillIds: [{ id: 1, name: 'staticDataSkillsSkill_3' }, { id: 2, name: 'staticDataSkillsSkill_9' }] };
  await runPortfolioList({
    io, lang: 'en', session: { hubAccessToken: 't' }, catalog: getCatalog('en'), kind: 'experiences', opts: {},
    deps: {
      fetchPortfolios: async () => ({ ok: true, items: [normalizePortfolio(rowWithKeys)] }),
      fetchTranslationMap: async () => ({ ok: true, map: new Map([['staticDataSkillsSkill_3', 'Sales Strategy'], ['staticDataSkillsSkill_9', 'Node.js']]) }),
    },
  });
  const out = io.lines.join('\n');
  assert.match(out, /Skills: Sales Strategy, Node\.js/);
  assert.doesNotMatch(out, /staticDataSkillsSkill/);
});

test('runPortfolioList: does NOT fetch translations when skills are already plain', async () => {
  let mapCalled = false;
  const io = fakeIo();
  await runPortfolioList({
    io, lang: 'en', session: { hubAccessToken: 't' }, catalog: getCatalog('en'), kind: 'experiences', opts: {},
    deps: {
      fetchPortfolios: async () => ({ ok: true, items: [normalizePortfolio(ROW)] }), // ROW has plain 'Node'/'Go'
      fetchTranslationMap: async () => { mapCalled = true; return { ok: true, map: new Map() }; },
    },
  });
  assert.equal(mapCalled, false); // no keys -> no 947KB fetch
});
