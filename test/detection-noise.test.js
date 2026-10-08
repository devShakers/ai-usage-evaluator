'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  isVendoredPath,
  classifyVendored,
  detectFork,
  detectBoilerplate,
  collectProvenance,
} = require('../src/detection-noise');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'detection-noise-'));
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function git(root, args) {
  execFileSync('git', ['-C', root, ...args], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  });
}

// ---------------------------------------------------------------------------

test('isVendoredPath flags dependency/generated segments, keeps real paths', () => {
  assert.equal(isVendoredPath('node_modules/react/package.json'), true);
  assert.equal(isVendoredPath('vendor/foo/go.mod'), true);
  assert.equal(isVendoredPath('third_party/lib/package.json'), true);
  assert.equal(isVendoredPath('dist/bundle/package.json'), true);
  assert.equal(isVendoredPath('ios/Pods/package.json'), true); // case-insensitive
  assert.equal(isVendoredPath('apps/web/package.json'), false);
  assert.equal(isVendoredPath('package.json'), false);
  assert.equal(isVendoredPath(''), false);
});

test('classifyVendored: dominated only when ALL paths are vendored', () => {
  assert.equal(classifyVendored(['node_modules/a/package.json']), true);
  assert.equal(
    classifyVendored(['node_modules/a/package.json', 'vendor/b/go.mod']),
    true,
  );
  // one real manifest keeps it (conservative)
  assert.equal(
    classifyVendored(['node_modules/a/package.json', 'package.json']),
    false,
  );
  assert.equal(classifyVendored([]), false);
  assert.equal(classifyVendored(['apps/web/package.json']), false);
});

test('detectFork: an upstream remote is the (weak) fork signal', () => {
  const root = tmp();
  git(root, ['init', '-q']);
  git(root, ['remote', 'add', 'origin', 'https://example.com/me/repo.git']);
  assert.deepEqual(detectFork(root), { fork: false, forkSignal: null });
  git(root, ['remote', 'add', 'upstream', 'https://example.com/orig/repo.git']);
  assert.deepEqual(detectFork(root), { fork: true, forkSignal: 'upstream-remote' });
});

test('detectFork: non-git directory yields no signal (never throws)', () => {
  const root = tmp();
  assert.deepEqual(detectFork(root), { fork: false, forkSignal: null });
});

test('detectBoilerplate: unmodified scaffolder README matches a marker', () => {
  const cra = tmp();
  write(cra, 'README.md', '# Getting Started\n\nThis project was bootstrapped with [Create React App](https://x).');
  assert.deepEqual(detectBoilerplate(cra), {
    boilerplate: true,
    boilerplateMarker: 'create-react-app',
  });

  const next = tmp();
  write(next, 'README.md', 'This is a Next.js project bootstrapped with `create-next-app`.');
  assert.deepEqual(detectBoilerplate(next), {
    boilerplate: true,
    boilerplateMarker: 'create-next-app',
  });

  const vite = tmp();
  write(vite, 'README.md', '# React + Vite\n\nThis template provides a minimal setup to get React working in Vite with HMR.');
  assert.equal(detectBoilerplate(vite).boilerplate, true);
  assert.equal(detectBoilerplate(vite).boilerplateMarker, 'vite-starter');
});

test('detectBoilerplate: a real project README is not boilerplate', () => {
  const root = tmp();
  write(root, 'README.md', '# Acme Billing Service\n\nInternal service for invoicing. Run `make dev`.');
  assert.deepEqual(detectBoilerplate(root), {
    boilerplate: false,
    boilerplateMarker: null,
  });

  const none = tmp();
  assert.deepEqual(detectBoilerplate(none), {
    boilerplate: false,
    boilerplateMarker: null,
  });
});

test('collectProvenance merges fork + boilerplate into one object', () => {
  const root = tmp();
  git(root, ['init', '-q']);
  git(root, ['remote', 'add', 'upstream', 'https://example.com/orig/repo.git']);
  write(root, 'README.md', 'This project was bootstrapped with Create React App.');
  assert.deepEqual(collectProvenance(root), {
    fork: true,
    forkSignal: 'upstream-remote',
    boilerplate: true,
    boilerplateMarker: 'create-react-app',
  });
});
