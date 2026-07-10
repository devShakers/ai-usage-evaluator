'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

/*
 * talents-ai-score, issue 018: scanner.js wiring for the browser tools
 * detector. Scoped to the NEW `report.browserTools` field only.
 */

let tmpProject;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-browser-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-browser-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('scan: no browser tooling anywhere -> report.browserTools.detected is false', () => {
  const report = scan({ root: tmpProject });
  assert.equal(report.browserTools.detected, false);
});

test('scan: playwright dependency -> report.browserTools.detected is true via dependencies', () => {
  fs.writeFileSync(path.join(tmpProject, 'package.json'), JSON.stringify({ dependencies: { playwright: '^1.0.0' } }));
  const report = scan({ root: tmpProject });
  assert.equal(report.browserTools.detected, true);
  assert.deepEqual(report.browserTools.via.dependencies, ['playwright']);
});

test('scan: browser-category MCP server -> report.browserTools.detected is true via mcp', () => {
  fs.writeFileSync(path.join(tmpProject, '.mcp.json'), JSON.stringify({ mcpServers: { playwright: {} } }));
  const report = scan({ root: tmpProject });
  assert.equal(report.browserTools.detected, true);
  assert.deepEqual(report.browserTools.via.mcp, ['playwright']);
});
