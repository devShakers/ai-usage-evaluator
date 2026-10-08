'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { getCatalog } = require('../src/i18n');
const { runAddAgents } = require('../src/start-add-agents');

// talents-ai-score Phase 2: `start`'s "Add agent to profile" route.

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function urlOf(server, p) {
  return `http://127.0.0.1:${server.address().port}${p}`;
}
function fakeAsk(answers) {
  let i = 0;
  const asked = [];
  const fn = async (question) => {
    asked.push(String(question));
    return i < answers.length ? answers[i++] : '';
  };
  fn.asked = asked;
  return fn;
}
function captureStdout(fn) {
  return new Promise((resolve, reject) => {
    setImmediate(async () => {
      const original = process.stdout.write;
      const originalErr = process.stderr.write;
      let out = '';
      process.stdout.write = (chunk) => { out += chunk; return true; };
      process.stderr.write = () => true; // swallow spinner
      try {
        const value = await fn();
        resolve({ value, out });
      } catch (e) {
        reject(e);
      } finally {
        process.stdout.write = original;
        process.stderr.write = originalErr;
      }
    });
  });
}

function startListServer(agents = []) {
  return startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: agents }));
  });
}
function startDraftServer(onBody) {
  return startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (onBody) onBody(JSON.parse(raw || '{}'), req.headers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: { whatItDoes: 'Drafted what it does.', humanDecides: 'Drafted what you decide.' } }));
    });
  });
}
function startDeclareServer(onBody, data = { name: 'x' }) {
  return startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (onBody) onBody(JSON.parse(raw || '{}'), req.headers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data }));
    });
  });
}
function startPortfoliosListServer(portfolios = []) {
  return startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: portfolios }));
  });
}
// Captures the DIRECT-to-hub relate PATCH (`.../agents/:id/portfolios`).
function startRelateServer(onBody) {
  return startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (onBody) onBody(JSON.parse(raw || '{}'), req.headers, req.url, req.method);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [] }));
    });
  });
}
function startInventoryServer(agents = [], onHeaders) {
  return startServer((req, res) => {
    if (onHeaders) onHeaders(req.headers);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { skills: [], agents } }));
  });
}
const AGENT_IN_INVENTORY = { name: 'backend-developer', tools: ['bash'], model: 'opus', category: 'engineering', role: 'Backend', level: 'senior' };

const catalog = getCatalog('es');
const session = { accessToken: 'certs.session.tok', hubAccessToken: 'hub.tok', email: 't@e.com' };

let tmpProjectDir;
let tmpHomeDir;
let savedEnv;

function writeAgent(dir, name = 'backend-developer') {
  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'agents', `${name}.md`), `---\nname: ${name}\n---\nYou build backends.\n`);
}

test.beforeEach(() => {
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addagent-proj-'));
  tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addagent-home-'));
  writeAgent(tmpProjectDir);
  savedEnv = {
    inventory: process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT,
    list: process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT,
    declare: process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT,
    draft: process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT,
    portfoliosList: process.env.SHAKERS_CLI_PORTFOLIOS_LIST_ENDPOINT,
    hubBase: process.env.SHAKERS_CLI_HUB_BASE,
    ingest: process.env.SHAKERS_CLI_INGEST_ENDPOINT,
    configDir: process.env.SHAKERS_CLI_CONFIG_DIR,
    home: process.env.AI_FOOTPRINT_HOME_DIR,
    homeNew: process.env.SHAKERS_CLI_HOME_DIR,
  };
  // Empty throwaway home so the runner's real ~/.claude/agents never leaks in.
  process.env.SHAKERS_CLI_HOME_DIR = tmpHomeDir;
  delete process.env.AI_FOOTPRINT_HOME_DIR;
  // ADR-041: the relate step reads getPortfoliosListEndpoint()/getHubBase(), which derive from ingest / the config file when their own env vars are unset.
  delete process.env.SHAKERS_CLI_PORTFOLIOS_LIST_ENDPOINT;
  delete process.env.SHAKERS_CLI_HUB_BASE;
  delete process.env.SHAKERS_CLI_INGEST_ENDPOINT;
  process.env.SHAKERS_CLI_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'addagent-cfg-'));
});

