'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { getCatalog } = require('../src/i18n');
const { runAddSkills, parseMultiIndices } = require('../src/start-add-skills');
const { saveAuthSession } = require('../src/auth-session-store');

// Captures process.stdout.write for the duration of `fn` (same helper shape as test/certify-disclaimer.test.js's own — scoped, restored in `finally`).
async function captureStdout(fn) {
  await new Promise((r) => setImmediate(r));
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    const value = await fn();
    return { value, out };
  } finally {
    process.stdout.write = original;
  }
}

// talents-ai-score: `start`'s "Añadir skills" route.

// --- parseMultiIndices (pure) -------------------------------------------------

test('parseMultiIndices: comma-separated, space-separated, deduped, sorted', () => {
  assert.deepEqual(parseMultiIndices('1,3', 3), [0, 2]);
  assert.deepEqual(parseMultiIndices('2 1 2', 3), [0, 1]);
  assert.deepEqual(parseMultiIndices('  3  ', 3), [2]);
});

test('parseMultiIndices: empty, out-of-range, or non-numeric -> null (never guesses)', () => {
  assert.equal(parseMultiIndices('', 3), null);
  assert.equal(parseMultiIndices('   ', 3), null);
  assert.equal(parseMultiIndices('0', 3), null);
  assert.equal(parseMultiIndices('4', 3), null);
  assert.equal(parseMultiIndices('react', 3), null);
  assert.equal(parseMultiIndices('1,react', 3), null);
});

// --- runAddSkills (integration, real env vars + local stub servers) ----------

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function urlOf(server, p) {
  return `http://127.0.0.1:${server.address().port}${p}`;
}

function worksErrorBody(code, message = 'error') {
  return JSON.stringify({ status: 'KO', code, message, meta: {} });
}

// A discovered-inventory stub returning ONE skill (React, skillId 1) by default — override `skills` for the empty/multi-candidate cases.
function startInventoryServer(skills = [{ skillId: 1, skillName: 'React', technologies: ['React'] }], onReq) {
  return startServer((req, res) => {
    if (onReq) onReq(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { skills, agents: [] } }));
  });
}

function fakeAsk(answers) {
  let i = 0;
  const asked = [];
  const fn = async (question) => {
    asked.push(question);
    return i < answers.length ? answers[i++] : '';
  };
  fn.asked = asked;
  return fn;
}

let tmpProjectDir;
let savedEnv;

function writeReactProject() {
  fs.writeFileSync(
    path.join(tmpProjectDir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }),
  );
}

