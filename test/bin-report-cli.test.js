'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

// talents-ai-score, ADR-011: end-to-end CLI behavior — the local report is ALWAYS shown, unconditionally, regardless of the consent decision.

const { handle } = require('../test-fixtures/ingest-service-fake');
const { saveAuthSession } = require('../src/auth-session-store');

const BIN = path.join(__dirname, '..', 'bin', 'ai-usage.js');

function fakeHubToken(userType) {
  const seg = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${seg({ alg: 'none' })}.${seg({ userType })}.sig`;
}

// skill-code-certification / ADR-006: granting persistence now requires a VERIFIED email.
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
  // talents-ai-score, ADR-020/021: the stub mirrors the certifications
  // service's PRIMARY contract (no `works/` prefix — see test-fixtures/ingest-service-fake.js).
  stubIngest = `http://127.0.0.1:${stubServer.address().port}/ai-footprint/reports`;
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

test('bin/report.js: asks about consent BEFORE any AI call/report — accepting lets the report follow, in that order (ADR-051)', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: `y\ntalent@example.com\n${STUB_OTP}\n`,
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: stubIngest },
  });
  assert.equal(code, 0);
  assert.match(stdout, /SHAKERS/); // the report banner shows — consent was granted
  assert.match(stdout, /Setup · |Setup Level/); // ADR-016: the Setup Level line (replaces the 0-4 maturity level)

  const reportIdx = stdout.search(/SHAKERS/);
  const consentIdx = stdout.search(/Save this report in Shakers\?|Guardar este informe en Shakers\?/);
  assert.ok(reportIdx !== -1 && consentIdx !== -1, 'expected both the consent question and the report in the output');
  assert.ok(consentIdx < reportIdx, 'ADR-051: the consent question must come BEFORE the report (and before any AI call)');
});

test('bin/report.js: declining -> the local report STILL shows, NO AI call fires, and the legal/consent disclosure text is what the Talent actually sees (ADR-011 + ADR-051)', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  // persistIntro mentions revocability + what is/ isn't saved (es or en) — still
  // shown, informing the decline, before the (still-rendered) report.
  assert.match(stdout, /revocable|revocable en cualquier momento|never the content of your files|nunca el contenido de tus ficheros/);
  // ADR-011, restored: declining AI/egress consent never blocks the local
  // report — only the AI-enriched sections are omitted (reverts 8867450).
  assert.match(stdout, /SHAKERS/, 'ADR-011: the local report is shown even after declining');
  assert.match(stdout, /will not include AI-generated|no incluirá síntesis/);
  const state = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
  assert.equal(state.consent, 'denied');
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

test('framework block: a logged-in WORKS_TALENT sees the AI-fluency framework intro, printed before the report', async () => {
  saveAuthSession(
    { accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString(), hubAccessToken: fakeHubToken('WORKS_TALENT') },
    { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  );
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir, '--lang', 'en'],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /Setup \(your tooling's maturity, T0–T7, deterministic\)/);
  const introIdx = stdout.indexOf('Setup (your');
  const reportIdx = stdout.search(/SHAKERS/);
  assert.ok(introIdx !== -1 && reportIdx !== -1 && introIdx < reportIdx, 'the block must print BEFORE the report');
});

test('framework block: a logged-in WORKS_CLIENT (not a Talent) sees NO framework intro — current copy unchanged', async () => {
  saveAuthSession(
    { accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString(), hubAccessToken: fakeHubToken('WORKS_CLIENT') },
    { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  );
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir, '--lang', 'en'],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.equal(stdout.includes('Setup (your tooling'), false);
  assert.match(stdout, /SHAKERS/, 'the report itself must still render normally');
});

test('framework block: anonymous (no session at all) sees NO framework intro — the general-user path is untouched', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir, '--lang', 'en'],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.equal(stdout.includes('Setup (your tooling'), false);
  assert.match(stdout, /SHAKERS/);
});

