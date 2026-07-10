'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectTechnologies, canonicalFrameworkName } = require('../src/tech-detector');

/*
 * talents-ai-score: deterministic (no-LLM) extraction of the project's
 * TECHNOLOGIES — refined per user clarification: "tecnologías del
 * proyecto" means the FRAMEWORK/LIBRARY the talent uses (React, Next.js,
 * Express, Django...), not a raw dump of every dependency in the manifest.
 *
 * Manifests are still parsed exactly as before (package.json,
 * requirements.txt, go.mod, pyproject.toml) — never business/application
 * code — but the OUTPUT is now filtered through a curated, deterministic
 * dependency -> canonical framework/library name map. Unrecognized
 * dependencies (linters, test runners, small utility libs, ecosystems this
 * detector doesn't parse a manifest for yet — Ruby/Gemfile for Rails,
 * Java/pom.xml for Spring, PHP/composer.json for Laravel) are NOT shown —
 * never invented, never guessed.
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

// --- canonicalFrameworkName (pure mapping) -----------------------------------

test('canonicalFrameworkName: recognizes known JS/TS frameworks exactly', () => {
  assert.equal(canonicalFrameworkName('react'), 'React');
  assert.equal(canonicalFrameworkName('react-dom'), 'React');
  assert.equal(canonicalFrameworkName('next'), 'Next.js');
  assert.equal(canonicalFrameworkName('vue'), 'Vue');
  assert.equal(canonicalFrameworkName('@angular/core'), 'Angular');
  assert.equal(canonicalFrameworkName('express'), 'Express');
  assert.equal(canonicalFrameworkName('@nestjs/core'), 'NestJS');
  assert.equal(canonicalFrameworkName('svelte'), 'Svelte');
});

test('canonicalFrameworkName: recognizes known Python frameworks exactly', () => {
  assert.equal(canonicalFrameworkName('django'), 'Django');
  assert.equal(canonicalFrameworkName('flask'), 'Flask');
  assert.equal(canonicalFrameworkName('fastapi'), 'FastAPI');
});

test('canonicalFrameworkName: recognizes known Go frameworks by module-path prefix (version suffixes included)', () => {
  assert.equal(canonicalFrameworkName('github.com/gin-gonic/gin'), 'Gin');
  assert.equal(canonicalFrameworkName('github.com/labstack/echo/v4'), 'Echo');
});

test('canonicalFrameworkName: unrecognized dependency -> null, never guessed', () => {
  assert.equal(canonicalFrameworkName('typescript'), null);
  assert.equal(canonicalFrameworkName('lodash'), null);
  assert.equal(canonicalFrameworkName('some-random-internal-lib'), null);
});

test('canonicalFrameworkName: NOT recognized for ecosystems without a manifest parser yet (Rails/Spring/Laravel) — never invented', () => {
  assert.equal(canonicalFrameworkName('rails'), null);
  assert.equal(canonicalFrameworkName('spring-boot-starter-web'), null);
  assert.equal(canonicalFrameworkName('laravel/framework'), null);
});

// --- detectTechnologies: end to end, manifest -> canonical names only -------

test('detectTechnologies: no manifests -> empty array, never throws', () => {
  assert.deepEqual(detectTechnologies(tmpDir), []);
});

test('detectTechnologies: package.json -> only recognized frameworks, deduped (react + react-dom -> one "React")', () => {
  write(tmpDir, 'package.json', JSON.stringify({
    dependencies: { react: '^18.0.0', express: '^4.0.0' },
    devDependencies: { typescript: '^5.0.0' }, // NOT a framework -> excluded
    peerDependencies: { 'react-dom': '^18.0.0' }, // same canonical as react
  }));
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs.sort(), ['Express', 'React'].sort());
  assert.equal(techs.includes('typescript'), false);
});

test('detectTechnologies: malformed package.json is skipped, never throws', () => {
  write(tmpDir, 'package.json', '{ not valid json');
  assert.deepEqual(detectTechnologies(tmpDir), []);
});

test('detectTechnologies: requirements.txt -> only recognized frameworks (django), not every raw dependency', () => {
  write(tmpDir, 'requirements.txt', [
    '# a comment line',
    'django==4.2.0',
    'requests>=2.0,<3.0', // not a framework -> excluded
    'numpy', // not a framework -> excluded
  ].join('\n'));
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs, ['Django']);
});

test('detectTechnologies: go.mod -> recognized Go framework only (gin), not every module', () => {
  write(tmpDir, 'go.mod', [
    'module example.com/myapp',
    '',
    'go 1.21',
    '',
    'require (',
    '\tgithub.com/gin-gonic/gin v1.9.1',
    '\tgithub.com/lib/pq v1.10.9', // not a recognized framework -> excluded
    ')',
  ].join('\n'));
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs, ['Gin']);
});

test('detectTechnologies: pyproject.toml (poetry-style) -> recognized framework only (fastapi), not uvicorn/pytest', () => {
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
  assert.deepEqual(techs, ['FastAPI']);
});

test('detectTechnologies: pyproject.toml (PEP 621 array) -> recognized framework only (flask), not sqlalchemy', () => {
  write(tmpDir, 'pyproject.toml', [
    '[project]',
    'name = "myapp"',
    'dependencies = [',
    '  "flask>=2.0",',
    '  "sqlalchemy==2.0.0",',
    ']',
  ].join('\n'));
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs, ['Flask']);
});

test('detectTechnologies: merges and dedupes across multiple manifests, sorted', () => {
  write(tmpDir, 'package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
  write(tmpDir, 'requirements.txt', 'react\ndjango==4.2.0\n'); // "react" here is not a real pip package but exercises dedupe/cross-manifest merge safely
  const techs = detectTechnologies(tmpDir);
  assert.deepEqual(techs, [...new Set(techs)]); // no duplicates
  assert.deepEqual(techs, [...techs].sort()); // sorted
  assert.ok(techs.includes('React'));
  assert.ok(techs.includes('Django'));
});

test('detectTechnologies: never reads application/business source code, only the manifest files listed', () => {
  write(tmpDir, 'src/index.js', 'const SECRET_CLIENT_NAME = "do-not-leak";\nmodule.exports = {};\n');
  write(tmpDir, 'package.json', JSON.stringify({ dependencies: { react: '^18.0.0' } }));
  const techs = detectTechnologies(tmpDir);
  assert.equal(JSON.stringify(techs).includes('SECRET_CLIENT_NAME'), false);
  assert.deepEqual(techs, ['React']);
});

test('detectTechnologies: a project with only unrecognized dependencies -> empty array (never a raw dump)', () => {
  write(tmpDir, 'package.json', JSON.stringify({ dependencies: { lodash: '^4.0.0', chalk: '^5.0.0' } }));
  assert.deepEqual(detectTechnologies(tmpDir), []);
});