test.beforeEach(() => {
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-add-skills-'));
  savedEnv = {
    SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT: process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT,
    AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT: process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT,
    AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT: process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT,
    AI_FOOTPRINT_INGEST_ENDPOINT: process.env.AI_FOOTPRINT_INGEST_ENDPOINT,
    AI_FOOTPRINT_CONFIG_DIR: process.env.AI_FOOTPRINT_CONFIG_DIR,
    AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT: process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT,
    AI_FOOTPRINT_PORTFOLIO_UPDATE_ENDPOINT: process.env.AI_FOOTPRINT_PORTFOLIO_UPDATE_ENDPOINT,
  };
  delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
  process.env.AI_FOOTPRINT_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'start-add-skills-cfg-'));
});
test.afterEach(() => {
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const catalog = getCatalog('es');
const session = { email: 'talent@example.com', accessToken: 'certs.jwt', hubAccessToken: 'hub.jwt' };

test('runAddSkills: inventory fetch fails (500) -> actionable error, no picker, no declare', async () => {
  let declareHit = false;
  const inventoryServer = await startServer((_req, res) => { res.writeHead(500); res.end('boom'); });
  const declareServer = await startServer((_req, res) => { declareHit = true; res.writeHead(200); res.end('{}'); });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['s']); // accept the disclaimer; the fetch then fails
    const originalErr = process.stderr.write;
    process.stderr.write = () => true;
    try {
      await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    } finally {
      process.stderr.write = originalErr;
    }
    assert.equal(declareHit, false);
    assert.equal(ask.asked.length, 1); // only the disclaimer, never the picker
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

test('runAddSkills: no resolve-addable/declare endpoint configured -> actionable error, no network', async () => {
  writeReactProject();
  delete process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT;
  delete process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT;
  const ask = fakeAsk([]);
  await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
  assert.equal(ask.asked.length, 0);
});

test('runAddSkills: declining the disclaimer aborts BEFORE any egress (ADR-001/052)', async () => {
  let hit = false;
  const inventoryServer = await startInventoryServer(undefined, () => { hit = true; });
  const declareServer = await startServer((_req, res) => { hit = true; res.writeHead(200); res.end('{}'); });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['n']); // declines the disclaimer y/n
    await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(hit, false);
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

// Full happy path: the inventory returns ONE skill -> the Talent picks it in
// the numbered fallback -> declared successfully.
test('runAddSkills: full happy path — one inventory skill, picked, declared', async () => {
  const seenInventory = [];
  const seenDeclare = [];
  const inventoryServer = await startInventoryServer(
    [{ skillId: 1, skillName: 'React', technologies: ['React'] }],
    (req) => { seenInventory.push({ method: req.method, auth: req.headers.authorization, hubToken: req.headers['x-hub-token'] }); },
  );
  const declareServer = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seenDeclare.push({ body: JSON.parse(raw), auth: req.headers.authorization, hubToken: req.headers['x-hub-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: [{ talentId: 't1', skill: { id: 1, name: 'React' }, highlighted: false, level: 1, verified: false }] }));
    });
  });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    // disclaimer accept ("s"), then pick "1" in the numbered multi-select fallback.
    const ask = fakeAsk(['s', '1']);
    await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });

    assert.equal(seenInventory[0].method, 'GET');
    assert.equal(seenInventory[0].auth, 'Bearer certs.jwt');
    assert.equal(seenInventory[0].hubToken, undefined); // discovered-inventory NEVER sends X-Hub-Token

    assert.equal(seenDeclare.length, 1);
    assert.deepEqual(seenDeclare[0].body, { skillId: 1 });
    assert.equal(seenDeclare[0].auth, 'Bearer certs.jwt');
    assert.equal(seenDeclare[0].hubToken, 'hub.jwt');
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

/* ---------------- relate-to-portfolio (ADR-038) ---------------- */

test('runAddSkills: relate accepted -> PATCHes the chosen portfolio with the merged skillIds', async () => {
  const inventoryServer = await startInventoryServer([{ skillId: 1, skillName: 'React', technologies: ['React'] }]);
  const declareServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  const listServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [2] }] }));
  });
  const seenUpdate = [];
  const updateServer = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seenUpdate.push({ method: req.method, url: req.url, raw, auth: req.headers.authorization });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: {} }));
    });
  });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIO_UPDATE_ENDPOINT = urlOf(updateServer, '/works/portfolios');
    // disclaimer accept, pick "1" skill, relate "s", pick "1" portfolio.
    const ask = fakeAsk(['s', '1', 's', '1']);
    await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });

    assert.equal(seenUpdate.length, 1);
    assert.equal(seenUpdate[0].method, 'PATCH');
    assert.equal(seenUpdate[0].url, '/works/portfolios/pf-1');
    assert.equal(seenUpdate[0].auth, 'Bearer hub.jwt');
    assert.match(seenUpdate[0].raw, /name="skillIds"/);
    assert.match(seenUpdate[0].raw, /2,1/);
  } finally {
    inventoryServer.close();
    declareServer.close();
    listServer.close();
    updateServer.close();
  }
});

test('runAddSkills: relate declined -> no PATCH call, skipped message printed', async () => {
  const inventoryServer = await startInventoryServer([{ skillId: 1, skillName: 'React', technologies: ['React'] }]);
  const declareServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  const listServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [] }] }));
  });
  let updateHit = false;
  const updateServer = await startServer((_req, res) => { updateHit = true; res.writeHead(200); res.end('{}'); });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIO_UPDATE_ENDPOINT = urlOf(updateServer, '/works/portfolios');
    const ask = fakeAsk(['s', '1', 'n']);
    const { out } = await captureStdout(() => runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.equal(updateHit, false);
    assert.match(out, /añadida sin relacionar/);
  } finally {
    inventoryServer.close();
    declareServer.close();
    listServer.close();
    updateServer.close();
  }
});

