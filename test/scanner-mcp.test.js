'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

/*
 * talents-ai-score, issue 015: scanner.js wiring for the MCP-by-name
 * detector. Scoped to the NEW `report.mcp` field only.
 */

let tmpProject;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-mcp-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-mcp-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('scan: no MCP configs -> report.mcp is empty but well-shaped', () => {
  const report = scan({ root: tmpProject });
  assert.deepEqual(report.mcp, {
    servers: [],
    countsByCategory: { data: 0, comms: 0, dev: 0, browser: 0, other: 0 },
    total: 0,
  });
});

test('scan: populates report.mcp with names + categories from project and home configs', () => {
  fs.writeFileSync(path.join(tmpProject, '.mcp.json'), JSON.stringify({ mcpServers: { postgres: {} } }));
  fs.mkdirSync(tmpHome, { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.claude.json'), JSON.stringify({ mcpServers: { slack: {} } }));
  const report = scan({ root: tmpProject });
  assert.deepEqual(report.mcp.servers.map((s) => s.name).sort(), ['postgres', 'slack']);
  assert.equal(report.mcp.countsByCategory.data, 1);
  assert.equal(report.mcp.countsByCategory.comms, 1);
});
