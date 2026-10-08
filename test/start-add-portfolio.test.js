'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const { getCatalog } = require('../src/i18n');
const { runAddPortfolio, normalizeDomain } = require('../src/start-add-portfolio');

test('normalizeDomain: strips protocol, www, path/query/fragment to a bare domain', () => {
  assert.equal(normalizeDomain('https://www.acme.com/about'), 'acme.com');
  assert.equal(normalizeDomain('http://acme.com/'), 'acme.com');
  assert.equal(normalizeDomain('www.acme.com'), 'acme.com');
  assert.equal(normalizeDomain('acme.com'), 'acme.com');
  assert.equal(normalizeDomain('HTTPS://ACME.COM/x?y=1#z'), 'acme.com');
  assert.equal(normalizeDomain('  '), '');
  assert.equal(normalizeDomain(''), '');
  assert.equal(normalizeDomain(null), '');
});
const { saveAuthSession } = require('../src/auth-session-store');

// talents-ai-score, ADR-059: `start`'s "Add project to portfolio" route.

function captureStdout(fn) {
  return new Promise((resolve, reject) => {
    setImmediate(async () => {
      const original = process.stdout.write;
      let out = '';
      process.stdout.write = (chunk) => { out += chunk; return true; };
      try {
        const value = await fn();
        resolve({ value, out });
      } catch (e) {
        reject(e);
      } finally {
        process.stdout.write = original;
      }
    });
  });
}

// item 2 (dueño, 2026-08-12): every network call in this route now shows a spinner via `withSpinner` (src/terminal-progress.js, issue 078's mechanism) — on STDERR, never stdout.
function captureStderr(fn) {
  return new Promise((resolve, reject) => {
    setImmediate(async () => {
      const original = process.stderr.write;
      let err = '';
      process.stderr.write = (chunk) => { err += chunk; return true; };
      try {
        const value = await fn();
        resolve({ value, err });
      } catch (e) {
        reject(e);
      } finally {
        process.stderr.write = original;
      }
    });
  });
}

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

// A queue-based fake `ask` with NO `.suspend` — every picker in this flow degrades to its numbered/line-prompt fallback, same test-double shape test/start-add-skills.test.js uses.
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

// A bare list-portfolios stub (empty list = "no duplicates possible") — every
// test overrides only what it cares about.
function startListServer(portfolios = []) {
  return startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: portfolios }));
  });
}
function startDeclareServer(onBody) {
  return startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (onBody) onBody(JSON.parse(raw), req.headers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: { name: 'x' } }));
    });
  });
}

let tmpProjectDir;
let savedEnv;

function git(dir, args, env) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', env: env || process.env });
}

// A plain project (no git, no manifest) — the simplest fixture, used by every test that doesn't care about tech detection, the remote URL, or the commit date range.
function writePlainProject(dir) {
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
}

test.beforeEach(() => {
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-add-portfolio-'));
  savedEnv = {
    AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT: process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT,
    AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT: process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT,
    AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT: process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT,
    AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT: process.env.AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT,
    AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT: process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT,
    AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT: process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT,
    AI_FOOTPRINT_INGEST_ENDPOINT: process.env.AI_FOOTPRINT_INGEST_ENDPOINT,
    AI_FOOTPRINT_CONFIG_DIR: process.env.AI_FOOTPRINT_CONFIG_DIR,
  };
  delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
  delete process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT;
  delete process.env.AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT;
  delete process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT;
  delete process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT;
  process.env.AI_FOOTPRINT_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'start-add-portfolio-cfg-'));
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

/* ---------------- pre-flight: endpoints / hub token ---------------- */

test('runAddPortfolio: no list/declare endpoint configured -> actionable error, no network', async () => {
  writePlainProject(tmpProjectDir);
  const ask = fakeAsk([]);
  await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
  assert.equal(ask.asked.length, 0);
});

test('runAddPortfolio: no hubAccessToken on the session -> actionable error BEFORE any step, no network', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk([]);
    const sessionNoHub = { ...session, hubAccessToken: null };
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session: sessionNoHub, stdinIsTTY: true });
    assert.equal(ask.asked.length, 0);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

/* ---------------- pre-fill (step 1: title) ---------------- */