test('runAddSkills: the relate header prints the RESOLVED title once, never the raw function source', async () => {
  const inventoryServer = await startInventoryServer([{ skillId: 1, skillName: 'React', technologies: ['React'] }]);
  const declareServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  const listServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [] }] }));
  });
  const updateServer = await startServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"OK","data":{}}'); });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIO_UPDATE_ENDPOINT = urlOf(updateServer, '/works/portfolios');
    const ask = fakeAsk(['s', '1', 's', '1']);
    const { out } = await captureStdout(() => runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));

    const resolved = catalog.start.addSkillsRelateSelectHeading('React');
    const occurrences = out.split(resolved).length - 1;
    assert.equal(occurrences, 1, 'the resolved title prints exactly once, never doubled');
    assert.equal(out.includes('=>'), false, 'the raw arrow-function source must never leak into the header');
    assert.equal(out.includes('${skillName}'), false, 'the unresolved template placeholder must never print');
  } finally {
    inventoryServer.close();
    declareServer.close();
    listServer.close();
    updateServer.close();
  }
});

test('runAddSkills: no portfolios yet -> declares the skill anyway, warns fail-soft, no relate prompt', async () => {
  const inventoryServer = await startInventoryServer([{ skillId: 1, skillName: 'React', technologies: ['React'] }]);
  const declareServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  const listServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIO_UPDATE_ENDPOINT = 'http://127.0.0.1:1/works/portfolios';
    const ask = fakeAsk(['s', '1']);
    const { out } = await captureStdout(() => runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.equal(ask.asked.length, 2); // disclaimer + skill pick, never asked to relate
    assert.match(out, /Todavía no tienes proyectos en tu portfolio/);
  } finally {
    inventoryServer.close();
    declareServer.close();
    listServer.close();
  }
});

test('vision close: at least one skill declared -> the profile-boost line prints once, after the batch', async () => {
  const inventoryServer = await startInventoryServer([{ skillId: 1, skillName: 'React', technologies: ['React'] }]);
  const declareServer = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [{ talentId: 't1', skill: { id: 1, name: 'React' }, highlighted: false, level: 1, verified: false }] }));
  });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['s', '1']);
    const { out } = await captureStdout(() => runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.match(out, /Cada skill que añades suma a tu perfil/);
    // Printed AFTER the per-skill confirmation, not before it or interleaved.
    assert.ok(out.indexOf('Añadida a tu perfil') < out.indexOf('Cada skill que añades suma'));
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

test('vision close: EVERY declare fails -> no profile-boost line (nothing to claim)', async () => {
  const inventoryServer = await startInventoryServer([{ skillId: 1, skillName: 'React', technologies: ['React'] }]);
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    // An unreachable port -> the declare call itself fails as a network error
    // (never `hub-session-expired`, never `ok:true`) — a clean all-failed batch.
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = 'http://127.0.0.1:1/declare';
    const ask = fakeAsk(['s', '1']);
    const { out } = await captureStdout(() => runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.equal(out.includes('Cada skill que añades suma a tu perfil'), false);
    assert.match(out, /No se pudo añadir/); // the failure IS reported, just not as a boost
  } finally {
    inventoryServer.close();
  }
});

test('runAddSkills: an empty inventory -> "nothing to add", no picker, no declare call', async () => {
  let declareHit = false;
  const inventoryServer = await startInventoryServer([]);
  const declareServer = await startServer((_req, res) => { declareHit = true; res.writeHead(200); res.end('{}'); });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['s']); // only the disclaimer — no picker question follows
    await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(declareHit, false);
    assert.equal(ask.asked.length, 1); // never reached the multi-select picker
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

test('runAddSkills: multiple candidates -> multi-select picker offers all of them, comma-separated pick declares both', async () => {
  const seenDeclares = [];
  const inventoryServer = await startInventoryServer([
    { skillId: 1, skillName: 'React', technologies: ['React'] },
    { skillId: 2, skillName: 'Express', technologies: ['Express'] },
  ]);
  const declareServer = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seenDeclares.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: [] }));
    });
  });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['s', '1,2']); // disclaimer accept, pick BOTH candidates
    await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.deepEqual(seenDeclares, [{ skillId: 1 }, { skillId: 2 }]);
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

