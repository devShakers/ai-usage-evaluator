'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeCodexRecord,
  normalizeGeminiRecord,
  normalizeContinueRecord,
  normalizeClineRecord,
  parseAiderHistory,
} = require('../src/session-normalizers');
const { collectSessions, toolSources } = require('../src/session-scan');

// Fixtures are SYNTHETIC, built to the documented format. Every parser is FAIL-CLOSED:
// a record whose shape does not match yields 0 records, never a fabricated/half-filled one.

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'normalizers-home-'));
}
function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// --- Codex normalizer units ---
test('codex: user message -> human text turn', () => {
  const o = normalizeCodexRecord({
    type: 'response_item', timestamp: '2026-01-01T10:01:00Z',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'refactor auth' }] },
  });
  assert.equal(o.type, 'user');
  assert.equal(o.message.content[0].text, 'refactor auth');
  assert.equal(o.timestamp, '2026-01-01T10:01:00Z');
});

test('codex: shell function_call -> tool_use Shell command', () => {
  const o = normalizeCodexRecord({
    type: 'response_item',
    payload: { type: 'function_call', name: 'shell', arguments: '{"command":["bash","-lc","npm test"]}' },
  });
  assert.equal(o.message.content[0].type, 'tool_use');
  assert.equal(o.message.content[0].name, 'Shell');
  assert.equal(o.message.content[0].input.command, 'bash -lc npm test');
});

test('codex: session_meta passes cwd + timestamp through', () => {
  const o = normalizeCodexRecord({ type: 'session_meta', timestamp: '2026-01-01T10:00:00Z', payload: { cwd: '/work/repo' } });
  assert.equal(o.cwd, '/work/repo');
  assert.equal(o.timestamp, '2026-01-01T10:00:00Z');
});

test('codex: record with no useful field -> null', () => {
  assert.equal(normalizeCodexRecord({ type: 'token_count', payload: { total: 10 } }), null);
  assert.equal(normalizeCodexRecord(null), null);
});

// --- Gemini normalizer units ---
test('gemini: user log record -> human text turn', () => {
  const o = normalizeGeminiRecord({ sessionId: 's1', messageId: 'm1', type: 'user', message: 'add tests', timestamp: '2026-01-02T09:00:00Z' });
  assert.equal(o.type, 'user');
  assert.equal(o.message.content[0].text, 'add tests');
  assert.equal(o.timestamp, '2026-01-02T09:00:00Z');
});

test('gemini: model record -> timestamp only (no human text)', () => {
  const o = normalizeGeminiRecord({ type: 'model', message: 'ok', timestamp: '2026-01-02T09:00:30Z' });
  assert.equal(o.type, undefined);
  assert.equal(o.timestamp, '2026-01-02T09:00:30Z');
});

test('gemini: jsonl role/parts shape -> human text', () => {
  const o = normalizeGeminiRecord({ role: 'user', parts: [{ text: 'fix the bug' }], timestamp: '2026-01-02T09:01:00Z' });
  assert.equal(o.message.content[0].text, 'fix the bug');
});

// No tool is removed from the scan source list (owner decision) — Cursor stays even
// though its old ~/.cursor/chats path is obsolete and finds nothing on real machines.
test('toolSources retains every tool', () => {
  const tools = toolSources({ SHAKERS_CLI_HOME_DIR: makeHome() }).map((s) => s.tool);
  for (const t of ['claude', 'codex', 'gemini', 'cursor', 'continue', 'cline', 'aider']) {
    assert.ok(tools.includes(t), `expected ${t} source retained`);
  }
});

// --- Continue ---
test('continue: expands history into user turns with workspace cwd', () => {
  const out = normalizeContinueRecord({
    sessionId: 's', workspaceDirectory: '/work/repo',
    history: [
      { message: { role: 'user', content: 'add a test' }, timestamp: '2026-02-01T10:00:00Z' },
      { message: { role: 'assistant', content: 'ok' } },
    ],
  });
  assert.ok(Array.isArray(out));
  assert.equal(out[0].type, 'user');
  assert.equal(out[0].cwd, '/work/repo');
  assert.equal(out[0].message.content[0].text, 'add a test');
});