test('pre-fill: an EMPTY answer at the title prompt accepts the directory name as the default', async () => {
  writePlainProject(tmpProjectDir);
  const dirName = path.basename(tmpProjectDir);
  const listServer = await startListServer();
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '1', '', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenDeclares[0].name, dirName);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('pre-fill: typing a NEW title overrides the directory-name default', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['My Custom Title', '1', '', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenDeclares[0].name, 'My Custom Title');
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('pre-fill: type is OBLIGATORIO -- no answer at the type step cancels the WHOLE route, no declare call', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  let declareHit = false;
  const declareServer = await startServer((_req, res) => { declareHit = true; res.writeHead(200); res.end('{}'); });
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '']); // title default, EMPTY at the type prompt -> cancel
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(declareHit, false);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

/* ---------------- dedup ---------------- */

test('dedup: an existing portfolio with the SAME name (case-insensitive) aborts BEFORE the type step, no declare call', async () => {
  writePlainProject(tmpProjectDir);
  const dirName = path.basename(tmpProjectDir);
  const listServer = await startListServer([{ name: dirName.toUpperCase(), type: 'PORTFOLIO' }]);
  let declareHit = false;
  const declareServer = await startServer((_req, res) => { declareHit = true; res.writeHead(200); res.end('{}'); });
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['']); // accept the default title -> collides
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(declareHit, false);
    assert.equal(ask.asked.length, 1); // never reached the type step
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('dedup: a DIFFERENT existing name does not block -- the flow proceeds normally', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer([{ name: 'Some Other Project', type: 'PORTFOLIO' }]);
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '1', '', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenDeclares.length, 1);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('dedup: the LIST call failing is reported honestly and does NOT block the flow', async () => {
  writePlainProject(tmpProjectDir);
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    // An unreachable list endpoint -> the dedup check itself fails.
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = 'http://127.0.0.1:1/portfolios';
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '1', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.match(out, /No se pudo comprobar si ya tienes un proyecto/);
    assert.equal(seenDeclares.length, 1); // still proceeded
  } finally {
    declareServer.close();
  }
});

/* ---------------- description: consent -> draft vs free-text ---------------- */

test('description: consent ACCEPTED + draft succeeds -> the draft is SHOWN, and an empty enter CONSERVES it (RECURRING bug, dueño 2026-08-12)', async () => {
  writePlainProject(tmpProjectDir);
  fs.writeFileSync(path.join(tmpProjectDir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }));
  const listServer = await startListServer();
  const draftServer = await startServer((_req, res) => {
    // ENVELOPED — corrected contract, verified live against certs local
    // :3004 (dueño, 2026-08-12).
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { description: 'A React project analyzed locally.' } }));
  });
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT = urlOf(draftServer, '/draft-description');
    // title, type=1, disclaimer ACCEPT ('s'), keep the draft as-is (empty),
    // url(empty), skills(none detected -> no ask), client(empty).
    const ask = fakeAsk(['', '1', 's', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    // (a) the draft is actually DISPLAYED — the bug this fixes: the return value (below) was already correct, but nothing ever showed the talent WHAT "keep it as is" referred to.
    assert.match(out, /A React project analyzed locally\./);
    // (b) an empty enter CONSERVES that same draft, never an empty string.
    assert.equal(seenDeclares[0].description, 'A React project analyzed locally.');
    assert.notEqual(seenDeclares[0].description, '');
  } finally {
    listServer.close();
    draftServer.close();
    declareServer.close();
  }
});

test('item 2: dedup check, AI draft, and the portfolio declare each show their own spinner label on STDERR', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const draftServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { description: 'Loader-covered draft.' } }));
  });
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT = urlOf(draftServer, '/draft-description');
    const ask = fakeAsk(['', '1', 's', '', '', '']);
    const originalStdoutWrite = process.stdout.write;
    let out = '';
    process.stdout.write = (chunk) => { out += chunk; return true; };
    let err;
    try {
      ({ err } = await captureStderr(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true })));
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
    assert.match(err, /Comprobando tu portfolio…/); // portfolioDedupCheckingLabel
    assert.match(err, /Redactando un borrador con IA…/); // portfolioDescriptionDraftingLabel
    assert.match(err, /Añadiendo el proyecto a tu portfolio…/); // portfolioDeclaring, now a spinner label
    // None of the spinner labels leak into STDOUT — progress feedback is a
    // side channel, same discipline every other spinner in this repo keeps.
    assert.equal(out.includes('Comprobando tu portfolio…'), false);
    assert.equal(out.includes('Redactando un borrador con IA…'), false);
  } finally {
    listServer.close();
    draftServer.close();
    declareServer.close();
  }
});

