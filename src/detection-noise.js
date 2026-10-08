'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Anti-noise CLASSIFICATION for detected candidates (hybrid evaluation, Slice 3 — issue 019).

const GIT_TIMEOUT_MS = 15000;
const README_MAX_BYTES = 8 * 1024;

// Directory segments that mark a path as vendored / generated (dependency trees, build output, virtualenvs, package caches).
const VENDORED_SEGMENTS = new Set([
  // JS / general
  'node_modules', 'bower_components', '.pnp', 'jspm_packages',
  // generic vendoring
  'vendor', 'vendored', 'third_party', 'third-party', 'external', 'deps',
  // build / generated output
  'dist', 'build', 'out', 'generated', '__generated__',
  '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.cache',
  // Python
  '.venv', 'venv', 'virtualenv', 'site-packages', '__pycache__',
  // iOS / macOS / other package managers
  'pods', 'carthage',
  // JVM / Rust build output
  'target', '.gradle',
  // IaC provider plugins
  '.terraform',
]);

// True when ANY segment of the (root-relative, POSIX) path is a vendored
// segment. Case-insensitive so `Pods`/`pods` both match.
function isVendoredPath(relPath) {
  if (typeof relPath !== 'string' || !relPath) return false;
  return relPath
    .split('/')
    .some((seg) => VENDORED_SEGMENTS.has(seg.toLowerCase()));
}

// A candidate's evidence is VENDORED-dominated when it has at least one evidence path AND every one of them is vendored.
function classifyVendored(evidencePaths) {
  if (!Array.isArray(evidencePaths) || evidencePaths.length === 0) return false;
  return evidencePaths.every(isVendoredPath);
}

function runGit(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

// LOW-CONFIDENCE fork signal: a git remote named `upstream` alongside `origin` is the canonical local convention for a fork's parent.
function detectFork(root) {
  const out = runGit(root, ['remote']);
  if (out === null) return { fork: false, forkSignal: null };
  const remotes = new Set(
    out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );
  if (remotes.has('upstream')) {
    return { fork: true, forkSignal: 'upstream-remote' };
  }
  return { fork: false, forkSignal: null };
}

// Scaffolder README signatures.
const BOILERPLATE_MARKERS = [
  { id: 'create-react-app', re: /bootstrapped with \[?create react app/i },
  { id: 'create-next-app', re: /bootstrapped with \[?`?create-next-app/i },
  { id: 'vite-starter', re: /this template provides a minimal setup to get .*working in vite/i },
  { id: 'angular-cli', re: /generated with \[?angular ?cli/i },
  { id: 'nuxt-starter', re: /nuxt[\s\d]*minimal starter/i },
  { id: 'create-svelte', re: /(create-svelte|everything you need to build a svelte project)/i },
];

const README_NAMES = ['README.md', 'README', 'readme.md', 'Readme.md'];

function readReadmeHead(root) {
  for (const name of README_NAMES) {
    const abs = path.join(root, name);
    try {
      const fd = fs.openSync(abs, 'r');
      try {
        const buf = Buffer.alloc(README_MAX_BYTES);
        const bytes = fs.readSync(fd, buf, 0, README_MAX_BYTES, 0);
        return buf.toString('utf8', 0, bytes);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // try the next candidate name
    }
  }
  return null;
}

// Repo-level boilerplate flag from an unmodified scaffolder README.
function detectBoilerplate(root) {
  const head = readReadmeHead(root);
  if (!head) return { boilerplate: false, boilerplateMarker: null };
  for (const { id, re } of BOILERPLATE_MARKERS) {
    if (re.test(head)) return { boilerplate: true, boilerplateMarker: id };
  }
  return { boilerplate: false, boilerplateMarker: null };
}

// Repo-level provenance context for the whole scan.
function collectProvenance(root) {
  const scanRoot = root || process.cwd();
  return {
    ...detectFork(scanRoot),
    ...detectBoilerplate(scanRoot),
  };
}

module.exports = {
  VENDORED_SEGMENTS,
  isVendoredPath,
  classifyVendored,
  detectFork,
  detectBoilerplate,
  collectProvenance,
};
