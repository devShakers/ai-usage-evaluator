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

// Regression coverage (talents-ai-score): a coordinator-relayed user report
// claimed the consent-to-persist + email prompt had disappeared after the
// 020-022 "report first" reorder. Manual verification against this exact
// branch found the prompt still fires correctly (see the two tests above,
// plus this one) — but there was no end-to-end test for the ACCEPT path
// (only the decline path was covered), which is the gap this closes: full
// "y" -> email -> granted, asserted at the real CLI process boundary.
test('bin/report.js: accepting persistence and providing a valid email records a GRANTED decision with that email (full accept+email path)', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'y\ntalent@example.com\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /AI FOOTPRINT/); // report still always shown first
  assert.match(stdout, /Enter your email:|Introduce tu correo:/); // email prompt actually fired
  assert.match(stdout, /talent@example\.com/); // the confirmation echoes the email back

  const consentPath = path.join(tmpConfigDir, 'consent.json');
  const state = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
  assert.equal(state.consent, 'granted');
  assert.equal(state.email, 'talent@example.com');
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

// --- DX: visible reason when the consent prompt is skipped (talents-ai-score) ---

test('bin/report.js: a second run prints WHY the prompt was skipped (decision already persisted), naming the consent file and management flags', async () => {
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
  assert.match(second.stdout, /consent\.json/);
  assert.match(second.stdout, /--consent-status/);
  assert.match(second.stdout, /--consent-revoke/);
});

test('bin/report.js: --no-save has NO effect on whether the consent prompt is asked (confirmed, not a skip condition)', async () => {
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.match(stdout, /Save this report in Shakers\?|Guardar este informe en Shakers\?/);
});

test('bin/report.js: non-interactive stdin (piped, as every test here already is) still gets a warning note, but the prompt is still attempted (a piped answer keeps working)', async () => {
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.match(stdout, /non-TTY|no-TTY|no TTY/);
  // the prompt still fires and the piped "n" still answers it (not skipped):
  assert.match(stdout, /Save this report in Shakers\?|Guardar este informe en Shakers\?/);
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

// --- terminal parity + progress feedback (talents-ai-score) -----------------

test('bin/report.js: the plain-text terminal report includes technologies, agents and the tier roadmap (parity with the HTML report)', async () => {
  fs.writeFileSync(
    path.join(tmpProjectDir, 'package.json'),
    JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0', react: '^18.0.0' } }),
  );
  fs.mkdirSync(path.join(tmpProjectDir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpProjectDir, '.claude', 'agents', 'backend.md'),
    '---\nname: backend-dev\ntools: [Read, Write]\nmodel: sonnet\n---\nbody',
  );

  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  // Recognized canonical framework names (issue: tech-detector refinement),
  // never a raw dependency dump.
  assert.match(stdout, /React/);
  assert.match(stdout, /NestJS/);
  // Agents section (structural org chart, always available even without a
  // reachable synthesis endpoint).
  assert.match(stdout, /backend-dev/);
  // Some next-step framing is always shown, either the tier roadmap or the
  // generic band fallback.
  assert.match(stdout, /Tu próximo nivel|Your next level|Next step|Siguiente paso/);
});

test('bin/report.js: progress feedback (scanning/synthesis status) never leaks into --json\'s stdout, which stays pure, parseable JSON', async () => {
  const { code, stdout } = await runCli({
    args: ['--json', '--root', tmpProjectDir],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.doesNotThrow(() => JSON.parse(stdout));
  assert.equal(stdout.includes('Escaneando'), false);
  assert.equal(stdout.includes('Scanning'), false);
  assert.equal(stdout.includes('Sintetizando'), false);
  assert.equal(stdout.includes('Synthesizing'), false);
});

test('bin/report.js: the scan/detectors status always appears on stderr (non-TTY -> a single plain line, no ANSI)', async () => {
  const { code, stderr } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stderr, /Escaneando entorno y detectores|Scanning environment and detectors/);
  // eslint-disable-next-line no-control-regex
  assert.equal(/\x1b\[/.test(stderr), false); // non-TTY child process -> no ANSI/spinner frames
});

test('bin/report.js: the synthesis status is skipped on stderr when no synthesis endpoint is configured (nothing is actually attempted)', async () => {
  const { stderr } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir }, // AI_FOOTPRINT_SYNTHESIS_ENDPOINT is '' (see runCli)
  });
  assert.equal(stderr.includes('Sintetizando'), false);
  assert.equal(stderr.includes('Synthesizing'), false);
});

test('bin/report.js: the synthesis status appears on stderr when there ARE agents and a synthesis endpoint IS configured, even if unreachable', async () => {
  fs.mkdirSync(path.join(tmpProjectDir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpProjectDir, '.claude', 'agents', 'backend.md'),
    '---\nname: backend-dev\ntools: [Read]\nmodel: sonnet\n---\nbody',
  );
  const { code, stderr } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: {
      AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
      AI_FOOTPRINT_SYNTHESIS_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/agent-synthesis',
    },
  });
  assert.equal(code, 0);
  assert.match(stderr, /Sintetizando agentes con IA|Synthesizing agents with AI/);
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