test('opt-in declare: NO spinner around it any more (the bug) -- the per-skill result lands clean on stdout, nothing on stderr for this step', async () => {
  writeReactProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  const resolveAddableServer = await startResolveAddableServer([{ skillId: 449, skillName: 'Nest JS', technology: 'NestJS' }]);
  const seenSkillDeclares = [];
  const skillsDeclareServer = await startSkillsDeclareServer((body) => seenSkillDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT = urlOf(resolveAddableServer, '/resolve-addable');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(skillsDeclareServer, '/declare-skill');
    const ask = fakeAsk(['', '1', '', '', '', '']);
    const originalStdoutWrite = process.stdout.write;
    let out = '';
    process.stdout.write = (chunk) => { out += chunk; return true; };
    let err;
    try {
      ({ err } = await captureStderr(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true })));
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
    assert.equal(seenSkillDeclares.length, 1);
    // The "Adding skills…"/"Añadiendo skills…" spinner label is GONE — the
    // catalog key itself was retired (dueño, 2026-08-12).
    assert.equal(err.includes('Añadiendo skills a tu perfil'), false, 'no spinner label for the declare step any more');
    assert.equal(out.includes('Añadiendo skills a tu perfil'), false);
    // No spinner glyph/escape sequence on stderr for the declare step
    // either — the ONLY spinner activity left is the earlier resolve step.
    assert.equal(/⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/.test(err), false, 'no spinner frame glyph leaked onto stderr');
    // The per-skill result lands clean on STDOUT, its own line, no residue
    // glued to it (no `\x1b[2K`, no leftover braille glyph, no missing erase).
    assert.match(out, /✓ Añadida a tu perfil: Nest JS \(sin verificar\)\.\n/);
    assert.equal(out.includes('\x1b[2K'), false, 'stdout never carries a stderr-only escape sequence');
  } finally {
    listServer.close();
    declareServer.close();
    resolveAddableServer.close();
    skillsDeclareServer.close();
  }
});

test('description: consent ACCEPTED + draft succeeds -> the Talent can EDIT the draft', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const draftServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { description: 'AI-drafted sentence.' } }));
  });
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT = urlOf(draftServer, '/draft-description');
    const ask = fakeAsk(['', '1', 's', 'My edited sentence.', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenDeclares[0].description, 'My edited sentence.');
  } finally {
    listServer.close();
    draftServer.close();
    declareServer.close();
  }
});

test('description: consent DECLINED -> straight to free-text, draft-description is NEVER called (ADR-052)', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  let draftHit = false;
  const draftServer = await startServer((_req, res) => { draftHit = true; res.writeHead(200); res.end(JSON.stringify({ description: 'x' })); });
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT = urlOf(draftServer, '/draft-description');
    // title, type=1, disclaimer DECLINE ('n'), free-text description, url, client.
    const ask = fakeAsk(['', '1', 'n', 'A hand-written description.', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(draftHit, false);
    assert.equal(seenDeclares[0].description, 'A hand-written description.');
  } finally {
    listServer.close();
    draftServer.close();
    declareServer.close();
  }
});

test('description: draft-description FAILS (network error) -> falls back to free-text, never blocks the flow', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT = 'http://127.0.0.1:1/draft-description';
    const ask = fakeAsk(['', '1', 's', 'Fallback free text.', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenDeclares[0].description, 'Fallback free text.');
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('description: NO draft-description endpoint configured -> straight to free-text, no consent question asked at all', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    // No draft endpoint env set (beforeEach deletes it). title, type=1, then
    // the NEXT answer is the free-text description directly (no 's'/'n').
    const ask = fakeAsk(['', '1', 'Straight to free text.', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenDeclares[0].description, 'Straight to free text.');
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('description consent: shows the PORTFOLIO\'s own disclosure, never certify\'s (the bug)', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const draftServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { description: 'x' } }));
  });
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT = urlOf(draftServer, '/draft-description');
    const ask = fakeAsk(['', '1', 's', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.ok(
      out.includes(catalog.start.portfolioDescriptionConsentDisclaimer),
      'must show the portfolio\'s OWN short consent text',
    );
    assert.equal(
      out.includes(catalog.certify.disclaimer),
      false,
      'must NEVER show certify\'s disclaimer (certifying Skills / sending code) in the middle of the portfolio flow — the reported bug',
    );
  } finally {
    listServer.close();
    draftServer.close();
    declareServer.close();
  }
});

