'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { parseShareArgs } = require('../bin/share');

/*
 * `share` end-to-end (skill-code-certification): runs the actual bin/share.js
 * as a process (it calls run() on load under require.main), against a temp
 * AI_FOOTPRINT_CONFIG_DIR holding a report-state.json — no network, no real
 * footprint scan needed. Proves the command reads the stored footprint, writes
 * the card and prints its file:// link; and, with no footprint, tells the
 * Talent to run `footprint` first.
 */

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

test('share (en): with a stored footprint, writes the card and prints its file:// link', async () => {
  writeState(tmpProjectDir, { score: 78, tier: 5, tierKey: 'T5', key: 'orchestrator' });
  const { code, stdout } = await runCli({
    args: ['--root', tmpProjectDir, '--lang', 'en'],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /file:\/\//);
  assert.match(stdout, /download the PNG/i);
  // The card file is written next to the reports.
  const cards = fs.readdirSync(tmpConfigDir).filter((f) => f.startsWith('share-') && f.endsWith('.html'));
  assert.equal(cards.length, 1);
  const html = fs.readFileSync(path.join(tmpConfigDir, cards[0]), 'utf8');
  assert.match(html, />T5</);
  assert.match(html, /toDataURL\('image\/png'\)/);
  assert.match(html, /linkedin\.com/);
});

test('share (es): no footprint for this project -> actionable "run footprint first"', async () => {
  const { code, stdout } = await runCli({
    args: ['--root', tmpProjectDir, '--lang', 'es'],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /footprint/);
  assert.match(stdout, /Aún no hay footprint/);
  // Nothing written.
  const cards = fs.readdirSync(tmpConfigDir).filter((f) => f.startsWith('share-'));
  assert.equal(cards.length, 0);
});