test('runAddSkills: no hubAccessToken on the session -> actionable message BEFORE the picker, no declare call attempted', async () => {
  let declareHit = false;
  const inventoryServer = await startInventoryServer();
  const declareServer = await startServer((_req, res) => { declareHit = true; res.writeHead(200); res.end('{}'); });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['s']); // only the disclaimer — the missing hub token stops it before any picker
    const sessionNoHub = { ...session, hubAccessToken: null };
    const originalErr = process.stderr.write;
    process.stderr.write = () => true;
    try {
      await runAddSkills({ ask, catalog, root: tmpProjectDir, session: sessionNoHub, stdinIsTTY: true });
    } finally {
      process.stderr.write = originalErr;
    }
    assert.equal(declareHit, false);
    assert.equal(ask.asked.length, 1);
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

test('runAddSkills: the inventory fetch 401s with a PLAIN code -> actionable error, no re-login offered', async () => {
  const inventoryServer = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }));
  });
  const declareServer = await startServer((_req, res) => { res.writeHead(200); res.end('{}'); });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['s']); // disclaimer accept only — no re-login prompt should follow
    const originalErr = process.stderr.write;
    process.stderr.write = () => true;
    try {
      await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    } finally {
      process.stderr.write = originalErr;
    }
    assert.equal(ask.asked.length, 1);
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

// hub-session-expired mid-flow: the DECLARE call 401s with works.hub_session_expired;
// `start` offers to re-login right there; declining stops cleanly.
test('runAddSkills: hub-session-expired on declare, decline re-login -> stops, no further declare calls', async () => {
  let declareCalls = 0;
  const inventoryServer = await startInventoryServer();
  const declareServer = await startServer((_req, res) => {
    declareCalls += 1;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_session_expired'));
  });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['s', '1', 'n']); // disclaimer accept, pick candidate, decline the re-login offer
    const runLogin = async () => {};
    await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true, deps: { runLogin } });
    assert.equal(declareCalls, 1); // stopped hammering after the first 401
  } finally {
    inventoryServer.close();
    declareServer.close();
  }
});

// Accepting the re-login offer retries the PENDING declare with the FRESH
// hubAccessToken the (fake) `runLogin` leaves behind.
test('runAddSkills: hub-session-expired on declare, accept re-login -> retries the pending skill with the fresh token', async () => {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-add-skills-cfg-'));
  const prevConfigDir = process.env.AI_FOOTPRINT_CONFIG_DIR;
  process.env.AI_FOOTPRINT_CONFIG_DIR = configDir;

  const seenDeclareTokens = [];
  const inventoryServer = await startInventoryServer();
  const declareServer = await startServer((req, res) => {
    seenDeclareTokens.push(req.headers['x-hub-token']);
    if (seenDeclareTokens.length === 1) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(worksErrorBody('works.hub_session_expired'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  try {
    process.env.SHAKERS_CLI_USAGE_DISCOVERED_INVENTORY_ENDPOINT = urlOf(inventoryServer, '/usage/discovered-inventory');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    // disclaimer accept, pick the one candidate, accept the re-login offer.
    const ask = fakeAsk(['s', '1', 's']);
    // The fake `runLogin` simulates a fresh login by persisting a NEW session
    // with a fresh hubAccessToken — exactly what bin/login.js#run does.
    const runLogin = async () => {
      saveAuthSession({ accessToken: 'certs.jwt.new', expiresAt: '2999-01-01T00:00:00.000Z', hubAccessToken: 'hub.jwt.new' });
    };
    await runAddSkills({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true, deps: { runLogin } });
    assert.deepEqual(seenDeclareTokens, ['hub.jwt', 'hub.jwt.new']);
  } finally {
    inventoryServer.close();
    declareServer.close();
    if (prevConfigDir === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR;
    else process.env.AI_FOOTPRINT_CONFIG_DIR = prevConfigDir;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});