test('description consent: draft-description is called with consent:true (the OTHER half of the bug: it was never sent before)', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const seenDraftBodies = [];
  const draftServer = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seenDraftBodies.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: { description: 'A drafted sentence.' } }));
    });
  });
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT = urlOf(draftServer, '/draft-description');
    const ask = fakeAsk(['', '1', 's', '', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenDraftBodies.length, 1);
    assert.equal(seenDraftBodies[0].consent, true);
  } finally {
    listServer.close();
    draftServer.close();
    declareServer.close();
  }
});

test('description consent: 403 works.ai_consent_required (declined server-side) falls back to free-text, never shows certify\'s disclaimer', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const draftServer = await startServer((_req, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'KO', code: 'works.ai_consent_required', message: 'no consent', meta: {} }));
  });
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT = urlOf(draftServer, '/draft-description');
    // title, type=1, disclaimer ACCEPT ('s') -> draft call 403s -> free-text.
    const ask = fakeAsk(['', '1', 's', 'Written by hand after the 403.', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.equal(seenDeclares[0].description, 'Written by hand after the 403.');
    assert.equal(out.includes(catalog.certify.disclaimer), false);
  } finally {
    listServer.close();
    draftServer.close();
    declareServer.close();
  }
});

/* --- Part B (dueño, 2026-08-12): questions highlighted bold + brand colour -- */

const SGR = /\x1b\[[0-9;]*m/;
function withStdout({ isTTY, noColor }, fn) {
  const realTTY = process.stdout.isTTY;
  const realNoColor = process.env.NO_COLOR;
  process.stdout.isTTY = isTTY;
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
  return fn().finally(() => {
    process.stdout.isTTY = realTTY;
    if (realNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = realNoColor;
  });
}

test('Part B: text ask() prompts (title, description, url, client) render through styleQuestion on a real terminal', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '1', '', '', '']);
    await withStdout({ isTTY: true }, () => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    // Every question actually asked (title default, type number, free-text description, url, client) must carry the SGR style — the CONTENT is untouched (still findable as a substring).
    assert.ok(ask.asked.length > 0);
    for (const q of ask.asked) assert.match(q, SGR, `expected "${q}" to be highlighted`);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('Part B: NO_COLOR leaves every ask() prompt as plain, unstyled text', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '1', '', '', '']);
    await withStdout({ isTTY: true, noColor: '1' }, () => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    for (const q of ask.asked) assert.equal(SGR.test(q), false, `expected "${q}" to stay plain under NO_COLOR`);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

/* ---------------- skills: pre-marked multi-select ---------------- */

test('skills: the portfolio picker calls resolve-matched, NEVER resolve-addable -- offers an ALREADY-DECLARED skill too', async () => {
  fs.writeFileSync(path.join(tmpProjectDir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }));
  const listServer = await startListServer();
  let addableHit = false;
  // `resolve-addable`: EMPTY — as if React's Skill were ALREADY declared and
  // therefore excluded from the "addable" complement.
  const addableServer = await startServer((_req, res) => {
    addableHit = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  // `resolve-matched`: returns React regardless — this is what the portfolio
  // route must actually use.
  const matchedServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [{ skillId: 1, skillName: 'React', technology: 'React' }] }));
  });
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT = urlOf(addableServer, '/resolve-addable');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT = urlOf(matchedServer, '/resolve-matched');
    const ask = fakeAsk(['', '1', '', '', '', '']); // skills step: empty -> keep the pre-marked default
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(addableHit, false, 'resolve-addable must NEVER be called from the portfolio route');
    assert.deepEqual(seenDeclares[0].skillIds, [1], 'the "already-declared" skill (per the addable stub) IS offered and included');
  } finally {
    delete process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT;
    listServer.close();
    addableServer.close();
    matchedServer.close();
    declareServer.close();
  }
});

test('skills: pre-marked ALL, empty answer at the fallback KEEPS every candidate (never "none")', async () => {
  fs.writeFileSync(path.join(tmpProjectDir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }));
  const listServer = await startListServer();
  const resolveServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [{ skillId: 1, skillName: 'React', technology: 'React' }] }));
  });
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT = urlOf(resolveServer, '/resolve-matched');
    // title, type=1, description(free-text, no draft endpoint), url, skills(EMPTY -> keep all), client.
    const ask = fakeAsk(['', '1', '', '', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.deepEqual(seenDeclares[0].skillIds, [1]);
  } finally {
    listServer.close();
    resolveServer.close();
    declareServer.close();
  }
});

