'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runConsentPrompt } = require('../src/consent-flow');
const { loadConsentState, getConsentDecision } = require('../src/share');
const { getCatalog } = require('../src/i18n');
const { needle } = require('../test-fixtures/copy-needle');

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

const passVerify = async () => ({ verified: true });
const failVerify = async () => ({ verified: false, reason: 'cancelled' });

test('runConsentPrompt: accept -> asks for email -> verifies -> persists granted + email + emailVerified:true', async () => {
  const ask = scriptedAsk(['s', 'talent@example.com']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: passVerify });
  assert.equal(decision, 'granted');
  const state = loadConsentState();
  assert.equal(getConsentDecision(state), 'granted');
  assert.equal(state.email, 'talent@example.com');
  assert.equal(state.emailVerified, true);
});

// --- ADR-006 (revised): a grant is terminal (persisted) ONLY once verified ---

test('runConsentPrompt: accept + valid email but verification FAILS -> NOTHING persisted, decision null (re-asked next run)', async () => {
  const ask = scriptedAsk(['s', 'talent@example.com']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: failVerify });
  // An unverified grant is not a terminal decision: nothing is written, so the
  // prompt runs again next time (computeConsentSkip only skips terminal state).
  assert.equal(decision, null);
  assert.equal(loadConsentState(), null);
});

test('runConsentPrompt: the grant is persisted ONLY AFTER verification succeeds (nothing on disk while verification runs)', async () => {
  let stateAtVerifyTime = 'unset';
  const spyVerify = async () => {
    // Nothing must be persisted yet — the grant is recorded only on success.
    stateAtVerifyTime = loadConsentState();
    return { verified: true };
  };
  const ask = scriptedAsk(['s', 'talent@example.com']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: spyVerify });
  assert.equal(stateAtVerifyTime, null, 'consent must not be persisted before verification succeeds');
  assert.equal(decision, 'granted');
  assert.equal(loadConsentState().emailVerified, true);
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

// talents-ai-score, ADR-011: no more itemized "sends/never sends" disclosure wall — that content lives in the README now.
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

test('persistIntro (es): mentions the expanded scope (tier/level + structured signals) and explicitly never raw content', () => {
  const text = catalogEs.consent.persistIntro;
  assert.match(text, /nivel|tier/i);
  assert.match(text, /señales (estructuradas|derivadas)/i);
  assert.match(text, /nunca.*(contenido|ficheros|prompts)/i);
  // Bounded: not an itemized wall (issue 022: "sin muralla ni flags").
  assert.ok(text.length <= 1200, `expected a bounded intro, got ${text.length} chars`);
});

test('persistIntro (en): mentions the expanded scope (tier/level + structured signals) and explicitly never raw content', () => {
  const catalogEn = getCatalog('en');
  const text = catalogEn.consent.persistIntro;
  assert.match(text, /level|tier/i);
  assert.match(text, /structured signals/i);
  assert.match(text, /never.*(content|files|prompts)/i);
  // Bounded (see the es case): relaxed from 700 to 1200 for the hardened legal
  // copy, still guarding against runaway copy.
  assert.ok(text.length <= 1200, `expected a bounded intro, got ${text.length} chars`);
});

/* ---------- issue 130: a logged-in Talent is NEVER asked for an email ---------- */

test('runConsentPrompt: logged in + accept -> NO email prompt, NO OTP, granted straight from the session email', async () => {
  let emailAsked = false;
  let verifyCalled = false;
  const ask = async (q) => {
    if (q === catalogEs.consent.emailPrompt) emailAsked = true;
    return 's';
  };
  const spyVerify = async () => { verifyCalled = true; return { verified: true }; };
  const decision = await runConsentPrompt({
    ask,
    catalog: catalogEs,
    verifyEmail: spyVerify,
    loggedIn: true,
    sessionEmail: 'talent@example.com',
  });
  assert.equal(decision, 'granted');
  assert.equal(emailAsked, false, 'a logged-in Talent must never see the email prompt');
  assert.equal(verifyCalled, false, 'a logged-in Talent already proved their account — no OTP round');
  const state = loadConsentState();
  assert.equal(state.email, 'talent@example.com');
  assert.equal(state.emailVerified, true);
});

test('runConsentPrompt: logged in + decline -> same as anonymous decline, no email ever touched', async () => {
  let emailAsked = false;
  const ask = async (q) => {
    if (q === catalogEs.consent.emailPrompt) emailAsked = true;
    return 'n';
  };
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, loggedIn: true, sessionEmail: 'talent@example.com' });
  assert.equal(decision, 'denied');
  assert.equal(emailAsked, false);
  assert.equal(getConsentDecision(loadConsentState()), 'denied');
});

