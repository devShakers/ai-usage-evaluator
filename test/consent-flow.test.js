'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runDisclosureFlow, disclosureText } = require('../src/consent-flow');
const { loadConsentState, getConsentDecision } = require('../src/share');
const { getCatalog } = require('../src/i18n');

/*
 * talents-ai-score / ADR-007, issue 006: the interactive disclosure +
 * consent + email flow. `ask` is injected (never touches real stdin), so
 * these tests drive the whole conversation deterministically.
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

test('disclosureText: mentions what is sent, what never is, purpose, indicative notice, revocable, and a legal placeholder', () => {
  const text = disclosureText(catalogEs);
  assert.match(text, /Nivel \(0-4\)/);
  assert.match(text, /NUNCA se envía/);
  assert.match(text, /contenido de tus ficheros/);
  assert.match(text, /Propósito/);
  assert.match(text, /indicativo, no verificado/);
  assert.match(text, /revocable/i);
  assert.match(text, /PENDIENTE DE REVISIÓN LEGAL/);
});

test('runDisclosureFlow: accept -> asks for email -> persists granted + email', async () => {
  const ask = scriptedAsk(['s', 'talent@example.com']);
  const decision = await runDisclosureFlow({ ask, catalog: catalogEs });
  assert.equal(decision, 'granted');
  const state = loadConsentState();
  assert.equal(getConsentDecision(state), 'granted');
  assert.equal(state.email, 'talent@example.com');
});

test('runDisclosureFlow: decline -> persists denied, never asks for an email', async () => {
  let emailAsked = false;
  const ask = async (q) => {
    if (q === catalogEs.consent.emailPrompt) emailAsked = true;
    return 'n';
  };
  const decision = await runDisclosureFlow({ ask, catalog: catalogEs });
  assert.equal(decision, 'denied');
  assert.equal(emailAsked, false);
  assert.equal(getConsentDecision(loadConsentState()), 'denied');
});

test('runDisclosureFlow: malformed email re-prompts without persisting anything until a valid one arrives', async () => {
  const ask = scriptedAsk(['s', 'not-an-email', 'still-bad', 'talent@example.com']);
  const decision = await runDisclosureFlow({ ask, catalog: catalogEs });
  assert.equal(decision, 'granted');
  assert.equal(loadConsentState().email, 'talent@example.com');
});

test('runDisclosureFlow: gives up after too many malformed emails WITHOUT persisting a decision (disclosure runs again next time)', async () => {
  const ask = scriptedAsk(['s', 'bad1', 'bad2', 'bad3', 'bad4', 'bad5']);
  const decision = await runDisclosureFlow({ ask, catalog: catalogEs });
  assert.equal(decision, null);
  assert.equal(loadConsentState(), null);
});

test('runDisclosureFlow: gives up after too many unrecognized yes/no answers WITHOUT persisting anything', async () => {
  const ask = scriptedAsk(['maybe', 'dunno', 'x', 'y?', '???']);
  const decision = await runDisclosureFlow({ ask, catalog: catalogEs });
  assert.equal(decision, null);
  assert.equal(loadConsentState(), null);
});

test('runDisclosureFlow: accepts common yes/no variants in both languages', async () => {
  for (const yes of ['y', 'yes', 's', 'si', 'sí', 'S', 'YES']) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const ask = scriptedAsk([yes, 'talent@example.com']);
    const decision = await runDisclosureFlow({ ask, catalog: catalogEs });
    assert.equal(decision, 'granted', `expected "${yes}" to be accepted as yes`);
  }
  for (const no of ['n', 'no', 'N', 'NO']) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const ask = scriptedAsk([no]);
    const decision = await runDisclosureFlow({ ask, catalog: catalogEs });
    assert.equal(decision, 'denied', `expected "${no}" to be rejected as no`);
  }
});
