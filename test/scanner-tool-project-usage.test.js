'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

/*
 * skill-code-certification / ADR-011: scanner.js attaches `report.toolProjectUsage`
 * (per-detected-tool "projects where it was used"). This only asserts the
 * WIRING + shape (deterministic across machines); the extraction logic itself
 * is covered against fixture homes in test/tool-project-usage.test.js.
 */

let tmpDir;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-tpu-test-'));
});

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scan: report.toolProjectUsage is always an array, one entry per detected tool', () => {
  const report = scan({ root: tmpDir });
  assert.ok(Array.isArray(report.toolProjectUsage));
  const detectedIds = report.tools.filter((t) => t.detected).map((t) => t.id).sort();
  const usageIds = report.toolProjectUsage.map((u) => u.toolId).sort();
  assert.deepEqual(usageIds, detectedIds);
  for (const u of report.toolProjectUsage) {
    assert.equal(typeof u.toolName, 'string');
    assert.equal(typeof u.available, 'boolean');
    assert.ok(Array.isArray(u.projects));
  }
});
