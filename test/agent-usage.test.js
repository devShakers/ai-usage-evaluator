'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectClaudeAgentUsage, collectAgentUsage, historyRoot } = require('../src/agent-usage');

// Build a throwaway fake home with a Claude Code session file carrying N Agent
// tool_use invocations of the given subagent types.
function fakeHome(invocations) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-home-'));
  const proj = path.join(home, '.claude', 'projects', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const lines = invocations.map((t) =>
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Agent', input: { description: 'x', subagent_type: t, prompt: 'y' } },
    ] } }),
  );
  // Plus some noise lines with no signal.
  lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }));
  fs.writeFileSync(path.join(proj, 'session.jsonl'), lines.join('\n') + '\n');
  return home;
}

test('collectClaudeAgentUsage: counts Agent tool_use by subagent_type', () => {
  const home = fakeHome(['ai-engineer', 'ai-engineer', 'backend-developer']);
  try {
    const usage = collectClaudeAgentUsage({ AI_FOOTPRINT_HOME_DIR: home });
    assert.equal(usage.available, true);
    assert.equal(usage.byAgent['ai-engineer'], 2);
    assert.equal(usage.byAgent['backend-developer'], 1);
    assert.equal(usage.totalInvocations, 3);
    assert.ok(usage.sessionsScanned >= 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('collectAgentUsage: annotates DETECTED agents by exact name (0 when never used, ignores foreign types)', () => {
  const home = fakeHome(['worker-a', 'worker-a', 'worker-a', 'general-purpose']);
  try {
    const agents = [{ name: 'worker-a' }, { name: 'worker-b' }];
    const u = collectAgentUsage(agents, { AI_FOOTPRINT_HOME_DIR: home });
    assert.equal(u.available, true);
    assert.equal(u.byAgent['worker-a'], 3);
    assert.equal(u.byAgent['worker-b'], 0); // detected but never invoked
    assert.equal('general-purpose' in u.byAgent, false); // foreign type not annotated
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('collectAgentUsage: degrades gracefully when there is no history (available:false, counts null)', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-empty-'));
  try {
    const u = collectAgentUsage([{ name: 'x' }], { AI_FOOTPRINT_HOME_DIR: empty });
    assert.equal(u.available, false);
    assert.equal(u.byAgent['x'], null); // unknown, distinct from "used 0 times"
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('collectClaudeAgentUsage: a malformed jsonl line never throws', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-usage-bad-'));
  const proj = path.join(home, '.claude', 'projects', 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 's.jsonl'), '{ this is not json subagent_type\n{"type":"user"}\n');
  try {
    assert.doesNotThrow(() => collectClaudeAgentUsage({ AI_FOOTPRINT_HOME_DIR: home }));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('historyRoot: honours AI_FOOTPRINT_HOME_DIR', () => {
  assert.equal(historyRoot({ AI_FOOTPRINT_HOME_DIR: '/tmp/x' }), path.join('/tmp/x', '.claude', 'projects'));
});
