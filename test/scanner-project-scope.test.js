'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

/*
 * skill-code-certification / ADR-009: scanner.js attaches `report.projectScope`
 * — the 7 score dimensions computed from PROJECT-ONLY signals (never home), so
 * the maturity SCORE reflects THIS project and different projects score
 * differently. The tier keeps its project ∪ home scope (tested elsewhere).
 * These tests scope a scan to a throwaway temp project so no home signal leaks
 * into the assertions.
 */

let tmpDir;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-project-scope-test-'));
});

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('scan: report.projectScope is always present with the 7 score dimensions', () => {
  const report = scan({ root: tmpDir });
  const ps = report.projectScope;
  assert.ok(ps, 'projectScope must be attached');
  for (const key of ['breadth', 'context', 'mcp', 'custom', 'hasAgentic', 'hooks', 'agentCount']) {
    assert.ok(key in ps, `projectScope missing "${key}"`);
  }
});

test('scan: a bare project (no in-repo AI config) has an all-zero projectScope', () => {
  const ps = scan({ root: tmpDir }).projectScope;
  assert.equal(ps.breadth, 0);
  assert.equal(ps.context, 0);
  assert.equal(ps.mcp, 0);
  assert.equal(ps.custom, 0);
  assert.equal(ps.hasAgentic, false);
  assert.equal(ps.hooks, 0);
  assert.equal(ps.agentCount, 0);
});

test('scan: in-repo Claude Code config populates project-scoped signals (project only, never home)', () => {
  fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# context');
  fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', 's1'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', 's2'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.claude', 'commands', 'a.md'), 'cmd');
  fs.writeFileSync(path.join(tmpDir, '.mcp.json'), JSON.stringify({ mcpServers: { x: {}, y: {} } }));
  fs.writeFileSync(path.join(tmpDir, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [] } }));

  const ps = scan({ root: tmpDir }).projectScope;
  assert.ok(ps.breadth >= 1, 'claude-code detected via a project path counts toward breadth');
  assert.equal(ps.context, 1); // CLAUDE.md
  assert.equal(ps.mcp, 2); // two MCP servers in .mcp.json
  assert.equal(ps.custom, 3); // 2 skills + 1 command
  assert.equal(ps.hasAgentic, true); // agentic CLI with project config
  assert.equal(ps.hooks, 1); // one hooks key
});

test('scan: projectScope counts agents defined IN THE PROJECT only', () => {
  const agentsDir = path.join(tmpDir, '.claude', 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(agentsDir, 'a1.md'), '---\nname: alpha\n---\nbody');
  fs.writeFileSync(path.join(agentsDir, 'a2.md'), '---\nname: beta\n---\nbody');
  const ps = scan({ root: tmpDir }).projectScope;
  assert.equal(ps.agentCount, 2);
});

test('scan: projectScope is deterministic — same tree yields the same values', () => {
  fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# context');
  const a = scan({ root: tmpDir }).projectScope;
  const b = scan({ root: tmpDir }).projectScope;
  assert.deepEqual(a, b);
});
