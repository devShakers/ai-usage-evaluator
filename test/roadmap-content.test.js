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

// ADR-008 (skill-code-certification): T7 must NOT be a dead end. The top
// setups keep receiving actionable, curated improvement steps (continuous
// refinement — optimize hooks/agents, contribute skills, maintain, measure),
// not an empty terminal roadmap.
test('getRoadmapEntry (ADR-008): T7 carries several actionable improvement steps (not a dead end), es and en at parity', () => {
  const es = getRoadmapEntry('T7', 'es');
  const en = getRoadmapEntry('T7', 'en');
  assert.ok(es.consolidationSteps.length >= 4, `T7/es should offer >= 4 steps, got ${es.consolidationSteps.length}`);
  assert.equal(en.consolidationSteps.length, es.consolidationSteps.length, 'T7 step count must match across languages');
  // Genuine English (never Spanish prose under an English request).
  for (const step of en.consolidationSteps) {
    assert.equal(/[áéíóúñ¿¡]/i.test(step), false, `English T7 step contains Spanish characters: ${step}`);
  }
});

test('getRoadmapEntry: unrecognized tier key -> null, never throws', () => {
  assert.equal(getRoadmapEntry('T99'), null);
  assert.doesNotThrow(() => getRoadmapEntry(undefined));
});

// talents-ai-score, i18n audit note: "snippets are never translated" (both
// source docs' own header) means this CLI never runs a translation over a
// snippet's CODE at render time — it just ports whatever each authored
// source .md provides, verbatim, per language. Where a snippet's code has
// genuine human-facing text baked in (a bash `#` comment, a frontmatter
// `description:` field, file body prose), the AUTHORED source for each
// language legitimately differs — that's per-language authored content,
// not a runtime translation. T2's `.mcp.json` snippet has no such prose
// (pure technical JSON), so it's the case that stays byte-identical.
test('getRoadmapEntry: filename stays identical across languages (same file target, regardless of prose inside it)', () => {
  for (const tierKey of ['T0', 'T1', 'T2', 'T3', 'T4', 'T6']) {
    const es = getRoadmapEntry(tierKey, 'es');
    const en = getRoadmapEntry(tierKey, 'en');
    assert.equal(es.snippet.filename, en.snippet.filename, `${tierKey}: filename should match across languages`);
    assert.equal(es.snippet.language, en.snippet.language, `${tierKey}: snippet language (bash/json/markdown) should match`);
  }
});

test('getRoadmapEntry: T2 snippet (pure technical JSON, no human-facing prose) is byte-identical across languages', () => {
  const es = getRoadmapEntry('T2', 'es');
  const en = getRoadmapEntry('T2', 'en');
  assert.equal(es.snippet.code, en.snippet.code);
});

// talents-ai-score, i18n audit: English is now a GENUINE, fully-authored
// translation (active-work/talents-ai-score/build/roadmap-content.en.md),
// not a Spanish fallback — the old `pendingTranslation` mechanism is
// retired. `lang` must reflect the language actually served, and English
// content must be reachable and genuinely in English (never Spanish
// prose under an English request).

test('getRoadmapEntry: en is now a REAL, complete translation — every T0-T6 jump entry is fully populated in English too', () => {
  const ALL = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  for (const tierKey of ALL) {
    const entry = getRoadmapEntry(tierKey, 'en');
    assert.equal(entry.lang, 'en');
    assert.equal(entry.contentUnavailable, undefined);
    assert.ok(entry.title, `${tierKey}: missing English title`);
    assert.ok(entry.upgradeWhen, `${tierKey}: missing English upgradeWhen`);
    assert.ok(entry.unlocks, `${tierKey}: missing English unlocks`);
    assert.ok(Array.isArray(entry.steps) && entry.steps.length > 0, `${tierKey}: missing English steps`);
    assert.ok(Array.isArray(entry.tips) && entry.tips.length > 0, `${tierKey}: missing English tips`);
    assert.ok(Array.isArray(entry.commonMistakes) && entry.commonMistakes.length > 0, `${tierKey}: missing English commonMistakes`);
    // Never Spanish prose under an English request.
    assert.equal(/[áéíóúñ¿¡]/i.test(entry.unlocks), false, `${tierKey}: English unlocks contains Spanish characters`);
  }
});

test('getRoadmapEntry: T7 terminal entry is also a real English translation', () => {
  const entry = getRoadmapEntry('T7', 'en');
  assert.equal(entry.lang, 'en');
  assert.equal(entry.maxTier, true);
  assert.equal(entry.contentUnavailable, undefined);
  assert.ok(entry.intro);
  assert.ok(entry.whatRemains);
  assert.ok(entry.honestyNote);
  assert.equal(/[áéíóúñ¿¡]/i.test(entry.intro), false);
});

test('getRoadmapEntry: Spanish requests are unaffected — never reports contentUnavailable', () => {
  for (const tierKey of ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']) {
    const entry = getRoadmapEntry(tierKey, 'es');
    assert.equal(entry.lang, 'es');
    assert.equal(entry.contentUnavailable, undefined);
  }
});

// Defensive fallback (never fires against the current, fully-translated
// T0-T7 set — see src/roadmap-content.js's own header note): a tier that
// exists in Spanish but is missing from the English catalog degrades to
// `contentUnavailable: true`, NEVER to Spanish prose under English.
test('getRoadmapEntry: a tier missing from the English catalog (simulated) degrades to contentUnavailable, never Spanish prose', () => {
  const { TIER_JUMPS_EN } = require('../src/roadmap-content');
  const originalT2 = TIER_JUMPS_EN.T2;
  delete TIER_JUMPS_EN.T2;
  try {
    const entry = getRoadmapEntry('T2', 'en');
    assert.equal(entry.contentUnavailable, true);
    assert.equal(entry.lang, 'en');
    assert.equal('unlocks' in entry, false); // no Spanish (or any) prose leaked through
  } finally {
    TIER_JUMPS_EN.T2 = originalT2; // restore — this module's state is shared across tests
  }
});

test('getRoadmapEntry: T5 (multi-agent jump) carries a second snippet file (two agent definitions needed for the T6 criterion)', () => {
  const entry = getRoadmapEntry('T5');
  assert.ok(entry.snippet.secondFile);
  assert.ok(entry.snippet.secondFile.code);
  assert.notEqual(entry.snippet.filename, entry.snippet.secondFile.filename);
});
