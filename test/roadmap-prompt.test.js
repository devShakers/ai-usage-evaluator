'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildImplementationPrompt } = require('../src/roadmap-prompt');
const { getRoadmapEntry } = require('../src/roadmap-content');

/*
 * talents-ai-score (item 3, "next steps -> prompt"): a deterministic,
 * ready-to-paste prompt the talent copies into THEIR OWN AI tool so IT
 * implements the current tier jump's recommendation in their project —
 * replacing --build-next-level (generic file-writing) as the PRIMARY
 * "how do I implement this" path. Assembled purely from data this report
 * already has (the roadmap entry being rendered — curated or
 * ADR-015-personalized, this module doesn't care which — plus a few
 * already-computed project signals): never a second LLM call.
 */

const CURATED_T1 = getRoadmapEntry('T1', 'es'); // a real jump entry
const CURATED_T7 = getRoadmapEntry('T7', 'es'); // terminal, no jump

const MATURITY_T1 = { tier: 1, tierKey: 'T1', tierName: 'Primera herramienta' };

function reportWith(overrides) {
  return {
    technologies: [],
    tools: [],
    ...overrides,
  };
}

test('buildImplementationPrompt: T7 (max tier, no jump to implement) -> null', () => {
  const prompt = buildImplementationPrompt(CURATED_T7, reportWith({}), MATURITY_T1, 'es');
  assert.equal(prompt, null);
});

test('buildImplementationPrompt: null/missing entry -> null, never throws', () => {
  assert.equal(buildImplementationPrompt(null, reportWith({}), MATURITY_T1, 'es'), null);
  assert.doesNotThrow(() => buildImplementationPrompt(undefined, reportWith({}), MATURITY_T1, 'es'));
});

test('buildImplementationPrompt (es): includes the tier, what it unlocks, every step, and the snippet code', () => {
  const prompt = buildImplementationPrompt(CURATED_T1, reportWith({}), MATURITY_T1, 'es');
  assert.ok(prompt);
  assert.match(prompt, /T1/);
  assert.match(prompt, new RegExp(CURATED_T1.unlocks.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const step of CURATED_T1.steps) {
    assert.ok(prompt.includes(step.text), `expected step "${step.text}" in the prompt`);
  }
  assert.ok(prompt.includes(CURATED_T1.snippet.code));
});

test('buildImplementationPrompt (es): includes detected frameworks and AI tool names when present', () => {
  const report = reportWith({
    technologies: ['React', 'NestJS'],
    tools: [
      { name: 'Claude Code', detected: true },
      { name: 'Cursor', detected: true },
      { name: 'GitHub Copilot', detected: false },
    ],
  });
  const prompt = buildImplementationPrompt(CURATED_T1, report, MATURITY_T1, 'es');
  assert.match(prompt, /React/);
  assert.match(prompt, /NestJS/);
  assert.match(prompt, /Claude Code/);
  assert.match(prompt, /Cursor/);
  assert.equal(prompt.includes('GitHub Copilot'), false); // not detected -> excluded
});

test('buildImplementationPrompt: never throws with no frameworks/tools at all', () => {
  const report = reportWith({ technologies: [], tools: [] });
  assert.doesNotThrow(() => buildImplementationPrompt(CURATED_T1, report, MATURITY_T1, 'es'));
});

test('buildImplementationPrompt (en): renders in English, distinct from the Spanish version', () => {
  const promptEs = buildImplementationPrompt(CURATED_T1, reportWith({}), MATURITY_T1, 'es');
  const promptEn = buildImplementationPrompt(CURATED_T1, reportWith({}), MATURITY_T1, 'en');
  assert.ok(promptEn);
  assert.notEqual(promptEs, promptEn);
  assert.match(promptEn, /Help me implement/i);
});

test('buildImplementationPrompt: defaults to Spanish for an unrecognized/missing lang, never throws', () => {
  assert.doesNotThrow(() => buildImplementationPrompt(CURATED_T1, reportWith({}), MATURITY_T1, 'fr'));
  assert.doesNotThrow(() => buildImplementationPrompt(CURATED_T1, reportWith({}), MATURITY_T1, undefined));
});

test('buildImplementationPrompt: uses the entry it is GIVEN, so it reflects personalization already applied upstream (no LLM call of its own)', () => {
  const personalizedEntry = { ...CURATED_T1, unlocks: 'PERSONALIZED unlock text just for this project.' };
  const prompt = buildImplementationPrompt(personalizedEntry, reportWith({}), MATURITY_T1, 'es');
  assert.match(prompt, /PERSONALIZED unlock text just for this project\./);
});