test('bin/report.js: declining affects ONLY the AI/egress calls, never display — the report (and its score line) still renders (ADR-011, restored)', async () => {
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.match(stdout, /SHAKERS/);
  // Terminal-condense: the Environment block was dropped from the terminal, but the always-present score line (`/100`) is a positive proxy for "the report rendered at all".
  assert.match(stdout, /\/100/);

  const consentPath = path.join(tmpConfigDir, 'consent.json');
  const state = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
  assert.equal(state.consent, 'denied');
});

// Regression coverage (talents-ai-score): a coordinator-relayed user report claimed the consent-to-persist + email prompt had disappeared after the 020-022 "report first" reorder.
test('bin/report.js: accepting persistence + valid email + verified OTP records a GRANTED decision with that email (full accept+email+verify path)', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: `y\ntalent@example.com\n${STUB_OTP}\n`,
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: stubIngest },
  });
  assert.equal(code, 0);
  assert.match(stdout, /SHAKERS/); // report still always shown first
  assert.match(stdout, /Enter your email:|Introduce tu correo:/); // email prompt actually fired
  assert.match(stdout, /talent@example\.com/); // the confirmation echoes the email back

  const consentPath = path.join(tmpConfigDir, 'consent.json');
  const state = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
  assert.equal(state.consent, 'granted');
  assert.equal(state.email, 'talent@example.com');
});

// issue 130: a Talent who ran `login` and then `usage` was wrongly asked "Enter your email:" — the identity already comes from the session.
function seedAuthSession(dir, { email = 'talent@example.com', expiresAt = '2999-01-01T00:00:00.000Z' } = {}) {
  fs.writeFileSync(
    path.join(dir, 'auth-session.json'),
    JSON.stringify({ accessToken: 'test.session.token', expiresAt, email, version: 2 }),
  );
}

function seedGrantedConsent(dir, email = 'talent@example.com') {
  fs.writeFileSync(
    path.join(dir, 'consent.json'),
    JSON.stringify({ consent: 'granted', email, emailVerified: true, lastSentAt: null }),
  );
}

test('bin/report.js: LOGGED IN + accept -> NO email prompt, granted straight from the session email (the reported bug)', async () => {
  seedAuthSession(tmpConfigDir, { email: 'talent@example.com' });
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    // Only the save y/n — no email, no OTP code.
    stdin: 'y\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /SHAKERS/); // report still shown
  assert.equal(/Enter your email:|Introduce tu correo:/.test(stdout), false, 'a logged-in Talent must never see the email prompt');

  const consentPath = path.join(tmpConfigDir, 'consent.json');
  const state = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
  assert.equal(state.consent, 'granted');
  assert.equal(state.email, 'talent@example.com');
  assert.equal(state.emailVerified, true); // session identity, no OTP needed
});

test('bin/report.js: LOGGED IN + decline -> denied, still no email prompt', async () => {
  seedAuthSession(tmpConfigDir, { email: 'talent@example.com' });
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.equal(/Enter your email:|Introduce tu correo:/.test(stdout), false);
  const state = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
  assert.equal(state.consent, 'denied');
});

test('bin/report.js: LOGGED IN via Google WITH a cached email (post-fix) + accept -> NO email prompt, granted from the session email', async () => {
  seedAuthSession(tmpConfigDir, { email: 'talent@example.com' });
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'y\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.equal(/Enter your email:|Introduce tu correo:/.test(stdout), false, 'a logged-in Talent must never see the email prompt');
  assert.equal(/no email on file|No hay un correo asociado/i.test(stdout), false, 'the degrade must not fire once the session has an email');
  const consentPath = path.join(tmpConfigDir, 'consent.json');
  const state = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
  assert.equal(state.consent, 'granted');
  assert.equal(state.email, 'talent@example.com');
  assert.equal(state.emailVerified, true);
});

// The remaining degraded case: a session with NO cached email at all.
test('bin/report.js: LOGGED IN with NO cached email (older-certs degrade) + accept -> still no email prompt, honest "no email on file" message, nothing persisted', async () => {
  seedAuthSession(tmpConfigDir, { email: null });
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'y\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.equal(/Enter your email:|Introduce tu correo:/.test(stdout), false, 'must not fall back to asking for an email');
  assert.match(stdout, /no email on file|No hay un correo asociado/i);
  assert.equal(fs.existsSync(path.join(tmpConfigDir, 'consent.json')), false, 'a non-terminal outcome persists nothing');
});

