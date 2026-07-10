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

test('scan: populates report.technologies from package.json', () => {
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ dependencies: { react: '^18.0.0' }, devDependencies: { typescript: '^5.0.0' } }),
  );
  const report = scan({ root: tmpDir });
  assert.deepEqual(report.technologies.sort(), ['react', 'typescript'].sort());
});
