'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyzeMemoryStructure } = require('../src/memory-structure-detector');

/*
 * talents-ai-score, issue 016 (ADR-013/014): deterministic (no-LLM) memory
 * STRUCTURE detector. Reads known context files (CLAUDE.md project+home,
 * AGENTS.md, GEMINI.md — project ∪ home per ADR-014) ONLY to count
 * structural signals: `@file` import references (Claude Code's own
 * documented import syntax), section/header count, byte size, and import
 * NESTING depth (imports of imports — "memoria anidada/por capas").
 * NEVER the file's text content is stored or returned — only counts.
 */

let tmpProject;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-memory-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-memory-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function write(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('analyzeMemoryStructure: no context files at all -> empty result, never throws', () => {
  const result = analyzeMemoryStructure(tmpProject);
  assert.deepEqual(result.files, []);
  assert.equal(result.totalImports, 0);
  assert.equal(result.maxDepth, 0);
  assert.equal(result.layered, false);
});

test('analyzeMemoryStructure: flat CLAUDE.md (no imports) -> depth 1, zero imports, sections/size counted', () => {
  write(tmpProject, 'CLAUDE.md', [
    '# Project instructions',
    '',
    'Some plain instructions, no imports.',
    '',
    '## Conventions',
    '',
    'More text here.',
  ].join('\n'));
  const result = analyzeMemoryStructure(tmpProject);
  assert.equal(result.files.length, 1);
  const claude = result.files.find((f) => f.id === 'CLAUDE.md');
  assert.ok(claude);
  assert.equal(claude.imports, 0);
  assert.equal(claude.depth, 1);
  assert.equal(claude.sections, 2); // "# Project instructions" + "## Conventions"
  assert.ok(claude.sizeBytes > 0);
  assert.equal(result.layered, false);
  assert.equal(result.maxDepth, 1);
});

test('analyzeMemoryStructure: CLAUDE.md WITH imports (flat, no further nesting) -> counts imports, depth still 1 level of import but not nested further', () => {
  write(tmpProject, 'docs/architecture.md', '# Architecture\n\nNo further imports here.');
  write(tmpProject, 'CLAUDE.md', [
    '# Project instructions',
    '',
    '@docs/architecture.md',
    '',
    'See above for architecture.',
  ].join('\n'));
  const result = analyzeMemoryStructure(tmpProject);
  const claude = result.files.find((f) => f.id === 'CLAUDE.md');
  assert.equal(claude.imports, 1);
  // One level of import, but the imported file has no imports of its own ->
  // not "layered" (nested), just a single reference.
  assert.equal(claude.depth, 2);
  assert.equal(result.totalImports, 1);
  assert.equal(result.layered, false, 'a single flat import is not "layered" nesting');
});

test('analyzeMemoryStructure: NESTED imports (import of an import) -> layered:true, maxDepth reflects the chain', () => {
  // `@`-import paths resolve relative to the CONTAINING file's own
  // directory (Claude Code's real convention, like a relative markdown
  // link) — architecture.md already lives in docs/, so its own sibling
  // reference to deep.md is just "@deep.md", not "@docs/deep.md".
  write(tmpProject, 'docs/deep.md', '# Deep\n\nNo further imports.');
  write(tmpProject, 'docs/architecture.md', ['# Architecture', '', '@deep.md'].join('\n'));
  write(tmpProject, 'CLAUDE.md', ['# Project instructions', '', '@docs/architecture.md'].join('\n'));
  const result = analyzeMemoryStructure(tmpProject);
  const claude = result.files.find((f) => f.id === 'CLAUDE.md');
  assert.equal(claude.depth, 3); // CLAUDE.md -> architecture.md -> deep.md
  assert.equal(result.layered, true);
  assert.equal(result.maxDepth, 3);
});

test('analyzeMemoryStructure: home-level CLAUDE.md (~/.claude/CLAUDE.md) is included (project ∪ home, ADR-014)', () => {
  write(tmpHome, '.claude/CLAUDE.md', '# Personal instructions\n\nGlobal preferences.');
  const result = analyzeMemoryStructure(tmpProject);
  const home = result.files.find((f) => f.id === 'CLAUDE.md (home)');
  assert.ok(home);
  assert.equal(home.sections, 1);
});

test('analyzeMemoryStructure: ~-prefixed import resolves against home, not the project directory', () => {
  write(tmpHome, '.claude/shared-conventions.md', '# Shared\n\nNo imports.');
  write(tmpProject, 'CLAUDE.md', ['# Project instructions', '', '@~/.claude/shared-conventions.md'].join('\n'));
  const result = analyzeMemoryStructure(tmpProject);
  const claude = result.files.find((f) => f.id === 'CLAUDE.md');
  assert.equal(claude.imports, 1);
  assert.equal(claude.depth, 2);
});

test('analyzeMemoryStructure: AGENTS.md and GEMINI.md are recognized too', () => {
  write(tmpProject, 'AGENTS.md', '# Agents instructions\n\nSome text.');
  write(tmpProject, 'GEMINI.md', '# Gemini instructions\n\nSome text.');
  const result = analyzeMemoryStructure(tmpProject);
  assert.ok(result.files.find((f) => f.id === 'AGENTS.md'));
  assert.ok(result.files.find((f) => f.id === 'GEMINI.md'));
});

test('analyzeMemoryStructure: import cycle (A imports B, B imports A) never infinite-loops, never throws', () => {
  write(tmpProject, 'CLAUDE.md', ['# A', '', '@docs/b.md'].join('\n'));
  write(tmpProject, 'docs/b.md', ['# B', '', '@../CLAUDE.md'].join('\n'));
  assert.doesNotThrow(() => analyzeMemoryStructure(tmpProject));
});

test('analyzeMemoryStructure: never includes the file TEXT content anywhere in the result, only counts', () => {
  const secretMarker = 'PROJECT-CODENAME-DO-NOT-LEAK';
  write(tmpProject, 'CLAUDE.md', `# Instructions\n\nWorking on ${secretMarker} for the client.`);
  const result = analyzeMemoryStructure(tmpProject);
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
});

test('analyzeMemoryStructure: a dangling/missing import path is skipped, never throws', () => {
  write(tmpProject, 'CLAUDE.md', ['# Instructions', '', '@docs/does-not-exist.md'].join('\n'));
  assert.doesNotThrow(() => analyzeMemoryStructure(tmpProject));
  const result = analyzeMemoryStructure(tmpProject);
  const claude = result.files.find((f) => f.id === 'CLAUDE.md');
  assert.equal(claude.imports, 1); // the reference itself is still counted
});
