'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { parseShareArgs } = require('../bin/share');

const BIN = path.join(__dirname, '..', 'bin', 'share.js');

function runCli({ args = [], env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

let tmpConfigDir;
let tmpProjectDir;

test.beforeEach(() => {
  tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-share-config-'));
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-share-project-'));
});
test.afterEach(() => {
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
});

function writeState(root, maturity) {
  const state = {
    schemaVersion: 2,
    updatedAt: '2026-07-16T10:00:00.000Z',
    projects: {
      [path.resolve(root)]: {
        root: path.resolve(root),
        updatedAt: '2026-07-16T10:00:00.000Z',
        footprint: { generatedAt: '2026-07-16T10:00:00.000Z', report: { tools: [] }, maturity },
        certifications: {},
      },
    },
  };
  fs.writeFileSync(path.join(tmpConfigDir, 'report-state.json'), JSON.stringify(state));
}

test('parseShareArgs: --root / --lang / --help', () => {
  assert.deepEqual(parseShareArgs(['--root', '/x', '--lang', 'es']), { root: '/x', lang: 'es', help: false });
  assert.deepEqual(parseShareArgs(['--root=/y']).root, '/y');
  assert.equal(parseShareArgs(['--lang', 'zz']).lang, null); // unknown lang ignored
  assert.equal(parseShareArgs(['--help']).help, true);
});

test('share (en): the command is disabled — it prints the disabled notice and writes no card', async () => {
  writeState(tmpProjectDir, { score: 78, tier: 5, tierKey: 'T5', key: 'orchestrator' });
  const { code, stdout } = await runCli({
    args: ['--root', tmpProjectDir, '--lang', 'en'],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /disabled/i);
  assert.doesNotMatch(stdout, /file:\/\//);
  const cards = fs.readdirSync(tmpConfigDir).filter((f) => f.startsWith('share-') && f.endsWith('.html'));
  assert.equal(cards.length, 0);
});

test('share (es): even with no footprint, the disabled notice is shown and nothing runs', async () => {
  const { code, stdout } = await runCli({
    args: ['--root', tmpProjectDir, '--lang', 'es'],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /deshabilitado/i);
  // Nothing written.
  const cards = fs.readdirSync(tmpConfigDir).filter((f) => f.startsWith('share-'));
  assert.equal(cards.length, 0);
});
