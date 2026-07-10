'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');

/*
 * talents-ai-score, issue 009 (ADR-009): scanner.js wiring for the
 * deterministic agent org chart. Scoped to the NEW fields only
 * (`report.agents`, `report.agentCounts`) — everything else about scan()
 * is out of scope for this issue and untouched.
 *
 * `agentCounts` (agents/skills/commands/mcpServers/hooks) is computed from
 * the scanned PROJECT ROOT only (never the developer's real home
 * directory), same scope as `.claude/agents` itself — this keeps the test
 * hermetic and deterministic across machines/CI, and matches the fact the
 * org chart itself is project-scoped, not personal/home-scoped.
 */

let tmpDir;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-agents-test-'));
});

test.afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('scan: empty root -> agents is an empty array, agentCounts all zero', () => {
  const report = scan({ root: tmpDir });
  assert.deepEqual(report.agents, []);
  assert.deepEqual(report.agentCounts, { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 });
});

test('scan: populates report.agents with the exact shape {name, tools[], model, parent}', () => {
  write(tmpDir, '.claude/agents/backend-developer.md', [
    '---',
    'name: backend-developer',
    'description: |',
    '  Secret client framing that must never appear in the report.',
    'tools: Read, Write, Bash',
    'model: sonnet',
    '---',
    '',
  ].join('\n'));

  const report = scan({ root: tmpDir });
  assert.equal(report.agents.length, 1);
  assert.deepEqual(Object.keys(report.agents[0]).sort(), ['model', 'name', 'parent', 'tools'].sort());
  assert.deepEqual(report.agents[0], {
    name: 'backend-developer',
    tools: ['Read', 'Write', 'Bash'],
    model: 'sonnet',
    parent: null,
  });
  assert.equal(JSON.stringify(report).includes('Secret client framing'), false);
});

test('scan: agentCounts reflects agents/skills/commands/mcpServers/hooks from the project root', () => {
  write(tmpDir, '.claude/agents/a.md', ['---', 'name: agent-a', '---', ''].join('\n'));
  write(tmpDir, '.claude/agents/b.md', ['---', 'name: agent-b', '---', ''].join('\n'));
  fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', 'skill-one'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', 'skill-two'), { recursive: true });
  write(tmpDir, '.claude/commands/cmd-one.md', '# cmd');
  write(tmpDir, '.claude/commands/cmd-two.md', '# cmd');
  write(tmpDir, '.claude/commands/cmd-three.md', '# cmd');
  write(tmpDir, '.mcp.json', JSON.stringify({ mcpServers: { figma: {}, postgres: {} } }));
  write(tmpDir, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [], PostToolUse: [] } }));

  const report = scan({ root: tmpDir });
  assert.deepEqual(report.agentCounts, {
    agents: 2,
    skills: 2,
    commands: 3,
    mcpServers: 2,
    hooks: 2,
  });
});
