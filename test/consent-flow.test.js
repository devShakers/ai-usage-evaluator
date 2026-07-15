'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runConsentPrompt } = require('../src/consent-flow');
const { loadConsentState, getConsentDecision } = require('../src/share');
const { getCatalog } = require('../src/i18n');

/*
 * talents-ai-score, ADR-011 (revises ADR-007 / issue 006): the disclosure
 * WALL is retired — the local report is always shown, unconditionally,
 * regardless of consent (that's asserted at the bin/report.js level, not
 * here). What's left is a SHORT, one-time consent-to-PERSIST prompt.
 * `ask` is injected (never touches real stdin), so these tests drive the
 * whole conversation deterministically.
 */

const catalogEs = getCatalog('es');

let originalConfigDir;
let tmpDir;

test.beforeEach(() => {
  originalConfigDir = process.env.AI_FOOTPRINT_CONFIG_DIR;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-test-'));
  process.env.AI_FOOTPRINT_CONFIG_DIR = tmpDir;
});

test.afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR;
  else process.env.AI_FOOTPRINT_CONFIG_DIR = originalConfigDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function scriptedAsk(answers) {
  const queue = [...answers];
  return async () => {
    if (queue.length === 0) throw new Error('scriptedAsk: ran out of answers');
    return queue.shift();
  };
}

// skill-code-certification / ADR-006: granting now requires a VERIFIED email.
// `verifyEmail` is injected in these tests so they never touch the network;
// `passVerify` simulates a successful OTP verification, `failVerify` a
// cancelled/failed one. The full wait-mode loop is covered in
// test/email-verification.test.js.
const passVerify = async () => ({ verified: true });
const failVerify = async () => ({ verified: false, reason: 'cancelled' });

test('runConsentPrompt: accept -> asks for email -> verifies -> persists granted + email', async () => {
  const ask = scriptedAsk(['s', 'talent@example.com']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: passVerify });
  assert.equal(decision, 'granted');
  const state = loadConsentState();
  assert.equal(getConsentDecision(state), 'granted');
  assert.equal(state.email, 'talent@example.com');
});

// --- ADR-006: email verification gates PERSISTENCE only ---

test('runConsentPrompt: accept + valid email but verification NOT passed -> nothing persisted, decision null (asked again next run)', async () => {
  const ask = scriptedAsk(['s', 'talent@example.com']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: failVerify });
  assert.equal(decision, null);
  // Nothing persisted: no granted decision, no email saved.
  assert.equal(loadConsentState(), null);
});

test('runConsentPrompt: verification is only reached AFTER a valid email is captured (never on decline)', async () => {
  let verifyCalled = false;
  const spyVerify = async () => { verifyCalled = true; return { verified: true }; };
  const ask = scriptedAsk(['n']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: spyVerify });
  assert.equal(decision, 'denied');
  assert.equal(verifyCalled, false, 'declining must not trigger email verification');
});

test('runConsentPrompt: verification receives the captured (validated) email', async () => {
  let seenEmail = null;
  const spyVerify = async ({ email }) => { seenEmail = email; return { verified: true }; };
  const ask = scriptedAsk(['s', 'talent@example.com']);
  await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: spyVerify });
  assert.equal(seenEmail, 'talent@example.com');
});

test('runConsentPrompt: decline -> persists denied, never asks for an email', async () => {
  let emailAsked = false;
  const ask = async (q) => {
    if (q === catalogEs.consent.emailPrompt) emailAsked = true;
    return 'n';
  };
  const decision = await runConsentPrompt({ ask, catalog: catalogEs });
  assert.equal(decision, 'denied');
  assert.equal(emailAsked, false);
  assert.equal(getConsentDecision(loadConsentState()), 'denied');
});

test('runConsentPrompt: malformed email re-prompts without persisting anything until a valid one arrives', async () => {
  const ask = scriptedAsk(['s', 'not-an-email', 'still-bad', 'talent@example.com']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: passVerify });
  assert.equal(decision, 'granted');
  assert.equal(loadConsentState().email, 'talent@example.com');
});

test('runConsentPrompt: gives up after too many malformed emails WITHOUT persisting a decision (prompt runs again next time)', async () => {
  const ask = scriptedAsk(['s', 'bad1', 'bad2', 'bad3', 'bad4', 'bad5']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs });
  assert.equal(decision, null);
  assert.equal(loadConsentState(), null);
});

