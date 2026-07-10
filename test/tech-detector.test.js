'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectTechnologies } = require('../src/tech-detector');

/*
 * talents-ai-score, ADR-012: deterministic (no-LLM) extraction of the
 * project's technologies from dependency MANIFESTS only (package names) —
 * never business/application code. Always shown locally; only associated
 * with Shakers' Skill catalog server-side, at persistence time.
 */

let tmpDir;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-tech-test-'));
});

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('detectTechnologies: no manifests -> empty array, never throws', () => {
  assert.deepEqual(detectTechnologies(tmpDir), []);
});

test('detectTechnologies: package.json dependencies/devDependencies/peerDependencies', () => {
  write(tmpDir, 'package.json', JSON.stringify({
    dependencies: { react: '^18.0.0', express: '^4.0.0' },
    devDependencies: { typescript: '^5.0.0' },
    peerDependencies: { 'react-dom': '^18.0.0' },
  }));
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs.sort(), ['express', 'react', 'react-dom', 'typescript'].sort());
});

test('detectTechnologies: malformed package.json is skipped, never throws', () => {
  write(tmpDir, 'package.json', '{ not valid json');
  assert.deepEqual(detectTechnologies(tmpDir), []);
});

test('detectTechnologies: requirements.txt strips version specifiers and comments', () => {
  write(tmpDir, 'requirements.txt', [
    '# a comment line',
    'django==4.2.0',
    'requests>=2.0,<3.0',
    'numpy',
    '',
    '  # indented comment',
  ].join('\n'));
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs.sort(), ['django', 'numpy', 'requests'].sort());
});

test('detectTechnologies: go.mod require block and single-line requires', () => {
  write(tmpDir, 'go.mod', [
    'module example.com/myapp',
    '',
    'go 1.21',
    '',
    'require (',
    '\tgithub.com/gin-gonic/gin v1.9.1',
    '\tgithub.com/lib/pq v1.10.9',
    ')',
    '',
    'require github.com/stretchr/testify v1.8.4',
  ].join('\n'));
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs.sort(), [
    'github.com/gin-gonic/gin',
    'github.com/lib/pq',
    'github.com/stretchr/testify',
  ].sort());
});

test('detectTechnologies: pyproject.toml (poetry-style dependencies table)', () => {
  write(tmpDir, 'pyproject.toml', [
    '[tool.poetry.dependencies]',
    'python = "^3.11"',
    'fastapi = "^0.100.0"',
    'uvicorn = "^0.23.0"',
    '',
    '[tool.poetry.dev-dependencies]',
    'pytest = "^7.0.0"',
  ].join('\n'));
  const techs = detectTechnologies(tmpDir);
  // `python` itself is the interpreter, not a "technology" dependency.
  assert.ok(techs.includes('fastapi'));
  assert.ok(techs.includes('uvicorn'));
  assert.ok(!techs.includes('python'));
});

test('detectTechnologies: pyproject.toml (PEP 621 dependencies array)', () => {
  write(tmpDir, 'pyproject.toml', [
    '[project]',
    'name = "myapp"',
    'dependencies = [',
    '  "flask>=2.0",',
    '  "sqlalchemy==2.0.0",',
    ']',
  ].join('\n'));
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs.sort(), ['flask', 'sqlalchemy'].sort());
});

test('detectTechnologies: merges and dedupes across multiple manifests, sorted', () => {
  write(tmpDir, 'package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
  write(tmpDir, 'requirements.txt', 'react\ndjango==4.2.0\n');
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs, [...new Set(techs)]); // no duplicates
  assert.deepEqual(techs, [...techs].sort()); // sorted
  assert.ok(techs.includes('react'));
  assert.ok(techs.includes('django'));
});

test('detectTechnologies: never reads application/business source code, only the manifest files listed', () => {
  write(tmpDir, 'src/index.js', 'const SECRET_CLIENT_NAME = "do-not-leak";\nmodule.exports = {};\n');
  write(tmpDir, 'package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
  const techs = detectTechnologies(tmpDir);
  assert.equal(JSON.stringify(techs).includes('SECRET_CLIENT_NAME'), false);
  assert.deepEqual(techs, ['react']);
});
