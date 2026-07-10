'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getRoadmapEntry } = require('../src/roadmap-content');

/*
 * talents-ai-score, issue 020 (ADR-013/014): curated tier roadmap content,
 * ported verbatim from
 * active-work/talents-ai-score/build/roadmap-content.md. Never generated
 * at runtime — this module only reads/returns authored data.
 */

const ALL_TIER_KEYS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

test('getRoadmapEntry: every tier T0-T6 has a complete jump entry (title, upgradeWhen, unlocks, steps, snippet, tips, commonMistakes)', () => {
  for (const tierKey of ALL_TIER_KEYS) {
    const entry = getRoadmapEntry(tierKey);
    assert.ok(entry, `expected an entry for ${tierKey}`);
    assert.equal(entry.maxTier, false);
    assert.ok(entry.title, `${tierKey}: missing title`);
    assert.ok(entry.upgradeWhen, `${tierKey}: missing upgradeWhen`);
    assert.ok(entry.unlocks, `${tierKey}: missing unlocks`);
    assert.ok(Array.isArray(entry.steps) && entry.steps.length > 0, `${tierKey}: missing steps`);
    for (const step of entry.steps) {
      assert.ok(step.text, `${tierKey}: a step is missing text`);
      assert.ok(step.estimate, `${tierKey}: a step is missing an estimate`);
    }
    assert.ok(entry.snippet && entry.snippet.code, `${tierKey}: missing snippet code`);
    assert.ok(entry.snippet.language, `${tierKey}: missing snippet language`);
    assert.ok(Array.isArray(entry.tips) && entry.tips.length > 0, `${tierKey}: missing tips`);
    assert.ok(Array.isArray(entry.commonMistakes) && entry.commonMistakes.length > 0, `${tierKey}: missing commonMistakes`);
  }
});

test('getRoadmapEntry: T7 returns the terminal ("nivel máximo") shape, not a jump entry', () => {
  const entry = getRoadmapEntry('T7');
  assert.equal(entry.maxTier, true);
  assert.ok(entry.title);
  assert.ok(entry.intro);
  assert.ok(entry.whatRemains);
  assert.ok(Array.isArray(entry.consolidationSteps) && entry.consolidationSteps.length > 0);
  assert.ok(entry.honestyNote);
  // T7 has no "next tier" fields — never invents an upgrade path.
  assert.equal('upgradeWhen' in entry, false);
  assert.equal('steps' in entry, false);
});

test('getRoadmapEntry: unrecognized tier key -> null, never throws', () => {
  assert.equal(getRoadmapEntry('T99'), null);
  assert.doesNotThrow(() => getRoadmapEntry(undefined));
});

test('getRoadmapEntry: snippets are LITERAL code, never translated regardless of lang', () => {
  const es = getRoadmapEntry('T1', 'es');
  const en = getRoadmapEntry('T1', 'en');
  assert.equal(es.snippet.code, en.snippet.code);
  assert.equal(es.snippet.filename, en.snippet.filename);
});

test('getRoadmapEntry: unauthored language (en) falls back to Spanish content with pendingTranslation: true', () => {
  const entry = getRoadmapEntry('T2', 'en');
  assert.equal(entry.lang, 'es');
  assert.equal(entry.pendingTranslation, true);
  assert.match(entry.unlocks, /[áéíóúñ]/i); // still Spanish prose, not fabricated English
});

test('getRoadmapEntry: authored language (es) never reports pendingTranslation', () => {
  const entry = getRoadmapEntry('T2', 'es');
  assert.equal(entry.pendingTranslation, false);
});

test('getRoadmapEntry: T5 (multi-agent jump) carries a second snippet file (two agent definitions needed for the T6 criterion)', () => {
  const entry = getRoadmapEntry('T5');
  assert.ok(entry.snippet.secondFile);
  assert.ok(entry.snippet.secondFile.code);
  assert.notEqual(entry.snippet.filename, entry.snippet.secondFile.filename);
});