test('bin/report.js: NOT logged in -> unchanged, still asks for email + OTP (regression guard)', async () => {
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: `y\ntalent@example.com\n${STUB_OTP}\n`,
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: stubIngest },
  });
  assert.match(stdout, /Enter your email:|Introduce tu correo:/);
  const state = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
  assert.equal(state.consent, 'granted');
  assert.equal(state.email, 'talent@example.com');
});

test('bin/report.js: an EXPIRED session is painted anonymous and DOES get asked for an email (matches gate.loggedIn=false)', async () => {
  seedAuthSession(tmpConfigDir, { email: 'talent@example.com', expiresAt: '2000-01-01T00:00:00.000Z' });
  const { stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: `y\nother@example.com\n${STUB_OTP}\n`,
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: stubIngest },
  });
  assert.match(stdout, /Enter your email:|Introduce tu correo:/);
  // Painted anonymous (issue 130 does not touch this): still told the
  // session lapsed, per ADR-044 (a mute expiry is the bug issue 109 named).
  assert.match(stdout, /Your session has expired|Tu sesión ha caducado/);
});

test('bin/report.js: a second run with a DENIED decision already persisted never asks again — the report still shows every run, only AI/egress stays omitted (no wall, ADR-011)', async () => {
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
  // Never re-asked — unchanged, ADR-007/011's own point.
  assert.equal(/Save this report in Shakers\?|Guardar este informe en Shakers\?/.test(second.stdout), false);
  // A persisted `denied` never blocks the report, on the first future run or
  // any other: same shape as a live decline (reverts 8867450's wall).
  assert.match(second.stdout, /SHAKERS/, 'a persisted denied decision never blocks the local report');
  assert.match(second.stdout, /will not include AI-generated|no incluirá síntesis/);
});

test('bin/report.js: a second run with a GRANTED decision already persisted never asks again, and the report + AI calls DO run (the happy-path mirror of the test above)', async () => {
  seedGrantedConsent(tmpConfigDir);

  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: '',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.equal(/Save this report in Shakers\?|Guardar este informe en Shakers\?/.test(stdout), false, 'a terminal decision is never re-asked');
  assert.match(stdout, /SHAKERS/, 'a GRANTED decision lets the report through, every run');
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

test('bin/report.js: the plain-text terminal report includes agents and the tier roadmap, never the detected technologies/skills section (agents-only report)', async () => {
  fs.writeFileSync(
    path.join(tmpProjectDir, 'package.json'),
    JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0', react: '^18.0.0' } }),
  );
  fs.mkdirSync(path.join(tmpProjectDir, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpProjectDir, '.claude', 'agents', 'backend.md'),
    '---\nname: backend-dev\ntools: [Read, Write]\nmodel: sonnet\n---\nbody',
  );

  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: '',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.equal(stdout.includes('React'), false);
  assert.equal(stdout.includes('NestJS'), false);
  assert.equal(stdout.includes('Skills'), false);
  // Agents section (structural org chart, always available even without a
  // reachable synthesis endpoint).
  assert.match(stdout, /backend-dev/);
  // The default output points at --roadmap for the next-steps section.
  assert.match(stdout, /usage --roadmap/);
});

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

  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: '',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /ddd-enforcer/);
  // The AI PRODUCT (derived from the .claude/agents source) is the badge now,
  // NOT the LLM model — so [Claude Code], never [opus].
  assert.match(stdout, /\[Claude Code\]/);
  assert.equal(stdout.includes('[opus]'), false);
  // ADR-016 (2026-07-18): a SUMMARIZED description shows under the agent
  // (dim line, truncated ~90 chars). The fixture's description starts with this.
  assert.match(stdout, /Scans a module directory for DDD pattern violations/);
});