test('skills: step 5 heading explicitly says these skills ADD TO YOUR PROFILE, not just "for this project"', async () => {
  fs.writeFileSync(path.join(tmpProjectDir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }));
  const listServer = await startListServer();
  const resolveServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [{ skillId: 1, skillName: 'React', technology: 'React' }] }));
  });
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT = urlOf(resolveServer, '/resolve-matched');
    const ask = fakeAsk(['', '1', '', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.match(out, /se añaden a tu perfil/);
  } finally {
    listServer.close();
    resolveServer.close();
    declareServer.close();
  }
});

test('skills: the Talent can UNCHECK -- typing indices replaces the pre-marked default', async () => {
  fs.writeFileSync(path.join(tmpProjectDir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0', express: '^4.0.0' } }));
  const listServer = await startListServer();
  const resolveServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      data: [{ skillId: 1, skillName: 'React', technology: 'React' }, { skillId: 2, skillName: 'Express', technology: 'Express' }],
    }));
  });
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT = urlOf(resolveServer, '/resolve-matched');
    // Keep ONLY React (index 1) — Express gets unchecked.
    const ask = fakeAsk(['', '1', '', '', '1', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.deepEqual(seenDeclares[0].skillIds, [1]);
  } finally {
    listServer.close();
    resolveServer.close();
    declareServer.close();
  }
});

test('skills: no detected technology / no resolve-matched endpoint -> skipped silently, skillIds omitted', async () => {
  writePlainProject(tmpProjectDir); // no package.json at all
  const listServer = await startListServer();
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    // No skills ask at all: title, type, description, url, client.
    const ask = fakeAsk(['', '1', '', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal('skillIds' in seenDeclares[0], false);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

/* ---------------- url + dates (git) ---------------- */

test('url: the git remote is detected and pre-filled; the Talent can override it', async () => {
  git(tmpProjectDir, ['init', '-q']);
  git(tmpProjectDir, ['remote', 'add', 'origin', 'git@github.com:acme/widgets.git']);
  git(tmpProjectDir, ['config', 'user.email', 't@example.com']);
  git(tmpProjectDir, ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(tmpProjectDir, 'a.txt'), 'a');
  git(tmpProjectDir, ['add', '-A']);
  git(tmpProjectDir, ['commit', '-q', '-m', 'init']);

  const listServer = await startListServer();
  const seenDeclares = [];
  const declareServer = await startDeclareServer((body) => seenDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    // Accept the detected URL (empty answer).
    const ask = fakeAsk(['', '1', '', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenDeclares[0].url, 'https://github.com/acme/widgets');
    assert.ok(seenDeclares[0].startDate); // auto, from git history
    assert.ok(seenDeclares[0].endDate);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

/* ---------------- declare: happy path + hub-session-expired ---------------- */

test('declare: full body — name/type/skillIds/description/url/clientName sent as chosen', async () => {
  fs.writeFileSync(path.join(tmpProjectDir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }));
  const listServer = await startListServer();
  const resolveServer = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [{ skillId: 1, skillName: 'React', technology: 'React' }] }));
  });
  const seenDeclares = [];
  const seenHeaders = [];
  const declareServer = await startDeclareServer((body, headers) => { seenDeclares.push(body); seenHeaders.push(headers); });
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_MATCHED_ENDPOINT = urlOf(resolveServer, '/resolve-matched');
    // title="My App", type=2 (EXPERIENCE), free-text description, url free-text,
    // skills keep all (empty), clientName="Acme".
    const ask = fakeAsk(['My App', '2', 'A hand-written description.', 'https://example.com/repo', '', 'Acme', 'https://www.acme.com/about']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.deepEqual(seenDeclares[0], {
      name: 'My App',
      type: 'EXPERIENCE',
      skillIds: [1],
      description: 'A hand-written description.',
      url: 'https://example.com/repo',
      clientName: 'Acme',
      clientDomain: 'acme.com', // normalized from https://www.acme.com/about
      generatedWith: 'AI', // dueño, 2026-08-12 follow-up: always sent
    });
    assert.equal(seenHeaders[0].authorization, 'Bearer certs.jwt');
    assert.equal(seenHeaders[0]['x-hub-token'], 'hub.jwt');
  } finally {
    listServer.close();
    resolveServer.close();
    declareServer.close();
  }
});

test('declare: success prints the confirmation with the chosen title', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['My App', '1', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.match(out, /"My App" añadido a tu portfolio/);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('declare: a plain failure (not hub-session-expired) reports the reason, no re-login offered', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_unavailable'));
  });
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '1', '', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.match(out, /No se pudo añadir el proyecto a tu portfolio/);
    assert.equal(ask.asked.length, 6); // never asked to re-login
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('declare: hub-session-expired, DECLINE re-login -> stops, only ONE declare attempt', async () => {
  writePlainProject(tmpProjectDir);
  const listServer = await startListServer();
  let declareCalls = 0;
  const declareServer = await startServer((_req, res) => {
    declareCalls += 1;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_session_expired'));
  });
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '1', '', '', '', 'n']); // ...decline the re-login offer
    const runLogin = async () => {};
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true, deps: { runLogin } });
    assert.equal(declareCalls, 1);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('declare: hub-session-expired, ACCEPT re-login -> retries with the FRESH hubAccessToken', async () => {
  writePlainProject(tmpProjectDir);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-add-portfolio-relogin-cfg-'));
  const prevConfigDir = process.env.AI_FOOTPRINT_CONFIG_DIR;
  process.env.AI_FOOTPRINT_CONFIG_DIR = configDir;

  const listServer = await startListServer();
  const seenTokens = [];
  const declareServer = await startServer((req, res) => {
    seenTokens.push(req.headers['x-hub-token']);
    if (seenTokens.length === 1) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(worksErrorBody('works.hub_session_expired'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: {} }));
  });
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    const ask = fakeAsk(['', '1', '', '', '', '', 's']); // ...accept the re-login offer
    const runLogin = async () => {
      saveAuthSession({ accessToken: 'certs.jwt.new', expiresAt: '2999-01-01T00:00:00.000Z', hubAccessToken: 'hub.jwt.new' });
    };
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true, deps: { runLogin } });
    assert.deepEqual(seenTokens, ['hub.jwt', 'hub.jwt.new']);
  } finally {
    listServer.close();
    declareServer.close();
    if (prevConfigDir === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR;
    else process.env.AI_FOOTPRINT_CONFIG_DIR = prevConfigDir;
    fs.rmSync(configDir, { recursive: true, force: true });
  }
});