test.afterEach(() => {
  const cfgDir = process.env.SHAKERS_CLI_CONFIG_DIR;
  for (const [k, v] of [
    ['SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT', savedEnv.inventory],
    ['SHAKERS_CLI_AGENTS_LIST_ENDPOINT', savedEnv.list],
    ['SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT', savedEnv.declare],
    ['SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT', savedEnv.draft],
    ['SHAKERS_CLI_PORTFOLIOS_LIST_ENDPOINT', savedEnv.portfoliosList],
    ['SHAKERS_CLI_HUB_BASE', savedEnv.hubBase],
    ['SHAKERS_CLI_INGEST_ENDPOINT', savedEnv.ingest],
    ['SHAKERS_CLI_CONFIG_DIR', savedEnv.configDir],
    ['AI_FOOTPRINT_HOME_DIR', savedEnv.home],
    ['SHAKERS_CLI_HOME_DIR', savedEnv.homeNew],
  ]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (cfgDir) fs.rmSync(cfgDir, { recursive: true, force: true });
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  fs.rmSync(tmpHomeDir, { recursive: true, force: true });
});

test('happy path: AI draft accepted, edits kept, declare body maps every field', async () => {
  const inventoryServer = await startInventoryServer([AGENT_IN_INVENTORY]);
  const listServer = await startListServer([]);
  let declaredBody = null;
  let declaredHeaders = null;
  const draftServer = await startDraftServer();
  const declareServer = await startDeclareServer((body, headers) => { declaredBody = body; declaredHeaders = headers; });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT = urlOf(listServer, '/agents');
    process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT = urlOf(declareServer, '/agents/declare');
    process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT = urlOf(draftServer, '/agents/draft-fields');

    // pick "1", keep name (''), consent "s", keep whatItDoes (''), keep
    // humanDecides ('') — the flow now collects exactly these four fields.
    const ask = fakeAsk(['1', '', 's', '', '']);
    const { out } = await captureStdout(() =>
      runAddAgents({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }),
    );

    assert.ok(declaredBody, 'declare was called');
    assert.equal(declaredBody.name, 'backend-developer');
    assert.equal(declaredBody.whatItDoes, 'Drafted what it does.');
    assert.equal(declaredBody.humanDecides, 'Drafted what you decide.');
    // The trimmed fields never reach the declare body.
    assert.equal('timeSavedHoursWeek' in declaredBody, false);
    assert.equal('isVisible' in declaredBody, false);
    assert.equal('catalogCode' in declaredBody, false);
    // No prior `usage` classification -> no catalogId sent.
    assert.equal('catalogId' in declaredBody, false);
    // The CLI-only signals are NEVER sent to declare (no Hub destination).
    assert.equal('tools' in declaredBody, false);
    assert.equal('model' in declaredBody, false);
    assert.equal('parent' in declaredBody, false);
    // Auth headers: certs Bearer + the Talent's own Hub token.
    assert.equal(declaredHeaders.authorization, 'Bearer certs.session.tok');
    assert.equal(declaredHeaders['x-hub-token'], 'hub.tok');
    assert.match(out, /añadido a tu perfil/);
  } finally {
    inventoryServer.close(); listServer.close(); draftServer.close(); declareServer.close();
  }
});

test('DEDUP: an existing agent with the same name blocks the declare', async () => {
  const inventoryServer = await startInventoryServer([AGENT_IN_INVENTORY]);
  const listServer = await startListServer([{ name: 'backend-developer' }]);
  let declareHit = false;
  const draftServer = await startDraftServer();
  const declareServer = await startDeclareServer(() => { declareHit = true; });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT = urlOf(listServer, '/agents');
    process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT = urlOf(declareServer, '/agents/declare');
    process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT = urlOf(draftServer, '/agents/draft-fields');

    // pick "1", keep the (duplicate) name '' -> dedup fires before any draft.
    const ask = fakeAsk(['1', '']);
    const { out } = await captureStdout(() =>
      runAddAgents({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }),
    );

    assert.equal(declareHit, false, 'declare must not be called for a duplicate');
    assert.match(out, /Ya tienes un agente llamado/);
  } finally {
    inventoryServer.close(); listServer.close(); draftServer.close(); declareServer.close();
  }
});