test('bin/report.js: --lang es forces the report (and the implementation prompt) into Spanish regardless of OS locale', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  try {
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--lang', 'es', '--roadmap'],
      stdin: '',
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
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  try {
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--lang', 'en', '--roadmap'],
      stdin: '',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    assert.equal(code, 0);
    assert.match(stdout, /Your next AI-usage level/);
    assert.match(stdout, /Implementation prompt/);
    assert.match(stdout, /Help me implement/);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: an unrecognized --lang value is ignored, falling back to auto-detection, never crashes', async () => {
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir, '--lang', 'fr'],
    stdin: '',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /SHAKERS/);
});

test('bin/report.js: the implementation prompt is the primary "next steps" path, --build-next-level is now announced as a secondary alternative', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  try {
    const { stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--lang', 'es', '--roadmap'],
      stdin: '',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    const promptIdx = stdout.indexOf('Prompt para implementar');
    const buildNextIdx = stdout.indexOf('usage --build-next-level');
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
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  const { code, stderr } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: '',
    env: {
      AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
      AI_FOOTPRINT_SYNTHESIS_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/agent-synthesis',
    },
  });
  assert.equal(code, 0);
  assert.match(stderr, /Sintetizando agentes con IA|Synthesizing agents with AI/);
});

test('bin/report.js: --build-next-level runs without crashing and never overwrites what it just created on a second run', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  try {
    const first = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--build-next-level'],
      stdin: '',
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_HOME_DIR: tmpHomeDir },
    });
    assert.equal(first.code, 0);
    assert.match(first.stdout, /SHAKERS/); // report still shown — consent already granted

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
    // Issue 109: and NEITHER does the "this is the generic one" notice.
    assert.equal(/no se ha podido adaptar|could not be adapted/.test(stdout), false);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: a roadmap endpoint returning a valid, count-matching response shows PERSONALIZED prose + steps in the summarized terminal, and SAYS it is adapted', async () => {
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
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  try {
    const { port } = server.address();
    const { code, stdout, stderr } = await runCli({
      // ADR-016: --roadmap to render the (personalized) roadmap prose in the terminal.
      args: ['--no-save', '--root', tmpProjectDir, '--roadmap'],
      stdin: '',
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
    // REVERSED DELIBERATELY (issue 109).
    assert.match(stdout, /Contenido adaptado a tu proyecto|Content adapted to your project/);
    // And never both at once.
    assert.equal(/no se ha podido adaptar|could not be adapted/.test(stdout), false);
    // ADR-016: --roadmap prints ONLY the roadmap — the tier-analysis blocking
    // criterion is part of the DEFAULT report, not this output, so it's absent here.
    assert.equal(/Criterio exacto que te impide|Exact criterion blocking/.test(stdout), false);
  } finally {
    server.close();
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: an unreachable roadmap endpoint falls back to the curated roadmap verbatim, never crashes', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  try {
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir],
      stdin: '',
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/roadmap',
      },
    });
    assert.equal(code, 0);
    assert.match(stdout, /SHAKERS/);
    assert.equal(/Contenido adaptado a tu proyecto|Content adapted to your project/.test(stdout), false);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

// Issue 109, end to end through the real CLI: a roadmap personalization that was ATTEMPTED and failed now says so, and the attempt is written down.
test('bin/report.js: an unreachable roadmap endpoint TELLS the talent the roadmap is the generic one', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  try {
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--roadmap'],
      stdin: '',
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/roadmap',
      },
    });
    assert.equal(code, 0);
    assert.match(stdout, /no se ha podido adaptar|could not be adapted/);
    // What was LOST, not what went wrong: no transport jargon reaches the talent.
    assert.equal(/network-error|timeout|ECONNREFUSED|http-error/.test(stdout), false);
    assert.equal(/Contenido adaptado a tu proyecto|Content adapted to your project/.test(stdout), false);
  } finally {
    fs.rmSync(tmpHomeDir, { recursive: true, force: true });
  }
});