/* ---------- item 2 (dueño, 2026-08-12): opt-in "add detected skills to
 * your PROFILE" AFTER the portfolio itself was declared ---------- */

function writeReactProject(dir) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { react: '^18.0.0' } }));
}

function startResolveAddableServer(candidates, { onRequest } = {}) {
  return startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (onRequest) onRequest(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: candidates }));
    });
  });
}
function startSkillsDeclareServer(onBody) {
  return startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (onBody) onBody(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: [] }));
    });
  });
}

test('opt-in: after the portfolio declares successfully, offers OTHER detected skills for the PROFILE (pre-marked), declares the ones kept marked', async () => {
  writeReactProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  const resolveAddableServer = await startResolveAddableServer([{ skillId: 99, skillName: 'React', technology: 'React' }]);
  const seenSkillDeclares = [];
  const skillsDeclareServer = await startSkillsDeclareServer((body) => seenSkillDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT = urlOf(resolveAddableServer, '/resolve-addable');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(skillsDeclareServer, '/declare-skill');
    const ask = fakeAsk(['', '1', '', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.match(out, /añadido a tu portfolio/); // portfolio declared first
    assert.match(out, /También detectamos otras skills/); // portfolioAddSkillsIntro
    assert.equal(seenSkillDeclares.length, 1);
    assert.equal(seenSkillDeclares[0].skillId, 99);
    assert.match(out, /Añadida a tu perfil: React/); // addSkillsDeclaredOne, reused verbatim
  } finally {
    listServer.close();
    declareServer.close();
    resolveAddableServer.close();
    skillsDeclareServer.close();
  }
});

test('opt-in: resolve-addable is called AFTER the portfolio declare succeeds -- dedup is structural, not a client-side filter', async () => {
  writeReactProject(tmpProjectDir);
  const listServer = await startListServer();
  let declareHappenedBeforeResolve = null;
  let declareDone = false;
  const declareServer = await startServer((_req, res) => {
    declareDone = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: {} }));
  });
  const resolveAddableServer = await startResolveAddableServer([], {
    onRequest: () => { declareHappenedBeforeResolve = declareDone; },
  });
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT = urlOf(resolveAddableServer, '/resolve-addable');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(resolveAddableServer, '/never-called');
    const ask = fakeAsk(['', '1', '', '', '']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(declareHappenedBeforeResolve, true, 'resolve-addable must run AFTER the portfolio declare, so the hub\'s own auto-declared skillIds are already excluded');
  } finally {
    listServer.close();
    declareServer.close();
    resolveAddableServer.close();
  }
});

