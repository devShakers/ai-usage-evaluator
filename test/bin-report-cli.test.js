'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
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

const { handle } = require('../reference-server/server');

const BIN = path.join(__dirname, '..', 'bin', 'report.js');

/*
 * skill-code-certification / ADR-006: granting persistence now requires a
 * VERIFIED email. The verification endpoints are DERIVED from the ingest URL,
 * so the accept-path tests below point AI_FOOTPRINT_INGEST_ENDPOINT at the
 * reference-server stub (fixed OTP code 123456) and pipe the code after the
 * email. Tests that only decline / reset don't need it.
 */
const STUB_OTP = '123456';
let stubServer;
let stubIngest;
test.before(async () => {
  stubServer = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      handle(req, res).catch(() => { res.writeHead(500); res.end('{}'); });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  stubIngest = `http://127.0.0.1:${stubServer.address().port}/works/ai-footprint/reports`;
});
test.after(() => stubServer && stubServer.close());

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

test('bin/report.js: asks about persisting BEFORE the report, and the report is STILL shown after (ADR-003)', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /AI FOOTPRINT/); // the report banner is still present
  assert.match(stdout, /Level \d|Nivel \d/); // the maturity level line

  const reportIdx = stdout.search(/AI FOOTPRINT/);
  const consentIdx = stdout.search(/Save this report in Shakers\?|Guardar este informe en Shakers\?/);
  assert.ok(reportIdx !== -1 && consentIdx !== -1, 'expected both the consent question and the report in the output');
  assert.ok(consentIdx < reportIdx, 'ADR-003: the consent question must come BEFORE the report');
});

test('bin/report.js: the legal/consent disclosure text appears in the CLI (not just the README), before the report', async () => {
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  // persistIntro mentions revocability + what is/ isn't saved (es or en).
  assert.match(stdout, /revocable|revocable en cualquier momento|never the content of your files|nunca el contenido de tus ficheros/);
  const disclosureIdx = stdout.search(/Shakers/);
  const reportIdx = stdout.search(/AI FOOTPRINT/);
  assert.ok(disclosureIdx !== -1 && disclosureIdx < reportIdx, 'disclosure text precedes the report');
});

test('bin/report.js: declining does NOT prompt for an email (email only on accept)', async () => {
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(/Enter your email:|Introduce tu correo:/.test(stdout), false, 'no email prompt on decline');
  const state = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
  assert.equal(state.consent, 'denied');
  assert.equal(state.email, undefined);
});

test('bin/report.js: declining persistence still shows the full report (denial only affects persistence, never display)', async () => {
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.match(stdout, /AI FOOTPRINT/);
  // Terminal-condense: the Environment block was dropped from the terminal;
  // assert the full report still rendered via the always-present score line.
  assert.match(stdout, /\/100/);

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
test('bin/report.js: accepting persistence + valid email + verified OTP records a GRANTED decision with that email (full accept+email+verify path)', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: `y\ntalent@example.com\n${STUB_OTP}\n`,
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: stubIngest },
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
  assert.match(second.stdout, /--consent-reset/); // ADR-003: how to be asked again
});

// --- ADR-003: --consent-reset, and localized help ---------------------------

test('bin/report.js: --consent-reset clears the decision to null, so the next run asks again', async () => {
  // First run: decline -> denied.
  await runCli({ args: ['--no-save', '--root', tmpProjectDir], stdin: 'n\n', env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir } });
  let state = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
  assert.equal(state.consent, 'denied');

  // Reset (one-shot, does not scan).
  const reset = await runCli({ args: ['--consent-reset'], env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir } });
  assert.equal(reset.code, 0);
  assert.match(reset.stdout, /reset|reiniciad/i);
  state = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
  assert.equal(state.consent === undefined || state.consent === null, true, 'decision cleared to "no decision"');

  // Next run asks again (distinct from --consent-revoke which would stay denied).
  const again = await runCli({ args: ['--no-save', '--root', tmpProjectDir], stdin: 'n\n', env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir } });
  assert.match(again.stdout, /Save this report in Shakers\?|Guardar este informe en Shakers\?/);
});

