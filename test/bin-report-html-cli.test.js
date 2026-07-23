'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPORT_BIN = path.join(__dirname, '..', 'bin', 'report-html.js');
const { persistFootprint } = require('../src/report-store');

function runReport(args, env) {
  const res = spawnSync(process.execPath, [REPORT_BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// A minimal footprint report/maturity, enough for the store + renderer.
function seedFootprint(configDir, root) {
  const prev = process.env.AI_FOOTPRINT_CONFIG_DIR;
  process.env.AI_FOOTPRINT_CONFIG_DIR = configDir;
  try {
    persistFootprint({
      root,
      report: {
        generatedAt: '2026-07-17T00:00:00.000Z',
        tools: [{ id: 'claude-code', name: 'Claude Code', detected: true, depth: {}, category: 'CLI agéntica' }],
        technologies: ['React'],
        agents: [],
      },
      maturity: { level: 1, key: 'exploring', name: 'Exploring', score: 20, tier: 1, tierKey: 'T1' },
    });
  } finally {
    if (prev === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR;
    else process.env.AI_FOOTPRINT_CONFIG_DIR = prev;
  }
}

test('report: no footprint for this project -> actionable "run footprint first", no crash', () => {
  const configDir = tmpDir('ai-report-cfg-');
  const root = tmpDir('ai-report-proj-');
  try {
    const { code, stdout } = runReport(['--root', root, '--lang', 'en', '--no-open'], { AI_FOOTPRINT_CONFIG_DIR: configDir });
    assert.equal(code, 0);
    assert.match(stdout, /Nothing to show for this project yet/);
    assert.equal(/file:\/\//.test(stdout), false);
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('report: after footprint persisted state, materializes the HTML and prints the file:// link (--no-open)', () => {
  const configDir = tmpDir('ai-report-cfg-');
  const root = tmpDir('ai-report-proj-');
  try {
    seedFootprint(configDir, root);
    // footprint persisted STATE only — no html yet.
    assert.equal(fs.readdirSync(configDir).some((f) => /^report-.*\.html$/.test(f)), false, 'no html before report');

    const { code, stdout } = runReport(['--root', root, '--lang', 'en', '--no-open'], { AI_FOOTPRINT_CONFIG_DIR: configDir });
    assert.equal(code, 0);
    assert.match(stdout, /Your report is ready/);
    assert.match(stdout, /file:\/\/\S+report-[a-f0-9]{12}\.html/);
    // --no-open => no "Opening…" line.
    assert.equal(/Opening it in your browser/.test(stdout), false);
    // report materialized the html.
    const htmlFile = fs.readdirSync(configDir).find((f) => /^report-[a-f0-9]{12}\.html$/.test(f));
    assert.ok(htmlFile, 'report materialized the per-project html');
    const html = fs.readFileSync(path.join(configDir, htmlFile), 'utf8');
    assert.ok(html.includes('--bg:var(--white)'), 'mockup light theme (white background)');
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('report --help: prints localized help, no crash', () => {
  const { code, stdout } = runReport(['--help', '--lang', 'en'], {});
  assert.equal(code, 0);
  assert.match(stdout, /report —/);
});
