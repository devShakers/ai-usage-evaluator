'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

// talents-ai-score, ADR-012: scanner.js wiring for the deterministic technologies detector.

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

test('getVersion asks each binary once per minute, not once per scanned repo', () => {
  const cp = require('child_process');
  const original = cp.execFileSync;
  let calls = 0;
  cp.execFileSync = (cmd, args, opts) => {
    if (Array.isArray(args) && args[0] === '--version' && cmd === 'fake-tool-for-version-cache') {
      calls += 1;
      return Buffer.from('fake-tool 1.2.3\n');
    }
    return original(cmd, args, opts);
  };
  try {
    delete require.cache[require.resolve('../src/scanner')];
    const { getVersion } = require('../src/scanner');
    assert.equal(getVersion('fake-tool-for-version-cache'), '1.2.3');
    assert.equal(getVersion('fake-tool-for-version-cache'), '1.2.3');
    assert.equal(calls, 1);
  } finally {
    cp.execFileSync = original;
    delete require.cache[require.resolve('../src/scanner')];
  }
});
