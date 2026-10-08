'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectDecisions } = require('../src/decisions-extract');

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-home-'));
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

test('returns null when no decision exchange is present', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [userText('hola, arranca')]);
  assert.equal(collectDecisions({ SHAKERS_CLI_HOME_DIR: home }), null);
});

test('counts decision exchanges and returns a redacted, capped sample', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [
    userText('vamos con gpt-4o rather than gemini porque es más consistente'),
    userText('ok'),
    userText('prefiero la opción best-of-3, descartamos el single-shot'),
  ]);
  const out = collectDecisions({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.decisionExchangeCount, 2);
  assert.equal(out.redactedDecisionExcerpts.length, 2);
});

test('secrets in a decision excerpt are redacted', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [
    userText('decidimos usar el token sk-ABCDEFGHIJKLMNOPQRSTUVWX porque ya estaba'),
  ]);
  const out = collectDecisions({ SHAKERS_CLI_HOME_DIR: home });
  assert.equal(out.decisionExchangeCount, 1);
  assert.ok(out.redactedDecisionExcerpts[0].includes('[REDACTED]'));
  assert.ok(!JSON.stringify(out).includes('sk-ABCDEFGHIJKLMNOPQRSTUVWX'));
});
