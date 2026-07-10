'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectAutomations, mentionsAiCli, looksLikeJsonPiping } = require('../src/automations-detector');

/*
 * talents-ai-score, issue 017 (ADR-013/014): deterministic (no-LLM)
 * automations detector. Covers:
 *   - npm scripts (package.json `scripts`) and shell scripts (`scripts/*.sh`)
 *     that invoke a known AI CLI (claude/aider/gemini/codex) — a derived
 *     count, never the script text.
 *   - JSON-piping patterns (`--json`/`-p` chained with `|`) in those same
 *     scripts.
 *   - Scheduled tasks (cron/launchd/pm2/systemd) where safely inspectable
 *     (the user's OWN crontab/agents/process list) — each source reports
 *     whether it was inspected at all, never invents a result for a source
 *     it couldn't safely check (e.g. a system-wide crontab needing
 *     elevated permissions).
 */

let tmpProject;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-automations-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-automations-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function write(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// --- pure helpers -------------------------------------------------------------

test('mentionsAiCli: matches known AI CLI names as whole words', () => {
  assert.equal(mentionsAiCli('claude -p "do the thing"'), true);
  assert.equal(mentionsAiCli('npx aider --yes'), true);
  assert.equal(mentionsAiCli('gemini chat'), true);
  assert.equal(mentionsAiCli('codex exec "task"'), true);
});

test('mentionsAiCli: does not false-positive on unrelated words containing the substring', () => {
  assert.equal(mentionsAiCli('run codexterity-linter'), false);
  assert.equal(mentionsAiCli('echo claudette'), false);
});

test('looksLikeJsonPiping: true only when an AI CLI + --json/-p + a pipe all appear together', () => {
  assert.equal(looksLikeJsonPiping('claude -p "summarize" --output-format json | jq .result'), true);
  assert.equal(looksLikeJsonPiping('claude --json | node parse.js'), true);
  assert.equal(looksLikeJsonPiping('claude -p "just ask"'), false); // no pipe
  assert.equal(looksLikeJsonPiping('cat file.json | jq .'), false); // no AI CLI
});

// --- npm scripts (package.json) ----------------------------------------------

test('detectAutomations: no package.json -> npm script count is 0, never throws', () => {
  const result = detectAutomations(tmpProject);
  assert.equal(result.scripts.npm, 0);
});

test('detectAutomations: counts npm scripts that invoke a known AI CLI', () => {
  write(tmpProject, 'package.json', JSON.stringify({
    scripts: {
      build: 'tsc',
      'ai-review': 'claude -p "review this diff"',
      'ai-fix': 'aider --yes-always',
    },
  }));
  const result = detectAutomations(tmpProject);
  assert.equal(result.scripts.npm, 2);
});

test('detectAutomations: detects JSON-piping pattern in an npm script', () => {
  write(tmpProject, 'package.json', JSON.stringify({
    scripts: { 'ai-json': 'claude -p "summarize" --output-format json | jq .result' },
  }));
  const result = detectAutomations(tmpProject);
  assert.equal(result.jsonPiping, 1);
});

test('detectAutomations: malformed package.json does not throw, npm count stays 0', () => {
  write(tmpProject, 'package.json', '{ not valid json');
  assert.doesNotThrow(() => detectAutomations(tmpProject));
  assert.equal(detectAutomations(tmpProject).scripts.npm, 0);
});

// --- shell scripts (scripts/*.sh) ---------------------------------------------

test('detectAutomations: counts shell scripts that invoke a known AI CLI', () => {
  write(tmpProject, 'scripts/deploy.sh', '#!/bin/bash\nnpm run build\n');
  write(tmpProject, 'scripts/ai-lint.sh', '#!/bin/bash\nclaude -p "lint this codebase"\n');
  const result = detectAutomations(tmpProject);
  assert.equal(result.scripts.shell, 1);
});

test('detectAutomations: never returns the script TEXT content, only counts', () => {
  const secretMarker = 'PROJECT-CODENAME-DO-NOT-LEAK';
  write(tmpProject, 'scripts/ai-task.sh', `#!/bin/bash\n# Working on ${secretMarker}\nclaude -p "task"\n`);
  const result = detectAutomations(tmpProject);
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
});

// --- schedulers: inspected vs not-inspectable, never invented ----------------

test('detectAutomations: scheduler probes always report an `inspected` boolean, never throw, never invent a result', () => {
  const result = detectAutomations(tmpProject);
  for (const key of ['cron', 'launchd', 'pm2', 'systemd']) {
    assert.equal(typeof result.schedulers[key].inspected, 'boolean', `${key}.inspected must be a boolean`);
    assert.equal(typeof result.schedulers[key].matches, 'number', `${key}.matches must be a number`);
  }
});

test('detectAutomations: pm2 dump present and mentioning an AI CLI -> inspected true, matches > 0', () => {
  write(tmpHome, '.pm2/dump.pm2', JSON.stringify([{ name: 'ai-worker', script: 'claude', args: '-p "run"' }]));
  const result = detectAutomations(tmpProject);
  assert.equal(result.schedulers.pm2.inspected, true);
  assert.ok(result.schedulers.pm2.matches > 0);
});

test('detectAutomations: pm2 dump absent -> not inspectable, not invented', () => {
  const result = detectAutomations(tmpProject);
  assert.equal(result.schedulers.pm2.inspected, false);
  assert.equal(result.schedulers.pm2.matches, 0);
});

test('detectAutomations: launchd agents present and mentioning an AI CLI -> inspected true, matches > 0', () => {
  write(tmpHome, 'Library/LaunchAgents/com.example.ai-job.plist', '<plist><string>claude</string></plist>');
  const result = detectAutomations(tmpProject);
  assert.equal(result.schedulers.launchd.inspected, true);
  assert.ok(result.schedulers.launchd.matches > 0);
});

test('detectAutomations: systemd user services present and mentioning an AI CLI -> inspected true, matches > 0', () => {
  write(tmpHome, '.config/systemd/user/ai-job.service', '[Service]\nExecStart=/usr/bin/claude -p "run"\n');
  const result = detectAutomations(tmpProject);
  assert.equal(result.schedulers.systemd.inspected, true);
  assert.ok(result.schedulers.systemd.matches > 0);
});
