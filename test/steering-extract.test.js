'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectSteering } = require('../src/steering-extract');

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'steering-home-'));
}

function writeSession(home, tool, name, lines) {
  const dirs = {
    claude: path.join(home, '.claude', 'projects', 'proj'),
    codex: path.join(home, '.codex', 'sessions'),
    cursor: path.join(home, '.cursor', 'chats'),
  };
  fs.mkdirSync(dirs[tool], { recursive: true });
  fs.writeFileSync(
    path.join(dirs[tool], name),
    lines.map((l) => JSON.stringify(l)).join('\n'),
  );
}

function userText(text) {
  return { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
}

function assistantText(text) {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } };
}

test('returns null when there are no sessions', () => {
  const home = makeHome();
  assert.equal(collectSteering({ SHAKERS_CLI_HOME_DIR: home }), null);
});

test('counts steering turns and returns a redacted, capped sample', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [
    userText('No, usa el patrón del grader en vez de reinventarlo'),
    userText('perfecto, gracias'),
    userText('cambia el nombre de la columna a work_streams'),
  ]);
  const out = collectSteering({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.steeringTraceCount, 2);
  assert.equal(out.redactedSteeringExcerpts.length, 2);
});

test('scoping: only steering turns from the selected repos are counted', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'keep.jsonl', [
    { cwd: '/work/keep' },
    userText('no, usa el patrón del grader'),
    userText('cambia la columna a work_streams'),
  ]);
  writeSession(home, 'claude', 'exclude.jsonl', [
    { cwd: '/work/client' },
    userText('no, quita ese endpoint del cliente'),
  ]);

  const scoped = collectSteering(
    { SHAKERS_CLI_HOME_DIR: home },
    new Set(['/work/keep']),
  );
  assert.equal(scoped.steeringTraceCount, 2);

  const all = collectSteering({ SHAKERS_CLI_HOME_DIR: home }, null);
  assert.equal(all.steeringTraceCount, 3);
});

test('never captures assistant prose, tool_results or injected system tags', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [
    assistantText('No voy a cambiar nada, usa esto'),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'usa esto instead' }] } },
    userText('<ide_opened_file>usa /secret/path.ts instead</ide_opened_file>'),
    userText('usa gpt-4o como primary'),
  ]);
  const out = collectSteering({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.steeringTraceCount, 1);
  assert.deepEqual(out.redactedSteeringExcerpts, ['usa gpt-4o como primary']);
});

test('secrets and paths in an excerpt are redacted', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [
    userText('no uses el token sk-ABCDEFGHIJKLMNOPQRSTUVWX, cambia a la env var'),
  ]);
  const out = collectSteering({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.steeringTraceCount, 1);
  assert.ok(out.redactedSteeringExcerpts[0].includes('[REDACTED]'));
  assert.ok(!JSON.stringify(out).includes('sk-ABCDEFGHIJKLMNOPQRSTUVWX'));
});

test('the excerpt sample is capped at 20 while the count keeps growing', () => {
  const home = makeHome();
  const lines = [];
  for (let i = 0; i < 30; i++) lines.push(userText(`cambia la cosa numero ${i}`));
  writeSession(home, 'claude', 'a.jsonl', lines);
  const out = collectSteering({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.steeringTraceCount, 30);
  assert.equal(out.redactedSteeringExcerpts.length, 20);
});
