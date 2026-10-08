'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectSessions } = require('../src/session-scan');

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-home-'));
}

function writeSession(home, tool, name, lines) {
  const dirs = {
    claude: path.join(home, '.claude', 'projects', 'proj'),
    codex: path.join(home, '.codex', 'sessions'),
    cursor: path.join(home, '.cursor', 'chats'),
  };
  const dir = dirs[tool];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    lines.map((l) => JSON.stringify(l)).join('\n'),
  );
}

test('returns null when no tool has any session', () => {
  const home = makeHome();
  assert.equal(collectSessions({ SHAKERS_CLI_HOME_DIR: home }), null);
});

test('excludes agent-*.meta.json and sessions-index.json (no phantom unattributed sessions)', () => {
  const home = makeHome();
  const projDir = path.join(home, '.claude', 'projects', 'proj', 'uuid');
  fs.mkdirSync(path.join(projDir, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(projDir, 'root.jsonl'), JSON.stringify({ cwd: '/work/repo-a' }));
  fs.writeFileSync(path.join(projDir, 'subagents', 'agent-abc.jsonl'), JSON.stringify({ cwd: '/work/repo-a' }));
  // Junk that must NEVER be counted as a session:
  fs.writeFileSync(path.join(projDir, 'subagents', 'agent-abc.meta.json'), '{"model":"x"}');
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'proj', 'sessions-index.json'), '{"sessions":[]}');

  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.sessionCount, 1); // ONE root transcript, not the junk
  assert.equal(out.subagentRunCount, 1); // the subagent counted separately
});

test('activeHours caps idle gaps (a long pause never inflates active time)', () => {
  const home = makeHome();
  const base = Date.parse('2026-08-01T10:00:00.000Z');
  const iso = (ms) => new Date(base + ms).toISOString();
  writeSession(home, 'claude', 'a.jsonl', [
    { cwd: '/r', timestamp: iso(0) },
    { timestamp: iso(10 * 60000) }, // +10 min (counts fully)
    { timestamp: iso(130 * 60000) }, // +2 h gap -> capped to 25 min
    { timestamp: iso(140 * 60000) }, // +10 min (counts fully)
  ]);
  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  // capped: 10 + 25 + 10 = 45 min = 0.75 h; raw span would be 140 min = 2.33 h
  assert.ok(out.activeHours > 0 && out.activeHours < 1, `got ${out.activeHours}`);
});

test('sessionCount is ROOT transcripts only; subagents are a separate metric', () => {
  const home = makeHome();
  const projDir = path.join(home, '.claude', 'projects', 'p', 's');
  fs.mkdirSync(path.join(projDir, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(projDir, 'a.jsonl'), JSON.stringify({ cwd: '/r' }));
  fs.writeFileSync(path.join(projDir, 'b.jsonl'), JSON.stringify({ cwd: '/r' }));
  for (const n of ['agent-1.jsonl', 'agent-2.jsonl', 'agent-3.jsonl']) {
    fs.writeFileSync(path.join(projDir, 'subagents', n), JSON.stringify({ cwd: '/r' }));
  }
  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.sessionCount, 2);
  assert.equal(out.subagentRunCount, 3);
});

test('counts sessions, files touched, bash commands and redacts the sample', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [
    { cwd: '/work/repo-a', message: { content: [{ type: 'text', text: 'hi' }] } },
    {
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'export TOKEN=sk-ABCDEFGHIJKLMNOPQRST' } },
        ],
      },
    },
    {
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/work/repo-a/src/index.ts' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/work/repo-a/src/index.ts' } },
        ],
      },
    },
  ]);

  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  assert.deepEqual(out.toolsSeen, ['claude']);
  assert.equal(out.sessionCount, 1);
  assert.equal(out.filesTouchedCount, 1);
  assert.equal(out.bashCommandsCount, 1);
  assert.equal(out.redactedCommandSample.length, 1);
  assert.ok(out.redactedCommandSample[0].includes('[REDACTED]'));
  assert.ok(!JSON.stringify(out).includes('sk-ABCDEFGHIJKLMNOPQRST'));
  assert.equal(out.planningSignalCount, 0);
});

test('planningSignalCount counts ExitPlanMode and TodoWrite tool_use, nothing else', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [
    { cwd: '/work/repo-a', message: { content: [{ type: 'text', text: 'plan it' }] } },
    {
      message: {
        content: [
          { type: 'tool_use', name: 'ExitPlanMode', input: { plan: 'do X then Y' } },
          { type: 'tool_use', name: 'TodoWrite', input: { todos: [] } },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/work/repo-a/src/index.ts' } },
        ],
      },
    },
    {
      message: {
        content: [
          { type: 'tool_use', name: 'TodoWrite', input: { todos: [] } },
        ],
      },
    },
  ]);

  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.planningSignalCount, 3);
});

test('crossToolLinks counts a cwd seen under more than one tool', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [{ cwd: '/work/shared' }]);
  writeSession(home, 'codex', 'b.jsonl', [{ cwd: '/work/shared' }]);
  writeSession(home, 'codex', 'c.jsonl', [{ cwd: '/work/only-codex' }]);

  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  assert.deepEqual(out.toolsSeen.sort(), ['claude', 'codex']);
  assert.equal(out.sessionCount, 3);
  assert.equal(out.crossToolLinks, 1);
});

test('scoping: a selectedCwds set keeps only sessions from the chosen repos', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [{ cwd: '/work/keep' }]);
  writeSession(home, 'claude', 'b.jsonl', [{ cwd: '/work/keep' }]);
  writeSession(home, 'codex', 'c.jsonl', [{ cwd: '/work/exclude' }]);

  const scoped = collectSessions(
    { SHAKERS_CLI_HOME_DIR: home },
    new Set(['/work/keep']),
  );
  assert.equal(scoped.sessionCount, 2);
  assert.deepEqual(scoped.toolsSeen, ['claude']);

  const all = collectSessions({ SHAKERS_CLI_HOME_DIR: home }, null);
  assert.equal(all.sessionCount, 3);
});

test('scoping: a session with no attributable cwd is excluded under a selection', () => {
  const home = makeHome();
  writeSession(home, 'cursor', 'a.jsonl', [
    { message: { content: [{ type: 'text', text: 'no cwd here' }] } },
  ]);
  const scoped = collectSessions(
    { SHAKERS_CLI_HOME_DIR: home },
    new Set(['/work/keep']),
  );
  assert.equal(scoped, null); // nothing in scope
});

test('file paths are never emitted, only the count', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [
    {
      message: {
        content: [
          { type: 'tool_use', name: 'Write', input: { file_path: '/secret/path/passwords.txt' } },
        ],
      },
    },
  ]);

  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.filesTouchedCount, 1);
  assert.ok(!JSON.stringify(out).includes('passwords.txt'));
});
