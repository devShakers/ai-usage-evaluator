'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');
const { detectMcpServers, MCP_CONFIG_LOCATIONS } = require('../src/mcp-detector');
const { aggregateTierSignals, computeTierResult } = require('../src/tier-engine');

// Issue 112: a talent whose MCP servers live in a GLOBAL config had zero of them, for the report AND for the tier.

let tmpProject;
let tmpHome;
let originalHome;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-112-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-112-home-'));
  originalHome = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHome === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHome;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

// The talent's setup as found in the wild: Cursor, configured globally, nothing
// in the repo.
function cursorGlobalOnly() {
  writeJson(path.join(tmpHome, '.cursor', 'mcp.json'), {
    mcpServers: { MongoDB: {}, Figma: {}, Playwright: {}, motion: {} },
  });
}

/* ---------- THE CONTROL: what the old path list would have returned ---------- */

test('control: reading only the PROJECT-scoped locations gives zero for a globally-configured talent', () => {
  cursorGlobalOnly();
  // Replays the pre-112 behaviour honestly: the location table filtered to the project-scoped rows, which is what Cursor had.
  const projectOnly = MCP_CONFIG_LOCATIONS.filter((l) => l.scope === 'project');
  const namesFound = [];
  for (const loc of projectOnly) {
    const file = loc.file(tmpProject, tmpHome);
    if (!fs.existsSync(file)) continue;
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of loc.keys) if (obj[key]) namesFound.push(...Object.keys(obj[key]));
  }
  assert.deepEqual(namesFound, [], 'the config is not in the project, so project-only detection finds nothing');
});

/* ---------- the fix ---------- */

test('a global Cursor config is detected, with every server marked home-scoped', () => {
  cursorGlobalOnly();
  const result = detectMcpServers(tmpProject);
  assert.equal(result.total, 4);
  assert.deepEqual(result.servers.map((s) => s.name).sort(), ['Figma', 'MongoDB', 'Playwright', 'motion']);
  for (const s of result.servers) assert.equal(s.scope, 'home', `${s.name} came from the home config`);
  // And it is attributed to the tool whose config it is, for the depth probe.
  assert.equal(result.byTool.cursor, 4);
});

test('project scope wins when the same server is declared in both places', () => {
  writeJson(path.join(tmpHome, '.cursor', 'mcp.json'), { mcpServers: { postgres: {} } });
  writeJson(path.join(tmpProject, '.cursor', 'mcp.json'), { mcpServers: { postgres: {} } });
  const result = detectMcpServers(tmpProject);
  assert.equal(result.total, 1, 'one capability, not two');
  assert.equal(result.servers[0].scope, 'project', 'the most specific scope is the honest label');
  assert.equal(result.byTool.cursor, 1, 'and the per-tool count dedupes too');
});

test('VS Code uses `servers`, not `mcpServers`, and it is read', () => {
  writeJson(path.join(tmpProject, '.vscode', 'mcp.json'), { servers: { github: {}, notion: {} } });
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers.map((s) => s.name).sort(), ['github', 'notion']);
  // No probe owns VS Code, so it contributes to the union and to nothing else.
  assert.equal(result.byTool.cursor, undefined);
});

test('a `servers` key is only honoured where that format is declared', () => {
  // The same key in a Claude Code config must NOT be read: declaring keys per
  // location is what keeps a lucky key name from inventing servers.
  writeJson(path.join(tmpProject, '.mcp.json'), { servers: { notReal: {} } });
  assert.equal(detectMcpServers(tmpProject).total, 0);
});

/* ---------- the tier counts the set the report shows ---------- */

test('THE TIER: a globally-configured talent now meets the MCP criterion', () => {
  cursorGlobalOnly();
  // Context file so the ladder can actually get past T2 (the T3 criterion is
  // only reachable from T2 — the ladder is strictly bottom-up).
  fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# ctx\n');
  const report = scan({ root: tmpProject });
  const signals = aggregateTierSignals(report);
  assert.equal(signals.mcp, report.mcp.total, 'the tier signal IS the shown set, not a parallel count');
  assert.equal(signals.mcp, 4);
  assert.ok(computeTierResult(report).tier >= 3, 'the criterion the talent had earned is now met');
});

test('the tier signal, `agentCounts` and the shown list are ONE set (issue 096, applied to a signal)', () => {
  writeJson(path.join(tmpHome, '.cursor', 'mcp.json'), { mcpServers: { figma: {} } });
  writeJson(path.join(tmpHome, '.claude.json'), { mcpServers: { figma: {}, postgres: {} } });
  const report = scan({ root: tmpProject });
  // `figma` is configured in two clients: the union says 2, a per-tool sum would
  // say 3. The report, the tier and agentCounts must all say the same thing.
  assert.equal(report.mcp.total, 2);
  assert.equal(aggregateTierSignals(report).mcp, 2);
  assert.equal(report.agentCounts.mcpServers, 2);
  assert.deepEqual(report.mcp.servers.map((s) => s.name).sort(), ['figma', 'postgres']);
});

test('an older persisted report with no `mcp` key still gets a tier signal (the fallback)', () => {
  // The store keeps whole reports, so a report persisted before 112 has tool
  // depth and no `mcp`. Falling back to the per-tool sum keeps it gradeable.
  const legacy = {
    tools: [{ id: 'cursor', detected: true, depth: { mcpServers: 2, instructions: 1 } }],
    agentCounts: {},
  };
  assert.equal(aggregateTierSignals(legacy).mcp, 2);
});

test('scanner.js holds no MCP config path of its own any more', () => {
  // The structural half of the fix: three copies of these paths is how they drifted.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'scanner.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
  for (const needle of ['.mcp.json', 'mcp.json', 'mcp_config.json', '.claude.json']) {
    assert.equal(src.includes(needle), false, `scanner.js still names an MCP config path: ${needle}`);
  }
});