test('runConsentPrompt: gives up after too many unrecognized yes/no answers WITHOUT persisting anything', async () => {
  const ask = scriptedAsk(['maybe', 'dunno', 'x', 'y?', '???']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs });
  assert.equal(decision, null);
  assert.equal(loadConsentState(), null);
});

test('runConsentPrompt: accepts common yes/no variants in both languages', async () => {
  for (const yes of ['y', 'yes', 's', 'si', 'sí', 'S', 'YES']) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const ask = scriptedAsk([yes, 'talent@example.com']);
    const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: passVerify });
    assert.equal(decision, 'granted', `expected "${yes}" to be accepted as yes`);
  }
  for (const no of ['n', 'no', 'N', 'NO']) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const ask = scriptedAsk([no]);
    const decision = await runConsentPrompt({ ask, catalog: catalogEs });
    assert.equal(decision, 'denied', `expected "${no}" to be rejected as no`);
  }
});

// talents-ai-score, ADR-011: no more itemized "sends/never sends" disclosure
// wall — that content lives in the README now. The prompt is short: an
// intro line + the persist question, nothing else, in both languages.
test('runConsentPrompt: shows the short persist-intro + question, no itemized disclosure wall — es', async () => {
  let firstQuestion = null;
  const ask = async (q) => {
    if (firstQuestion === null) firstQuestion = q;
    return 'n';
  };
  await runConsentPrompt({ ask, catalog: catalogEs });
  assert.equal(firstQuestion, catalogEs.consent.persistQuestion);
  assert.match(catalogEs.consent.persistIntro, /opcional/i);
  assert.match(catalogEs.consent.persistIntro, /revocable/i);
  assert.equal('sendsList' in catalogEs.consent, false);
  assert.equal('disclosureTitle' in catalogEs.consent, false);
});

test('runConsentPrompt: shows the short persist-intro + question, no itemized disclosure wall — en', async () => {
  const catalogEn = getCatalog('en');
  let firstQuestion = null;
  const ask = async (q) => {
    if (firstQuestion === null) firstQuestion = q;
    return 'n';
  };
  await runConsentPrompt({ ask, catalog: catalogEn });
  assert.equal(firstQuestion, catalogEn.consent.persistQuestion);
  assert.match(catalogEn.consent.persistIntro, /optional/i);
  assert.match(catalogEn.consent.persistIntro, /revocable/i);
  assert.equal('sendsList' in catalogEn.consent, false);
});

// --- issue 022: consent text reflects the level-up framework's expanded scope ---
// (tier/band + the new detector signals), still short (no wall), and
// explicit that only DERIVED signals are saved, never raw content — model
// ADR-011 unchanged (show always / persist only with consent).

test('persistIntro (es): mentions the expanded scope (tier/level + structured signals) and explicitly never raw content', () => {
  const text = catalogEs.consent.persistIntro;
  assert.match(text, /nivel|tier/i);
  assert.match(text, /señales (estructuradas|derivadas)/i);
  assert.match(text, /nunca.*(contenido|ficheros|prompts)/i);
  // Still short: not an itemized wall (issue 022: "sin muralla ni flags").
  assert.ok(text.length < 700, `expected a short intro, got ${text.length} chars`);
});

test('persistIntro (en): mentions the expanded scope (tier/level + structured signals) and explicitly never raw content', () => {
  const catalogEn = getCatalog('en');
  const text = catalogEn.consent.persistIntro;
  assert.match(text, /level|tier/i);
  assert.match(text, /structured signals/i);
  assert.match(text, /never.*(content|files|prompts)/i);
  assert.ok(text.length < 700, `expected a short intro, got ${text.length} chars`);
});

test('persistIntro: still opt-in/optional and revocable in both languages (ADR-011 model unchanged)', () => {
  assert.match(catalogEs.consent.persistIntro, /opcional/i);
  assert.match(catalogEs.consent.persistIntro, /revocable/i);
  const catalogEn = getCatalog('en');
  assert.match(catalogEn.consent.persistIntro, /optional/i);
  assert.match(catalogEn.consent.persistIntro, /revocable/i);
});
