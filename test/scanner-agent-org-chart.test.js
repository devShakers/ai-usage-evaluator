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
 * `agentCounts` (agents/skills/commands/mcpServers/hooks) is now PROJECT ∪
 * HOME (talents-ai-score, ADR-014, closed decision #5 — this used to be
 * project-root only; recalibrated for tier coherence, issue 019). Every
 * test isolates the home directory to a throwaway dir (AI_FOOTPRINT_HOME_DIR)
 * so these stay hermetic and deterministic across machines/CI.
 */

let tmpDir;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-agents-test-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-scanner-agents-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
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

// --- project ∪ home scope (talents-ai-score, ADR-014, closed decision #5) ---

test('scan: agentCounts ADDS home-level skills/commands/hooks on top of the project root ones', () => {
  fs.mkdirSync(path.join(tmpDir, '.claude', 'skills', 'project-skill'), { recursive: true });
  write(tmpDir, '.claude/commands/project-cmd.md', '# cmd');
  write(tmpDir, '.claude/settings.json', JSON.stringify({ hooks: { PreToolUse: [] } }));

  fs.mkdirSync(path.join(tmpHome, '.claude', 'skills', 'personal-skill'), { recursive: true });
  write(tmpHome, '.claude/commands/personal-cmd.md', '# cmd');
  write(tmpHome, '.claude/settings.json', JSON.stringify({ hooks: { PostToolUse: [] } }));

  const report = scan({ root: tmpDir });
  assert.equal(report.agentCounts.skills, 2); // 1 project + 1 home
  assert.equal(report.agentCounts.commands, 2); // 1 project + 1 home
  assert.equal(report.agentCounts.hooks, 2); // 1 project + 1 home
});

test('scan: report.agents merges project ∪ home agents (project wins on collision)', () => {
  write(tmpDir, '.claude/agents/shared-name.md', ['---', 'name: shared-name', 'model: opus', '---', ''].join('\n'));
  write(tmpHome, '.claude/agents/personal-only.md', ['---', 'name: personal-only', 'model: sonnet', '---', ''].join('\n'));
  write(tmpHome, '.claude/agents/shared-name.md', ['---', 'name: shared-name', 'model: sonnet', '---', ''].join('\n'));

  const report = scan({ root: tmpDir });
  assert.deepEqual(report.agents.map((a) => a.name).sort(), ['personal-only', 'shared-name']);
  const shared = report.agents.find((a) => a.name === 'shared-name');
  assert.equal(shared.model, 'opus'); // project definition wins
});