test('consent DECLINED -> free-text fields, no draft call, still declares', async () => {
  const inventoryServer = await startInventoryServer([AGENT_IN_INVENTORY]);
  const listServer = await startListServer([]);
  let draftHit = false;
  let declaredBody = null;
  const draftServer = await startDraftServer(() => { draftHit = true; });
  const declareServer = await startDeclareServer((body) => { declaredBody = body; });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT = urlOf(listServer, '/agents');
    process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT = urlOf(declareServer, '/agents/declare');
    process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT = urlOf(draftServer, '/agents/draft-fields');

    // pick "1", keep name '', DECLINE consent "n", free-text whatItDoes,
    // free-text humanDecides.
    const ask = fakeAsk(['1', '', 'n', 'Does things by hand', 'I review it']);
    await captureStdout(() =>
      runAddAgents({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }),
    );

    assert.equal(draftHit, false, 'declined consent must never call the AI draft');
    assert.ok(declaredBody);
    assert.equal(declaredBody.whatItDoes, 'Does things by hand');
    assert.equal(declaredBody.humanDecides, 'I review it');
    assert.equal('timeSavedHoursWeek' in declaredBody, false); // empty -> omitted
  } finally {
    inventoryServer.close(); listServer.close(); draftServer.close(); declareServer.close();
  }
});

test('empty discovered inventory -> clean message', async () => {
  const inventoryServer = await startInventoryServer([]);
  const listServer = await startListServer([]);
  const draftServer = await startDraftServer();
  const declareServer = await startDeclareServer();
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT = urlOf(listServer, '/agents');
    process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT = urlOf(declareServer, '/agents/declare');
    process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT = urlOf(draftServer, '/agents/draft-fields');

    const ask = fakeAsk([]);
    const { out } = await captureStdout(() =>
      runAddAgents({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }),
    );
    assert.match(out, /shakers ai-usage/);
  } finally {
    inventoryServer.close(); listServer.close(); draftServer.close(); declareServer.close();
  }
});

test('no hub token on the session -> actionable error, no declare', async () => {
  const inventoryServer = await startInventoryServer([AGENT_IN_INVENTORY]);
  const listServer = await startListServer([]);
  const draftServer = await startDraftServer();
  let declareHit = false;
  const declareServer = await startDeclareServer(() => { declareHit = true; });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT = urlOf(listServer, '/agents');
    process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT = urlOf(declareServer, '/agents/declare');
    process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT = urlOf(draftServer, '/agents/draft-fields');

    const ask = fakeAsk([]);
    // Swallow stderr (the error prints there).
    const originalErr = process.stderr.write;
    process.stderr.write = () => true;
    try {
      await runAddAgents({ ask, catalog, root: tmpProjectDir, session: { accessToken: 'x' }, stdinIsTTY: true });
    } finally {
      process.stderr.write = originalErr;
    }
    assert.equal(declareHit, false);
  } finally {
    inventoryServer.close(); listServer.close(); draftServer.close(); declareServer.close();
  }
});

test('ADR-041: after declare, relate to an experience (portfolioId only, one replace-set PATCH)', async () => {
  const inventoryServer = await startInventoryServer([AGENT_IN_INVENTORY]);
  const listServer = await startListServer([]);
  const draftServer = await startDraftServer();
  const declareServer = await startDeclareServer(null, { id: 99, name: 'backend-developer' });
  const portfoliosServer = await startPortfoliosListServer([
    { id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO' },
  ]);
  let relateBody = null;
  let relateUrl = null;
  let relateHeaders = null;
  const relateServer = await startRelateServer((body, headers, url) => {
    relateBody = body; relateHeaders = headers; relateUrl = url;
  });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT = urlOf(listServer, '/agents');
    process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT = urlOf(declareServer, '/agents/declare');
    process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT = urlOf(draftServer, '/agents/draft-fields');
    process.env.SHAKERS_CLI_PORTFOLIOS_LIST_ENDPOINT = urlOf(portfoliosServer, '/portfolios');
    // getAgentPortfoliosEndpoint derives `{hubBase}/works/me/agents/:id/portfolios`.
    process.env.SHAKERS_CLI_HUB_BASE = `http://127.0.0.1:${relateServer.address().port}/api/v1`;

    // pick "1", keep name, consent 's', keep both drafts,
    // relate 's', pick portfolio "1" (numbered fallback).
    const ask = fakeAsk(['1', '', 's', '', '', 's', '1']);
    const { out } = await captureStdout(() =>
      runAddAgents({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }),
    );

    assert.ok(relateBody, 'relate PATCH was sent');
    assert.match(relateUrl, /\/works\/me\/agents\/99\/portfolios$/);
    assert.equal(relateHeaders.authorization, 'Bearer hub.tok', 'DIRECT to hub with the talent hub token');
    assert.equal(relateHeaders['x-hub-token'], undefined);
    assert.deepEqual(relateBody.items, [{ portfolioId: 'pf-1' }]);
    assert.match(out, /relacionado con "Shakers CLI"/);
  } finally {
    inventoryServer.close(); listServer.close(); draftServer.close();
    declareServer.close(); portfoliosServer.close(); relateServer.close();
  }
});

