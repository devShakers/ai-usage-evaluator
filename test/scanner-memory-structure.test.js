'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

/*
 * talents-ai-score, issue 016: scanner.js wiring for the memory structure
 * detector. Scoped to the NEW `report.memory` field only.
 */

let tmpProject;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-memory-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-memory-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('scan: no context files -> report.memory is empty but well-shaped', () => {
  const report = scan({ root: tmpProject });
  assert.deepEqual(report.memory, { files: [], totalImports: 0, maxDepth: 0, layered: false });
});

test('scan: populates report.memory from CLAUDE.md', () => {
  fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# Instructions\n\n## Rules\n\nSome text.');
  const report = scan({ root: tmpProject });
  const claude = report.memory.files.find((f) => f.id === 'CLAUDE.md');
  assert.ok(claude);
  assert.equal(claude.sections, 2);
});