test('continue: fail-closed on an unrelated object', () => {
  assert.equal(normalizeContinueRecord({ foo: 'bar' }), null);
  assert.equal(normalizeContinueRecord({ history: [{ message: { role: 'assistant', content: 'hi' } }] }), null);
});

// --- Cline / Roo ---
test('cline: user message -> human text turn', () => {
  const o = normalizeClineRecord({ role: 'user', content: [{ type: 'text', text: 'fix the bug' }] });
  assert.equal(o.type, 'user');
  assert.equal(o.message.content[0].text, 'fix the bug');
});

test('cline: fail-closed on assistant or shapeless record', () => {
  assert.equal(normalizeClineRecord({ role: 'assistant', content: 'x' }), null);
  assert.equal(normalizeClineRecord({ role: 'user', content: [] }), null);
  assert.equal(normalizeClineRecord(null), null);
});

// --- Aider ---
test('aider: parses markdown header timestamp + #### user lines, cwd = repo', () => {
  const md = [
    '# aider chat started at 2026-03-01 09:30:00',
    '',
    '#### refactor the parser',
    'assistant reply here',
    '#### now add tests',
  ].join('\n');
  const out = parseAiderHistory(md, '/work/repo');
  const users = out.filter((o) => o.type === 'user');
  assert.equal(users.length, 2);
  assert.equal(users[0].cwd, '/work/repo');
  assert.equal(users[0].message.content[0].text, 'refactor the parser');
  assert.ok(out.some((o) => o.timestamp));
});

test('aider: fail-closed on markdown that is not an aider history', () => {
  assert.deepEqual(parseAiderHistory('# Some README\n\nJust prose, no aider markers.', '/work/repo'), []);
  assert.deepEqual(parseAiderHistory('', '/work/repo'), []);
});

// --- Gemini fail-closed ---
test('gemini: fail-closed on a record with no user text and no timestamp', () => {
  assert.equal(normalizeGeminiRecord({ type: 'user', message: '' }), null);
  assert.equal(normalizeGeminiRecord({ foo: 1 }), null);
});

// --- Integration: a temp HOME with codex + gemini fixtures ---
test('collectSessions picks up codex + gemini', () => {
  const home = makeHome();

  // Codex rollout jsonl
  writeFile(
    path.join(home, '.codex', 'sessions', '2026', '01', '01', 'rollout-x.jsonl'),
    [
      JSON.stringify({ type: 'session_meta', timestamp: '2026-01-01T10:00:00Z', payload: { cwd: '/work/repo' } }),
      JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T10:01:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'refactor auth' }] } }),
      JSON.stringify({ type: 'response_item', timestamp: '2026-01-01T10:02:00Z', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["bash","-lc","npm test"]}' } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-01-01T10:03:00Z', payload: { type: 'agent_message', message: 'done' } }),
    ].join('\n'),
  );

  // Gemini logs.json (JSON array)
  writeFile(
    path.join(home, '.gemini', 'tmp', 'abc123hash', 'chats', 'logs.json'),
    JSON.stringify([
      { sessionId: 's1', messageId: 'm1', type: 'user', message: 'add pricing tests', timestamp: '2026-01-02T09:00:00Z' },
      { sessionId: 's1', messageId: 'm2', type: 'model', message: 'sure', timestamp: '2026-01-02T09:00:30Z' },
    ]),
  );

  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  assert.ok(out, 'expected a sessions result');
  assert.ok(out.toolsSeen.includes('codex'), 'codex scanned');
  assert.ok(out.toolsSeen.includes('gemini'), 'gemini scanned');
  assert.ok(out.bashCommandsCount >= 1, 'codex shell command harvested');
  assert.ok(out.redactedCommandSample.includes('bash -lc npm test'), 'command sample carries the codex shell command');
});

test('Claude scanning is unchanged alongside the new sources', () => {
  const home = makeHome();
  writeFile(path.join(home, '.claude', 'projects', 'proj', 's', 'root.jsonl'),
    JSON.stringify({ cwd: '/work/repo', timestamp: '2026-01-04T09:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'hello claude' }] } }));
  const out = collectSessions({ SHAKERS_CLI_HOME_DIR: home });
  assert.ok(out.toolsSeen.includes('claude'));
  assert.equal(out.sessionCount, 1);
});