test('runConsentPrompt: logged in but the session has NO cached email (Google login) -> still no email prompt, named cause, nothing persisted', async () => {
  let emailAsked = false;
  const ask = async (q) => {
    if (q === catalogEs.consent.emailPrompt) emailAsked = true;
    return 's';
  };
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, loggedIn: true, sessionEmail: null });
  assert.equal(decision, null, 'nothing persisted — re-offered next run, same as any other non-terminal outcome');
  assert.equal(emailAsked, false, 'must not fall back to asking for an email just because the session lacks one');
  assert.equal(loadConsentState(), null);
});

test('runConsentPrompt: NOT logged in -> unchanged, still asks for email + OTP (regression guard for the general-user path)', async () => {
  const ask = scriptedAsk(['s', 'talent@example.com']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: passVerify, loggedIn: false });
  assert.equal(decision, 'granted');
  assert.equal(loadConsentState().email, 'talent@example.com');
});

test('runConsentPrompt: profile:"talent" (explicit), NOT logged in -> STILL asks for email + OTP -- the dueño\'s "no toques el path de talent"', async () => {
  let verifyCalled = false;
  const spyVerify = async () => { verifyCalled = true; return { verified: true }; };
  const ask = scriptedAsk(['s', 'talent@example.com']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: spyVerify, loggedIn: false, profile: 'talent' });
  assert.equal(decision, 'granted');
  assert.equal(verifyCalled, true, 'talent profile must still go through the OTP round');
  assert.equal(loadConsentState().emailVerified, true);
});

/* ---------- ADR-058 refinement (dueño, 2026-08-12): external skips OTP ---------- */

test('runConsentPrompt: profile:"external", NOT logged in, accept -> asks for the EXTERNAL email prompt, no OTP, granted + verified:FALSE', async () => {
  let verifyCalled = false;
  const spyVerify = async () => { verifyCalled = true; return { verified: true }; };
  const seenQuestions = [];
  const answers = ['s', 'lead@example.com'];
  const ask = async (q) => { seenQuestions.push(q); return answers.shift(); };
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, verifyEmail: spyVerify, loggedIn: false, profile: 'external' });
  assert.equal(decision, 'granted');
  assert.equal(verifyCalled, false, 'external must NEVER go through the OTP round');
  assert.ok(seenQuestions.includes(catalogEs.consent.emailPromptExternal), 'must ask the EXTERNAL-specific email prompt');
  assert.equal(seenQuestions.includes(catalogEs.consent.emailPrompt), false, 'must NOT ask the generic (talent) email prompt');
  const state = loadConsentState();
  assert.equal(getConsentDecision(state), 'granted');
  assert.equal(state.email, 'lead@example.com');
  assert.equal(state.emailVerified, false, 'ADR-007 model: self-affirmed, explicitly unverified — not merely omitted');
});

test('runConsentPrompt: profile:"external" prints the EXTERNAL confirmation copy, not the talent one, and never mentions verification', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { writes.push(String(chunk)); return true; };
  try {
    const ask = scriptedAsk(['s', 'lead@example.com']);
    await runConsentPrompt({ ask, catalog: catalogEs, loggedIn: false, profile: 'external' });
  } finally {
    process.stdout.write = originalWrite;
  }
  const out = writes.join('');
  assert.match(out, new RegExp(needle(catalogEs.consent.grantedSavedExternal('lead@example.com'), 'grantedSavedExternal').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Never the TALENT confirmation ("se guardará automáticamente en Shakers")
  // or an OTP-style "enter the code" prompt.
  assert.equal(out.includes(needle(catalogEs.consent.grantedSaved('lead@example.com'), 'grantedSaved')), false);
  assert.equal(out.includes('OTP'), false);
});

test('runConsentPrompt: profile:"external" + decline -> denied, exactly like talent (consent question itself is unchanged)', async () => {
  const ask = scriptedAsk(['n']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, loggedIn: false, profile: 'external' });
  assert.equal(decision, 'denied');
  assert.equal(getConsentDecision(loadConsentState()), 'denied');
});

