'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

/*
 * talents-ai-score, ADR-012: scanner.js wiring for the deterministic
 * technologies detector. Scoped to the NEW `report.technologies` field only.
 * Refined: `report.technologies` holds recognized FRAMEWORK/LIBRARY
 * canonical names only (React, Express...), not a raw dependency dump —
 * see src/tech-detector.js.
 */

let tmpDir;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-tech-test-'));
});

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scan: no manifests -> technologies is an empty array', () => {
  const report = scan({ root: tmpDir });
  assert.deepEqual(report.technologies, []);
});

test('scan: populates report.technologies with recognized canonical framework names, excludes non-frameworks', () => {
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ dependencies: { react: '^18.0.0' }, devDependencies: { typescript: '^5.0.0' } }),
  );
  const report = scan({ root: tmpDir });
  assert.deepEqual(report.technologies, ['React']);
  assert.equal(report.technologies.includes('typescript'), false);
});
