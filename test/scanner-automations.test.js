'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

/*
 * talents-ai-score, issue 017: scanner.js wiring for the automations
 * detector. Scoped to the NEW `report.automations` field only.
 */

let tmpProject;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-automations-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-automations-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('scan: no automations anywhere -> report.automations is well-shaped, zeroed', () => {
  const report = scan({ root: tmpProject });
  assert.equal(report.automations.scripts.npm, 0);
  assert.equal(report.automations.scripts.shell, 0);
  assert.equal(report.automations.jsonPiping, 0);
  assert.equal(typeof report.automations.schedulers.cron.inspected, 'boolean');
});

test('scan: populates report.automations from an AI-invoking npm script', () => {
  fs.writeFileSync(
    path.join(tmpProject, 'package.json'),
    JSON.stringify({ scripts: { 'ai-review': 'claude -p "review"' } }),
  );
  const report = scan({ root: tmpProject });
  assert.equal(report.automations.scripts.npm, 1);
});