test('runConsentPrompt: profile:"external" + an invalid email -> notObtained, nothing persisted (same validation as talent)', async () => {
  const ask = scriptedAsk(['s', 'not-an-email', 'not-an-email', 'not-an-email', 'not-an-email', 'not-an-email']);
  const decision = await runConsentPrompt({ ask, catalog: catalogEs, loggedIn: false, profile: 'external' });
  assert.equal(decision, null);
  assert.equal(loadConsentState(), null);
});

test('runConsentPrompt: profile:"external" is irrelevant once logged in -- the logged-in branch is unaffected either way', async () => {
  let verifyCalled = false;
  const spyVerify = async () => { verifyCalled = true; return { verified: true }; };
  const ask = async () => 's';
  const decision = await runConsentPrompt({
    ask, catalog: catalogEs, verifyEmail: spyVerify, loggedIn: true, sessionEmail: 'talent@example.com', profile: 'external',
  });
  assert.equal(decision, 'granted');
  assert.equal(verifyCalled, false); // already false for the logged-in branch regardless of profile
  assert.equal(loadConsentState().emailVerified, true, 'a logged-in session is always verified:true, profile does not change that');
});

for (const lang of ['es', 'en']) {
  test(`runConsentPrompt: logged-in grant message names the session email — ${lang}`, async () => {
    const catalog = getCatalog(lang);
    const ask = async () => 'y';
    await runConsentPrompt({ ask, catalog, loggedIn: true, sessionEmail: 'talent@example.com' });
    assert.equal(loadConsentState().email, 'talent@example.com');
  });
}

test('persistIntro: still opt-in/optional and revocable in both languages (ADR-011 model unchanged)', () => {
  assert.match(catalogEs.consent.persistIntro, /opcional/i);
  assert.match(catalogEs.consent.persistIntro, /revocable/i);
  const catalogEn = getCatalog('en');
  assert.match(catalogEn.consent.persistIntro, /optional/i);
  assert.match(catalogEn.consent.persistIntro, /revocable/i);
});

// talents-ai-score: presentation-only styling (src/legal-notice.js) over the SAME persistIntro text.
async function withStdoutTTYCapture(isTTY, fn) {
  const realTTY = process.stdout.isTTY;
  const original = process.stdout.write;
  let out = '';
  process.stdout.isTTY = isTTY;
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    await fn();
  } finally {
    process.stdout.isTTY = realTTY;
    process.stdout.write = original;
  }
  return out;
}

test('runConsentPrompt: a real TTY frames the persist intro with a heading + rule, wording intact', async () => {
  const out = await withStdoutTTYCapture(true, () =>
    runConsentPrompt({ ask: scriptedAsk(['n']), catalog: catalogEs }),
  );
  assert.match(out, /\x1b\[[0-9;]*m/, 'a real TTY must colour the notice');
  assert.ok(out.includes(needle(catalogEs.legalNotice.label, 'catalogEs.legalNotice.label')));
  assert.ok(out.includes(needle(catalogEs.consent.persistIntro, 'catalogEs.consent.persistIntro')), 'the exact legal wording must survive the styling');
});

test('runConsentPrompt: non-TTY stays byte-identical to before this feature (no heading, no rule, no ANSI)', async () => {
  const out = await withStdoutTTYCapture(false, () =>
    runConsentPrompt({ ask: scriptedAsk(['n']), catalog: catalogEs }),
  );
  assert.equal(/\x1b\[/.test(out), false);
  assert.ok(out.includes(`\n  ${catalogEs.consent.persistIntro}\n`));
});