test('opt-in: all skills already declared (resolve-addable returns [], but the call DID run) -> explicit message, no extra prompt, no picker', async () => {
  writeReactProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  const resolveAddableServer = await startResolveAddableServer([]);
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT = urlOf(resolveAddableServer, '/resolve-addable');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(resolveAddableServer, '/never-called');
    const ask = fakeAsk(['', '1', '', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.equal(ask.asked.length, 6, 'no extra question was asked -- the message is informational, not a prompt');
    assert.equal(out.includes('También detectamos otras skills'), false, 'the opt-in picker INTRO never shows -- there is nothing to pick from');
    assert.match(out, /Todas las skills de este proyecto ya están en tu perfil\./, 'explicit feedback replaces the old silence');
  } finally {
    listServer.close();
    declareServer.close();
    resolveAddableServer.close();
  }
});

test('opt-in: resolve call FAILS (network error, unrelated to dedup) -> stays silent, never shows the "all declared" message', async () => {
  writeReactProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT = 'http://127.0.0.1:1/resolve-addable';
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = 'http://127.0.0.1:1/declare-skill';
    const ask = fakeAsk(['', '1', '', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.equal(ask.asked.length, 6);
    assert.equal(out.includes('Todas las skills de este proyecto ya están en tu perfil.'), false, 'a resolve FAILURE is not the same claim as "all already declared"');
    assert.equal(out.includes('También detectamos otras skills'), false);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('opt-in: no resolve-addable/declare endpoint configured -> silent (same "optional step, no endpoint" discipline as step 5)', async () => {
  writeReactProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    // Neither AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT nor
    // AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT is set (beforeEach deletes both).
    const ask = fakeAsk(['', '1', '', '', '', '']);
    const { out } = await captureStdout(() => runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true }));
    assert.equal(ask.asked.length, 6);
    assert.equal(out.includes('También detectamos otras skills'), false);
  } finally {
    listServer.close();
    declareServer.close();
  }
});

test('opt-in: explicitly unmarking a candidate (numbered fallback: keep only #2) declares ONLY the kept one', async () => {
  writeReactProject(tmpProjectDir);
  const listServer = await startListServer();
  const declareServer = await startDeclareServer();
  const resolveAddableServer = await startResolveAddableServer([
    { skillId: 99, skillName: 'React', technology: 'React' },
    { skillId: 100, skillName: 'Jest', technology: 'Jest' },
  ]);
  const seenSkillDeclares = [];
  const skillsDeclareServer = await startSkillsDeclareServer((body) => seenSkillDeclares.push(body));
  try {
    process.env.AI_FOOTPRINT_PORTFOLIOS_LIST_ENDPOINT = urlOf(listServer, '/portfolios');
    process.env.AI_FOOTPRINT_PORTFOLIOS_DECLARE_ENDPOINT = urlOf(declareServer, '/declare');
    process.env.AI_FOOTPRINT_SKILLS_RESOLVE_ADDABLE_ENDPOINT = urlOf(resolveAddableServer, '/resolve-addable');
    process.env.AI_FOOTPRINT_SKILLS_DECLARE_ENDPOINT = urlOf(skillsDeclareServer, '/declare-skill');
    // title, type=1, description, url, client, THEN "2" at the opt-in picker
    // -- keep ONLY the second candidate (Jest), unmarking React.
    const ask = fakeAsk(['', '1', '', '', '', '', '2']);
    await runAddPortfolio({ ask, catalog, root: tmpProjectDir, session, stdinIsTTY: true });
    assert.equal(seenSkillDeclares.length, 1, 'only the KEPT candidate is declared, never the unmarked one');
    assert.equal(seenSkillDeclares[0].skillId, 100);
  } finally {
    listServer.close();
    declareServer.close();
    resolveAddableServer.close();
    skillsDeclareServer.close();
  }
});

