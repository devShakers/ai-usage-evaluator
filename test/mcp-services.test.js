'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { serviceForMcpServerName, detectMcpServers, SERVICE_CATALOG } = require('../src/mcp-detector');
const { buildFootprintDrawer } = require('../src/graph-scan');
const { renderTerminal } = require('../src/render-terminal');
const { renderSheet } = require('../src/render-sheet');
const { getCatalog } = require('../src/i18n');

// Issue 110: the SERVICES behind the MCP servers, on the three surfaces a talent reads.

let tmpProject;
let tmpHome;
let originalHome;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-110-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-110-home-'));
  originalHome = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHome === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHome;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// A name the TALENT chose, which must never reach any surface, next to names that
// do identify a product.
const TALENT_NAMED = 'acme-prod-db';
function writeServers(names) {
  fs.writeFileSync(
    path.join(tmpProject, '.mcp.json'),
    JSON.stringify({ mcpServers: Object.fromEntries(names.map((n) => [n, {}])) }),
  );
}

/* ---------- the derivation ---------- */

test('the service comes from the name, and an unrecognizable name yields null (not a guess)', () => {
  assert.equal(serviceForMcpServerName('postgres'), 'Postgres');
  assert.equal(serviceForMcpServerName('pg-postgres-prod'), 'Postgres', 'a decorated name still resolves');
  assert.equal(serviceForMcpServerName('notionApi'), 'Notion');
  assert.equal(serviceForMcpServerName('MongoDB'), 'MongoDB');
  assert.equal(serviceForMcpServerName('attio'), 'Attio', 'measured as unidentified before 110, now a row');
  assert.equal(serviceForMcpServerName('railway'), 'Railway');
  assert.equal(serviceForMcpServerName('context7'), 'Context7');
  // Deliberately NOT identified: `motion` is ambiguous between products and
  // `codegraph` is not a recognizable one. Labelling either would be invention.
  assert.equal(serviceForMcpServerName('motion'), null);
  assert.equal(serviceForMcpServerName('codegraph'), null);
  assert.equal(serviceForMcpServerName(TALENT_NAMED), null);
});

test('the more specific keyword wins, so the label is the product and not the generic row', () => {
  // `github` before `git`, `chromium` before `chrome`, `browser-use` before
  // `browser`, `postgresql` before `postgres`.
  assert.equal(serviceForMcpServerName('github'), 'GitHub');
  assert.equal(serviceForMcpServerName('chromium-headless'), 'Chromium');
  assert.equal(serviceForMcpServerName('browser-use'), 'Browser Use');
  assert.equal(serviceForMcpServerName('my-postgresql'), 'Postgres');
});

test('a generic row keeps its CATEGORY while refusing to name a service', () => {
  // `database`, `browser`, `git`, `email` say what KIND of server it is without
  // naming a product — dropping them would break issue 018's browser detector.
  const generic = SERVICE_CATALOG.filter((e) => e.label === null).map((e) => e.kw);
  assert.ok(generic.length >= 4, 'the generic rows are a deliberate part of the table');
  assert.equal(serviceForMcpServerName('my-database'), null);
  assert.equal(detectMcpServers(tmpProject) !== null, true);
  writeServers(['my-database', 'headless-browser']);
  const result = detectMcpServers(tmpProject);
  assert.equal(result.unidentified, 2, 'both are counted as unidentified services');
  assert.equal(result.countsByCategory.data, 1, 'and the data category is still recognized');
  assert.equal(result.countsByCategory.browser, 1);
});

test('two servers of the same product are ONE service with a count', () => {
  writeServers(['postgres-prod', 'postgres-local']);
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.services, [{ label: 'Postgres', count: 2 }]);
  assert.equal(result.total, 2, 'and the server count is still two');
});

test('an ABBREVIATED name stays unidentified, and that is the right tradeoff', () => {
  writeServers(['pg-prod']);
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.services, []);
  assert.equal(result.unidentified, 1);
  assert.equal(serviceForMcpServerName('upgrade-helper'), null, 'and a 2-char keyword would have matched this');
});

