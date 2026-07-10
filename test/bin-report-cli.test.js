'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/*
 * talents-ai-score, ADR-011: end-to-end CLI behavior — the local report is
 * ALWAYS shown, unconditionally, regardless of the consent decision. This
 * can only be verified by actually running `bin/report.js` as a process
 * (it calls `main()` on load, so it can't be `require()`d from a test —
 * see src/cli-args.js's header comment for the same constraint).
 *
 * Every run here points AI_FOOTPRINT_CONFIG_DIR at a throwaway directory
 * and leaves AI_FOOTPRINT_INGEST_ENDPOINT / AI_FOOTPRINT_SYNTHESIS_ENDPOINT
 * unset, so nothing ever touches the network or the real developer machine.
 */

const BIN = path.join(__dirname, '..', 'bin', 'report.js');

function runCli({ args = [], stdin = '', env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: {
        ...process.env,
        AI_FOOTPRINT_INGEST_ENDPOINT: '',
        AI_FOOTPRINT_SYNTHESIS_ENDPOINT: '',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

let tmpConfigDir;
let tmpProjectDir;

test.beforeEach(() => {
  tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-config-'));
  tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-project-'));
});

test.afterEach(() => {
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  fs.rmSync(tmpProjectDir, { recursive: true, force: true });
});

test('bin/report.js: shows the local report BEFORE asking about persisting, with no decision persisted yet', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /AI FOOTPRINT/); // the report banner
  assert.match(stdout, /Level \d|Nivel \d/); // the maturity level line

  const reportIdx = stdout.search(/AI FOOTPRINT/);
  const consentIdx = stdout.search(/Save this report in Shakers\?|Guardar este informe en Shakers\?/);
  assert.ok(reportIdx !== -1 && consentIdx !== -1, 'expected both the report and the consent question in the output');
  assert.ok(reportIdx < consentIdx, 'the report must be shown BEFORE the consent-to-persist question');
});

test('bin/report.js: declining persistence still shows the full report (denial only affects persistence, never display)', async () => {
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.match(stdout, /AI FOOTPRINT/);
  assert.match(stdout, /Environment|Entorno/);

  const consentPath = path.join(tmpConfigDir, 'consent.json');
  const state = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
  assert.equal(state.consent, 'denied');
});

test('bin/report.js: a second run with a decision already persisted never asks again, still always shows the report', async () => {
  await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });

  const second = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: '',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(second.code, 0);
  assert.match(second.stdout, /AI FOOTPRINT/);
  assert.equal(/Save this report in Shakers\?|Guardar este informe en Shakers\?/.test(second.stdout), false);
});

test('bin/report.js: --json also always includes the full report regardless of consent, and never hangs on a misconfigured synthesis endpoint', async () => {
  const { code, stdout } = await runCli({
    args: ['--json', '--root', tmpProjectDir],
    env: {
      AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
      AI_FOOTPRINT_SYNTHESIS_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/agent-synthesis',
    },
  });
  assert.equal(code, 0);
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.report);
  assert.ok(Array.isArray(parsed.report.agents));
  assert.ok(Array.isArray(parsed.report.technologies));
  // Synthesis endpoint unreachable (closed port) -> falls back silently,
  // never attached, never throws, `--json` still returns cleanly.
  assert.equal(parsed.report.agentSynthesis, undefined);
});

// --- issue 021: "construir el siguiente nivel ahora" -------------------------
// Isolates AI_FOOTPRINT_HOME_DIR too (not just the project root) so the
// tier computed here never depends on the real developer machine's own
// ~/.claude/* setup — otherwise this end-to-end run would be nondeterministic.

test('bin/report.js: --build-next-level runs without crashing and never overwrites what it just created on a second run', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  try {
    const first = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--build-next-level'],
      stdin: 'n\n',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    assert.equal(first.code, 0);
    assert.match(first.stdout, /AI FOOTPRINT/); // report still always shown

    // Second run: idempotent, whatever happened the first time (a file
    // created, or "max tier"/"no file target") never breaks or throws.
    const second = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--build-next-level'],
      stdin: '',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    assert.equal(second.code, 0);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});