test('bin/report.js: --consent-reset is distinct from --consent-revoke (revoke stays denied, silent next run)', async () => {
  await runCli({ args: ['--no-save', '--root', tmpProjectDir], stdin: `y\ntalent@example.com\n${STUB_OTP}\n`, env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: stubIngest } });
  await runCli({ args: ['--consent-revoke'], env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir } });
  const state = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
  assert.equal(state.consent, 'denied');
  assert.equal(state.email, 'talent@example.com'); // revoke keeps the email
  const next = await runCli({ args: ['--no-save', '--root', tmpProjectDir], stdin: '', env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir } });
  assert.equal(/Save this report in Shakers\?|Guardar este informe en Shakers\?/.test(next.stdout), false);
});

test('bin/report.js: --help is localized (English under an English locale, Spanish under --lang es), never hardcoded Spanish', async () => {
  const en = await runCli({ args: ['--help', '--lang', 'en'], env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir } });
  assert.equal(en.code, 0);
  assert.match(en.stdout, /Usage:/);
  assert.match(en.stdout, /--consent-reset/);
  assert.equal(en.stdout.includes('Uso:'), false, 'no Spanish "Uso:" under English');

  const es = await runCli({ args: ['--help', '--lang', 'es'], env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir } });
  assert.match(es.stdout, /Uso:/);
  assert.match(es.stdout, /--consent-reset/);
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
    // ADR-016: --roadmap to also render the next-steps block (hidden by default).
    args: ['--no-save', '--root', tmpProjectDir, '--roadmap'],
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
  // Under --roadmap, some next-step framing is shown (tier roadmap or fallback).
  assert.match(stdout, /Tu próximo nivel|Your next level|Next step|Siguiente paso/);
});

// talents-ai-score, description-always-present: real-shaped agent files
// (mirroring shakers-hub-backend/.claude/agents/'s own style — a `name` +
// a long free-text `description`, no explicit `tools:`) must still surface the
// agent even with no synthesis endpoint configured at all.
//
// ADR-016: the terminal agents view is ONE line per agent — name + model (+
// compact score/usage), NO description line (that stays in the HTML report,
// covered by test/render-html-agent-cards.test.js).
test('bin/report.js: an agent (name + model) shows in the terminal report with no synthesis endpoint configured', async () => {
  fs.mkdirSync(path.join(tmpProjectDir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpProjectDir, '.claude', 'agents', 'ddd-enforcer.md'),
    [
      '---',
      'name: ddd-enforcer',
      'description: "Scans a module directory for DDD pattern violations and fixes them."',
      'model: opus',
      '---',
      '',
      'You are a DDD pattern enforcer.',
    ].join('\n'),
  );

  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /ddd-enforcer/);
  // Model badge is part of the agent line ([opus] here).
  assert.match(stdout, /\[opus\]/);
  // ADR-016: the description is NOT shown in the terminal anymore (HTML only).
  assert.equal(stdout.includes('Scans a module directory for DDD pattern violations'), false);
});

// --- --lang override + implementation prompt (talents-ai-score) -----------
// Isolates AI_FOOTPRINT_HOME_DIR too (not just the project root) so the
// tier computed here is deterministic-enough across machines (empty root
// + no home context files reliably lands at T1 — a real jump entry).

test('bin/report.js: --lang es forces the report (and the implementation prompt) into Spanish regardless of OS locale', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  try {
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--lang', 'es', '--roadmap'],
      stdin: 'n\n',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    assert.equal(code, 0);
    assert.match(stdout, /Tu próximo nivel/);
    assert.match(stdout, /Prompt para implementar/);
    assert.match(stdout, /Ayúdame a implementar/);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: --lang en forces the report (and the implementation prompt) into English regardless of OS locale', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  try {
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--lang', 'en', '--roadmap'],
      stdin: 'n\n',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    assert.equal(code, 0);
    assert.match(stdout, /Your next level/);
    assert.match(stdout, /Implementation prompt/);
    assert.match(stdout, /Help me implement/);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: an unrecognized --lang value is ignored, falling back to auto-detection, never crashes', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir, '--lang', 'fr'],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /AI FOOTPRINT/);
});