test('bin/report.js: --json carries the model-call record, so a failure is debuggable without the server', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  // ADR-051: --json only attempts the AI calls when a decision is ALREADY
  // persisted as granted+verified (it never gained an interactive prompt).
  seedGrantedConsent(tmpConfigDir);
  try {
    const { code, stdout } = await runCli({
      args: ['--json', '--root', tmpProjectDir],
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        AI_FOOTPRINT_ROADMAP_ENDPOINT: 'http://127.0.0.1:1/works/ai-footprint/roadmap',
      },
    });
    assert.equal(code, 0);
    const { report } = JSON.parse(stdout);
    const rec = report.modelCalls.roadmapPersonalization;
    // The four fields the issue asked for, on a REAL run: this is what did not
    // exist before — `grep attemptedAt` over the whole repo returned nothing.
    assert.equal(rec.ok, false);
    assert.equal(rec.reason, 'network-error');
    assert.equal(typeof rec.attemptedAt, 'string');
    assert.equal(typeof rec.timeoutMs, 'number', 'how long the talent waited is part of the record');
    // No endpoint URL is ever kept in the record — configuration is not evidence.
    assert.equal(JSON.stringify(rec).includes('127.0.0.1'), false);
    // The scanned fixture project has no agents, so the other two calls are
    // SKIPS, not failures — the distinction this issue exists for, on real data.
    assert.equal(report.modelCalls.agentSynthesis.ok, null);
    assert.equal(report.modelCalls.agentSynthesis.reason, 'no-agents');
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

// i18n audit (talents-ai-score, [IMPORTANTE]): a non-Spanish OS locale must NEVER show Spanish text anywhere in the report.

const KNOWN_SPANISH_STRINGS = [
  'Herramientas', 'Entorno', 'Tecnologías', 'Agentes', 'Servidores MCP',
  'Tu próximo nivel', 'Análisis de tier', 'Criterios que cumples',
  'Banco vacío', 'Primera herramienta', 'Banco con notas',
];

test('bin/report.js: LANG=en_US.UTF-8 (non-Spanish OS locale) never shows Spanish text anywhere in the report', async () => {
  const tmpHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-cli-home-'));
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
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
      stdin: '',
      env: {
        AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
        AI_FOOTPRINT_HOME_DIR: tmpHomeDir,
        SHAKERS_CLI_LANG: 'en', // pin English deterministically, independent of the runner's OS display language
        LANG: 'en_US.UTF-8',
        LC_ALL: '',
        LANGUAGE: '',
      },
    });
    assert.equal(code, 0);
    assert.match(stdout, /SHAKERS/);
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

test('bin/report.js: SHAKERS_CLI_LANG=es forces Spanish UI — Spanish headings show', async () => {
  const { code, stdout } = await runCli({
    args: ['--no-save', '--root', tmpProjectDir],
    stdin: 'n\n',
    env: {
      AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir,
      SHAKERS_CLI_LANG: 'es', // explicit override; LANG alone no longer forces Spanish (region != display language)
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
  seedGrantedConsent(tmpConfigDir); // ADR-051: not what this test is about — consent already resolved
  const { code, stdout } = await runCli({
    args: ['--root', tmpProjectDir], // NOTE: no --no-save
    stdin: '',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  // No file:// link is printed by footprint anymore.
  assert.equal(/file:\/\//.test(stdout), false, 'usage no longer prints a link');
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

// --set-endpoint allowlist confirmation (three-way security review hardening): loopback/Shakers-domain hosts are still persisted with no prompt at all (today's behaviour, unchanged).

test('bin/report.js: --set-endpoint to loopback persists immediately, no confirmation prompt', async () => {
  const { code, stdout } = await runCli({
    args: ['--set-endpoint', 'http://localhost:4321/api/v1/ai-footprint/reports'],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /guardado|saved/i);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'config.json'), 'utf8')).ingestEndpoint,
    'http://localhost:4321/api/v1/ai-footprint/reports',
  );
});

test('bin/report.js: --set-endpoint to a non-allowlisted host asks for confirmation; typing the hostname back persists it', async () => {
  const { code, stdout } = await runCli({
    args: ['--set-endpoint', 'https://hub.example.com/api/v1/works/ai-footprint/reports'],
    stdin: 'hub.example.com\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.equal(code, 0);
  assert.match(stdout, /known Shakers domain|dominio conocido de Shakers/i); // the confirmation prompt itself, not just the success message
  assert.match(stdout, /hub\.example\.com/);
  assert.match(stdout, /guardado|saved/i);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'config.json'), 'utf8')).ingestEndpoint,
    'https://hub.example.com/api/v1/works/ai-footprint/reports',
  );
});

test('bin/report.js: --set-endpoint to a non-allowlisted host is CANCELLED (nothing written) on a blank/mismatched answer', async () => {
  const { code, stdout } = await runCli({
    args: ['--set-endpoint', 'https://hub.example.com/api/v1/works/ai-footprint/reports'],
    stdin: '\n', // blank answer -> mismatch -> cancel
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.notEqual(code, 0);
  assert.equal(fs.existsSync(path.join(tmpConfigDir, 'config.json')), false, 'nothing must be written when confirmation is declined');

  const wrong = await runCli({
    args: ['--set-endpoint', 'https://hub.example.com/api/v1/works/ai-footprint/reports'],
    stdin: 'not-the-right-host.com\n',
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.notEqual(wrong.code, 0);
  assert.equal(fs.existsSync(path.join(tmpConfigDir, 'config.json')), false, 'a mismatched answer must not persist either');
});

// ADR-042: the `--set-endpoint-fallback` test is DELETED with the flag.

test('bin/report.js --consent-status: profile:"external" + unverified email -> the EXTERNAL line, never "pending verification"', async () => {
  fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({ profile: 'external' }));
  fs.writeFileSync(path.join(tmpConfigDir, 'consent.json'), JSON.stringify({ consent: 'granted', email: 'lead@example.com', emailVerified: false, lastSentAt: null }));
  const { stdout } = await runCli({
    args: ['--consent-status', '--lang', 'es'],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.match(stdout, /Correo autoafirmado, sin verificar/);
  assert.equal(stdout.includes('Correo pendiente de verificar'), false);
});

test('bin/report.js: profile:"external" end-to-end -- accepts, asks the EXTERNAL email prompt, NO OTP, and the report IS sent unverified', async () => {
  let received = null;
  const localServer = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        received = JSON.parse(raw);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    fs.writeFileSync(path.join(tmpConfigDir, 'config.json'), JSON.stringify({ profile: 'external' }));
    const { code, stdout } = await runCli({
      args: ['--no-save', '--root', tmpProjectDir, '--lang', 'es'],
      stdin: 'y\nlead@example.com\n', // accept, email — NOTHING else scripted
      env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir, AI_FOOTPRINT_INGEST_ENDPOINT: `http://127.0.0.1:${localServer.address().port}/reports` },
    });
    assert.equal(code, 0);
    assert.match(stdout, /Déjanos tu email/); // the EXTERNAL prompt, not "Introduce tu correo"
    assert.equal(stdout.includes('Introduce tu correo:'), false);
    assert.match(stdout, /Guardado en Shakers/, 'the report was actually SENT, despite the unverified email');
    assert.ok(received, 'the dedicated server must have actually received the POST');
    assert.equal(received.email, 'lead@example.com');

    const state = JSON.parse(fs.readFileSync(path.join(tmpConfigDir, 'consent.json'), 'utf8'));
    assert.equal(state.consent, 'granted');
    assert.equal(state.email, 'lead@example.com');
    assert.equal(state.emailVerified, false, 'ADR-007 model: explicitly unverified, not merely omitted');
    assert.ok(state.lastSentAt, 'autoShare must have actually run and persisted lastSentAt');
  } finally {
    localServer.close();
  }
});

test('bin/report.js --consent-status: profile:"talent" (or absent) + unverified email -> the ORIGINAL "pending verification" line, unchanged', async () => {
  fs.writeFileSync(path.join(tmpConfigDir, 'consent.json'), JSON.stringify({ consent: 'granted', email: 'talent@example.com', emailVerified: false, lastSentAt: null }));
  // No config.json at all -- the real "every install before ADR-058" case.
  const { stdout } = await runCli({
    args: ['--consent-status', '--lang', 'es'],
    env: { AI_FOOTPRINT_CONFIG_DIR: tmpConfigDir },
  });
  assert.match(stdout, /Correo pendiente de verificar/);
  assert.equal(stdout.includes('Correo autoafirmado, sin verificar'), false);
});