/* ---------- the three surfaces ---------- */

function scanned() {
  const report = scan({ root: tmpProject });
  return { report, maturity: classify(report) };
}

function project(report, maturity) {
  return {
    root: tmpProject,
    updatedAt: new Date().toISOString(),
    footprint: { generatedAt: report.generatedAt, report, maturity },
    certifications: {},
    agentCertifications: {},
    backendAcceptance: {},
  };
}

function graphHtmlFor(report, maturity) {
  return JSON.stringify(buildFootprintDrawer(report, maturity, getCatalog('es')));
}

for (const lang of ['es', 'en']) {
  test(`all three surfaces [${lang}] show the SERVICE and never the server name`, () => {
    writeServers(['postgres', 'notionApi', TALENT_NAMED]);
    const { report, maturity } = scanned();
    const t = getCatalog(lang);

    const terminal = renderTerminal(report, maturity, lang, { showRoadmap: false });
    const sheet = renderSheet(project(report, maturity), lang);
    const drawer = graphHtmlFor(report, maturity);

    for (const [name, out] of Object.entries({ terminal, sheet, drawer })) {
      assert.ok(out.includes('Postgres'), `${name}: the Postgres service is missing`);
      assert.ok(out.includes('Notion'), `${name}: the Notion service is missing`);
      // THE PRIVACY ASSERTION: the talent's own server name never travels to a
      // surface, and the shareable report is one of them.
      assert.equal(out.includes(TALENT_NAMED), false, `${name} leaked the talent's server name`);
    }

    // And each surface says how many it could not identify.
    assert.ok(terminal.includes(t.html.mcpUnidentified(1)), 'terminal: the unidentified count is missing');
    assert.ok(sheet.includes(t.sheet.mcpUnidentified(1)), 'sheet: the unidentified count is missing');
    assert.ok(drawer.includes('"unidentified":1'), 'drawer payload: the unidentified count is missing');
  });

  test(`the empty state [${lang}] says the tool looked, and names the criterion`, () => {
    // No MCP config at all.
    const { report, maturity } = scanned();
    const t = getCatalog(lang);
    assert.equal(report.mcp.total, 0);

    const terminal = renderTerminal(report, maturity, lang, { showRoadmap: false });
    const sheet = renderSheet(project(report, maturity), lang);
    // Wrapped in the terminal, so compare on flattened text.
    const flat = terminal.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
    assert.ok(flat.includes(t.html.mcpEmpty.replace(/\s+/g, ' ')), 'terminal: no empty state');
    assert.ok(sheet.includes(t.sheet.mcpEmpty), 'sheet: no empty state');
    // The section is printed even when empty — that is the whole point.
    assert.ok(terminal.includes(t.html.mcpHeading));
    assert.ok(sheet.includes(t.sheet.mcpT));
  });
}

/* ---------- the shown set is the counted set ---------- */

test('services + unidentified always account for every server the tier counted', () => {
  writeServers(['postgres', 'pg-replica', 'slack', TALENT_NAMED, 'codegraph']);
  const result = detectMcpServers(tmpProject);
  const named = result.services.reduce((n, s) => n + s.count, 0);
  assert.equal(named + result.unidentified, result.total, 'the list must add up to the count behind the tier');
});

test('the service is derived from the NAME only — no config value is ever read', () => {
  // A server whose name says nothing but whose command names a product: the service must stay unidentified.
  fs.writeFileSync(
    path.join(tmpProject, '.mcp.json'),
    JSON.stringify({ mcpServers: { 'internal-thing': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { PGPASSWORD: 'secret' } } } }),
  );
  const result = detectMcpServers(tmpProject);
  assert.equal(result.servers[0].service, null, 'the command named Postgres and we did not look');
  assert.equal(result.unidentified, 1);
  assert.equal(JSON.stringify(result).includes('server-postgres'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