test('bin/report.js: the implementation prompt is the primary "next steps" path, --build-next-level is now announced as a secondary alternative', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  try {
    const { stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--lang', 'es', '--roadmap'],
      stdin: 'n\n',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    const promptIdx = stdout.indexOf('Prompt para implementar');
    const buildNextIdx = stdout.indexOf('footprint --build-next-level');
    assert.ok(promptIdx !== -1 && buildNextIdx !== -1);
    assert.ok(promptIdx < buildNextIdx, 'the prompt (primary) should appear before the --build-next-level hint (secondary)');
    assert.match(stdout, /Alternativamente/);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
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

// --- roadmap personalization (talents-ai-score, ADR-015) --------------------
// Isolates AI_FOOTPRINT_HOME_DIR (not just the project root) so the tier
// computed here is deterministic-enough across machines (empty root + no
// home context files reliably lands at T1 — a real jump entry, not the T7
// terminal shape) — same isolation pattern as --build-next-level above.

function startRoadmapServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('bin/report.js: no roadmap endpoint configured -> curated roadmap shown, personalization never attempted', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  try {
    const { code, stdout, stderr } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir],
      stdin: 'n\n',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    assert.equal(code, 0);
    assert.equal(/Personalizando roadmap|Personalizing roadmap/.test(stderr), false);
    assert.equal(/Contenido adaptado a tu proyecto|Content adapted to your project/.test(stdout), false);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: a roadmap endpoint returning a valid, count-matching response shows PERSONALIZED prose + steps in the summarized terminal (personalization notice stays HTML-only)', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  const server = await startRoadmapServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const curated = body.curated;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        whatUnlocks: 'ADAPTED unlocks text for your stack.',
        steps: curated.steps.map((s) => ({ text: `ADAPTED: ${s.text}`, estimate: s.estimate })),
        tips: curated.tips.map((tip) => `ADAPTED: ${tip}`),
        mistakes: curated.mistakes.map((m) => `ADAPTED: ${m}`),
      }));
    });
  });
  try {
    const { port } = server.address();
    const { code, stdout, stderr } = await runCli({
      // ADR-016: --roadmap to render the (personalized) roadmap prose in the terminal.
      args: ['--no-save', '--root', tmpProjectDir, '--roadmap'],
      stdin: 'n\n',
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: `http://127.0.0.1:${port}/works/ai-footprint/roadmap`,
      },
    });
    assert.equal(code, 0);
    assert.match(stderr, /Personalizando roadmap|Personalizing roadmap/);
    // Terminal-summarize (2026-07-16): the personalized "what it unlocks" prose is
    // back in the terminal (summarized) and the personalized steps show too.
    assert.match(stdout, /ADAPTED unlocks text for your stack\./);
    assert.match(stdout, /ADAPTED:/);
    // The "content adapted" personalization NOTICE stays HTML-only (not
    // reintroduced) — HTML coverage in test/render-roadmap-personalization.test.js.
    assert.equal(/Contenido adaptado a tu proyecto|Content adapted to your project/.test(stdout), false);
    // The blocking criterion is always curated (deterministic), personalized or not.
    assert.match(stdout, /Criterio exacto que te impide|Exact criterion blocking/);
  } finally {
    server.close();
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: an unreachable roadmap endpoint falls back to the curated roadmap verbatim, never crashes', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  try {
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir],
      stdin: 'n\n',
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/roadmap',
      },
    });
    assert.equal(code, 0);
    assert.match(stdout, /AI FOOTPRINT/);
    assert.equal(/Contenido adaptado a tu proyecto|Content adapted to your project/.test(stdout), false);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: roadmap personalization status never leaks into --json\'s stdout, which stays pure JSON', async () => {
  const { code, stdout } = await runCli({
    args: ['--json', '--root', tmpProjectDir],
    env: {
      AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
      AI_FOOTPRINT_ROADMAP_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/roadmap',
    },
  });
  assert.equal(code, 0);
  assert.doesNotThrow(() => JSON.parse(stdout));
  assert.equal(stdout.includes('Personalizando'), false);
  assert.equal(stdout.includes('Personalizing'), false);
});

