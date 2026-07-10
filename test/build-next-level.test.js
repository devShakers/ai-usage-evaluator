'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildNextLevelStarter } = require('../src/build-next-level');

/*
 * talents-ai-score, issue 021 (ADR-013/014): "construir el siguiente nivel
 * ahora" — an OPTIONAL phase that writes the deterministic starter
 * artifact(s) for the NEXT tier, using the exact same snippets as the
 * curated roadmap (src/roadmap-content.js) — never LLM-generated. Never
 * overwrites an existing file without the explicit `force` option; only
 * acts on an explicit call (never runs as part of a normal scan).
 */

let tmpProject;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-build-next-level-'));
});

test.afterEach(() => {
  fs.rmSync(tmpProject, { recursive: true, force: true });
});

test('buildNextLevelStarter: T1 (no context) -> writes CLAUDE.md seed for T2', () => {
  const result = buildNextLevelStarter(tmpProject, 'T1');
  assert.equal(result.ok, true);
  assert.equal(result.targetTierKey, 'T2');
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].filename, 'CLAUDE.md');
  assert.equal(result.files[0].status, 'created');
  const written = fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf8');
  assert.match(written, /Nombre del proyecto/);
});

test('buildNextLevelStarter: T2 (has context, no MCP) -> writes .mcp.json for T3', () => {
  const result = buildNextLevelStarter(tmpProject, 'T2');
  assert.equal(result.ok, true);
  assert.equal(result.targetTierKey, 'T3');
  assert.equal(result.files[0].filename, '.mcp.json');
  const written = JSON.parse(fs.readFileSync(path.join(tmpProject, '.mcp.json'), 'utf8'));
  assert.ok(written.mcpServers);
});

test('buildNextLevelStarter: T5 (multi-agent jump) -> writes BOTH agent files, in the correct nested path', () => {
  const result = buildNextLevelStarter(tmpProject, 'T5');
  assert.equal(result.ok, true);
  assert.equal(result.files.length, 2);
  assert.ok(fs.existsSync(path.join(tmpProject, '.claude', 'agents', 'reviewer.md')));
  assert.ok(fs.existsSync(path.join(tmpProject, '.claude', 'agents', 'tester.md')));
});

test('buildNextLevelStarter: never overwrites an existing file without force', () => {
  fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# My own real instructions, do not touch');
  const result = buildNextLevelStarter(tmpProject, 'T1');
  assert.equal(result.ok, true);
  assert.equal(result.files[0].status, 'skipped-exists');
  const stillThere = fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf8');
  assert.equal(stillThere, '# My own real instructions, do not touch');
});

test('buildNextLevelStarter: overwrites an existing file ONLY when force:true is passed explicitly', () => {
  fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# old content');
  const result = buildNextLevelStarter(tmpProject, 'T1', { force: true });
  assert.equal(result.files[0].status, 'overwritten');
  const written = fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf8');
  assert.match(written, /Nombre del proyecto/);
});

test('buildNextLevelStarter: T7 (max tier) -> nothing to build, no files touched', () => {
  const result = buildNextLevelStarter(tmpProject, 'T7');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'max-tier');
  assert.deepEqual(fs.readdirSync(tmpProject), []);
});

test('buildNextLevelStarter: T0 -> no file target (the T1 snippet is a shell command, not a file) — never invents a file to write', () => {
  const result = buildNextLevelStarter(tmpProject, 'T0');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-file-target');
  assert.deepEqual(fs.readdirSync(tmpProject), []);
});

test('buildNextLevelStarter: unrecognized tier key -> ok:false, never throws', () => {
  assert.doesNotThrow(() => buildNextLevelStarter(tmpProject, 'T99'));
  const result = buildNextLevelStarter(tmpProject, 'T99');
  assert.equal(result.ok, false);
});

test('buildNextLevelStarter: creates nested directories as needed (e.g. .claude/agents/)', () => {
  const result = buildNextLevelStarter(tmpProject, 'T3'); // -> T4, a skill under .claude/skills/review-diff/
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(tmpProject, '.claude', 'skills', 'review-diff', 'SKILL.md')));
});

test('buildNextLevelStarter: does not touch any file outside the target path (no other side effects)', () => {
  fs.writeFileSync(path.join(tmpProject, 'unrelated.txt'), 'untouched');
  buildNextLevelStarter(tmpProject, 'T1');
  assert.equal(fs.readFileSync(path.join(tmpProject, 'unrelated.txt'), 'utf8'), 'untouched');
});