test('ADR-041 idempotent: an already-added agent skips declare and goes straight to relate', async () => {
  const inventoryServer = await startInventoryServer([AGENT_IN_INVENTORY]);
  const listServer = await startListServer([{ name: 'backend-developer', id: 99 }]);
  const draftServer = await startDraftServer();
  let declareHit = false;
  const declareServer = await startDeclareServer(() => { declareHit = true; });
  const portfoliosServer = await startPortfoliosListServer([{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO' }]);
  let relateBody = null;
  let relateUrl = null;
  const relateServer = await startRelateServer((body, headers, url) => { relateBody = body; relateUrl = url; });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT = urlOf(listServer, '/agents');
    process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT = urlOf(declareServer, '/agents/declare');
    process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT = urlOf(draftServer, '/agents/draft-fields');
    process.env.SHAKERS_CLI_PORTFOLIOS_LIST_ENDPOINT = urlOf(portfoliosServer, '/portfolios');
    process.env.SHAKERS_CLI_HUB_BASE = `http://127.0.0.1:${relateServer.address().port}/api/v1`;

    // pick "1", keep the (duplicate) name '', relate 's', pick portfolio "1".
    const ask = fakeAsk(['1', '', 's', '1']);
    const { out } = await captureStdout(() =>
      runAddAgents({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }),
    );

    assert.equal(declareHit, false, 'an existing agent is never re-declared (no 409)');
    assert.ok(relateBody, 'relate PATCH was sent for the existing agent');
    assert.match(relateUrl, /\/works\/me\/agents\/99\/portfolios$/);
    assert.deepEqual(relateBody.items, [{ portfolioId: 'pf-1' }]);
  } finally {
    inventoryServer.close(); listServer.close(); draftServer.close();
    declareServer.close(); portfoliosServer.close(); relateServer.close();
  }
});

test('ADR-041: no portfolios -> relate step skips cleanly, agent still declared', async () => {
  const inventoryServer = await startInventoryServer([AGENT_IN_INVENTORY]);
  const listServer = await startListServer([]);
  const draftServer = await startDraftServer();
  const declareServer = await startDeclareServer(null, { id: 99, name: 'backend-developer' });
  const portfoliosServer = await startPortfoliosListServer([]); // empty -> no experiences
  let relateHit = false;
  const relateServer = await startRelateServer(() => { relateHit = true; });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.SHAKERS_CLI_AGENTS_LIST_ENDPOINT = urlOf(listServer, '/agents');
    process.env.SHAKERS_CLI_AGENTS_DECLARE_ENDPOINT = urlOf(declareServer, '/agents/declare');
    process.env.SHAKERS_CLI_AGENTS_DRAFT_FIELDS_ENDPOINT = urlOf(draftServer, '/agents/draft-fields');
    process.env.SHAKERS_CLI_PORTFOLIOS_LIST_ENDPOINT = urlOf(portfoliosServer, '/portfolios');
    process.env.SHAKERS_CLI_HUB_BASE = `http://127.0.0.1:${relateServer.address().port}/api/v1`;

    const ask = fakeAsk(['1', '', 's', '', '']);
    const { out } = await captureStdout(() =>
      runAddAgents({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }),
    );

    assert.equal(relateHit, false, 'no experiences -> never PATCHes');
    assert.match(out, /añadido a tu perfil/);
    assert.match(out, /Todavía no tienes experiencias/);
  } finally {
    inventoryServer.close(); listServer.close(); draftServer.close();
    declareServer.close(); portfoliosServer.close(); relateServer.close();
  }
});