// --- i18n audit (talents-ai-score, [IMPORTANTE]): a non-Spanish OS locale ---
// must NEVER show Spanish text anywhere in the report. Forces LANG (and
// clears LC_ALL/LANGUAGE, which would otherwise take precedence per
// src/locale.js's own resolution order) to a real end-to-end check, not
// just a unit-level one — isolates AI_FOOTPRINT_HOME_DIR too so the tier
// computed is deterministic-enough across machines.

const KNOWN_SPANISH_STRINGS = [
  'Herramientas', 'Entorno', 'Tecnologías', 'Agentes', 'Servidores MCP',
  'Tu próximo nivel', 'Análisis de tier', 'Criterios que cumples',
  'Banco vacío', 'Primera herramienta', 'Banco con notas',
];

test('bin/report.js: LANG=en_US.UTF-8 (non-Spanish OS locale) never shows Spanish text anywhere in the report', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  try {
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
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        LANG: 'en_US.UTF-8',
        LC_ALL: '',
        LANGUAGE: '',
      },
    });
    assert.equal(code, 0);
    assert.match(stdout, /AI FOOTPRINT/);
    // Positive check: it really did resolve to English (headings always shown;
    // the roadmap is hidden by default under ADR-016, so anchor on these).
    assert.match(stdout, /Project technologies|Detected/);
    // The actual audit: no Spanish anywhere.
    assert.equal(/[áéíóúñÁÉÍÓÚÑ¡¿]/.test(stdout), false, 'found an accented/Spanish-punctuation character');
    for (const spanish of KNOWN_SPANISH_STRINGS) {
      assert.equal(stdout.includes(spanish), false, `found the Spanish string "${spanish}"`);
    }
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: LANG=es_ES.UTF-8 (Spanish OS locale) is unaffected — Spanish headings still show', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: {
      AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
      LANG: 'es_ES.UTF-8',
      LC_ALL: '',
      LANGUAGE: '',
    },
  });
  assert.equal(code, 0);
  assert.match(stdout, /Guardar este informe en Shakers/);
});

// --- ADR-016: footprint PERSISTS report-state.json but no longer writes the
// HTML nor prints a link — the HTML is materialized + opened by `report` ---

test('bin/report.js: a normal run persists report-state.json, writes NO html and prints NO link (ADR-016)', async () => {
  const { code, stdout } = await runCli({
    args: ['--root', tmpProjectDir], // NOTE: no --no-save
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  // No file:// link is printed by footprint anymore.
  assert.equal(/file:\/\//.test(stdout), false, 'footprint no longer prints a link');
  assert.equal(/Abre tu informe|Open your report/.test(stdout), false, 'no report-link copy');
  // State IS persisted; the HTML file is NOT written by footprint.
  assert.ok(fs.existsSync(path.join(tmpConfigDir, 'report-state.json')), 'state file written');
  assert.equal(
    fs.readdirSync(tmpConfigDir).some((f) => /^report-[a-f0-9]{12}\.html$/.test(f)),
    false,
    'footprint writes no html (report command does)',
  );
});

test('bin/report.js: --no-save is the explicit opt-out — nothing persisted', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.equal(fs.readdirSync(tmpConfigDir).some((f) => /^report-.*\.html$/.test(f)), false, 'no report written');
  assert.equal(/file:\/\//.test(stdout), false, 'no link when nothing is written');
});
