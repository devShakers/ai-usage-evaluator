'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCertsPayload, levelInfoFromCombinedLevel } = require('../src/graph-certs');

// Agent certifications were removed from the report (ADR-033); the cert drawer
// payload is now Skill-only.
function projectWithCerts() {
  return {
    root: '/tmp/p',
    certifications: {
      'id:42': { generatedAt: '2026-07-22T00:00:00Z', item: { skillId: 42, skillName: 'TypeScript', technology: 'NestJS', result: { score: 88, rationale: 'Strong typing discipline.', improvements: ['Extract ports', 'Add contract tests'] } } },
      'id:7': { generatedAt: '2026-07-22T00:00:00Z', item: { skillId: 7, skillName: 'Prompting', result: { score: 35, rationale: 'Nascent.', improvements: [] } } },
    },
  };
}

test('payload no longer carries agents (ADR-033)', () => {
  const p = buildCertsPayload(projectWithCerts(), 'es');
  assert.equal(p.agents, undefined);
  assert.equal(p.pnScaleNote, undefined);
  assert.equal(p.labels.agentsTitle, undefined);
});

test('skills: name(+tech), named level, band, rationale, improvements (ADR-016)', () => {
  const p = buildCertsPayload(projectWithCerts(), 'es');
  const ts = p.skills.find((s) => s.name.startsWith('TypeScript'));
  assert.equal(ts.name, 'TypeScript · NestJS');
  // ADR-016: numeric grade replaced by the named level (88 -> high band -> Expert).
  assert.equal(ts.levelKey, 'expert');
  assert.equal(ts.levelName, 'Expert');
  assert.equal(ts.band, 'high');
  assert.equal(ts.score, undefined); // numeric grade removed from the skill output
  assert.ok(ts.improvements.length === 2);
  const pr = p.skills.find((s) => s.name === 'Prompting');
  assert.equal(pr.band, 'low'); // 35 -> low
  assert.equal(pr.levelKey, 'middle'); // low band -> Middle
  assert.equal(pr.levelName, 'Middle');
  assert.deepEqual(pr.improvements, []);
});

test('no certs => null (clean empty state, no misleading placeholder)', () => {
  assert.equal(buildCertsPayload({ root: '/x' }, 'es'), null);
  assert.equal(buildCertsPayload({ root: '/x', certifications: {} }, 'en'), null);
});

test('i18n: es and en both produce skills labels', () => {
  const es = buildCertsPayload(projectWithCerts(), 'es');
  const en = buildCertsPayload(projectWithCerts(), 'en');
  assert.equal(es.labels.skillsTitle, 'Skills evaluadas');
  assert.equal(en.labels.skillsTitle, 'Skills evaluated');
  assert.ok(es.labels.improvements && en.labels.improvements);
});

test('skills: a combined level from the interview overrides the code-only score (antifraud cap case)', () => {
  const p = projectWithCerts();
  p.certifications['id:42'].item.result.combinedLevel = 'Middle';
  const payload = buildCertsPayload(p, 'es');
  const ts = payload.skills.find((s) => s.name.startsWith('TypeScript'));
  assert.equal(ts.levelKey, 'middle');
  assert.equal(ts.levelName, 'Middle');
  assert.equal(ts.band, 'low');
});

test('skills: no combinedLevel (no interview ran) falls back to the code-only score, unchanged', () => {
  const p = projectWithCerts();
  assert.equal(p.certifications['id:42'].item.result.combinedLevel, undefined);
  const payload = buildCertsPayload(p, 'es');
  const ts = payload.skills.find((s) => s.name.startsWith('TypeScript'));
  assert.equal(ts.levelKey, 'expert');
  assert.equal(ts.band, 'high');
});

test('levelInfoFromCombinedLevel: maps the three known levels case-insensitively, null otherwise', () => {
  assert.deepEqual(levelInfoFromCombinedLevel('Expert'), { key: 'expert', band: 'high' });
  assert.deepEqual(levelInfoFromCombinedLevel('senior'), { key: 'senior', band: 'mid' });
  assert.deepEqual(levelInfoFromCombinedLevel('MIDDLE'), { key: 'middle', band: 'low' });
  assert.equal(levelInfoFromCombinedLevel(undefined), null);
  assert.equal(levelInfoFromCombinedLevel(null), null);
  assert.equal(levelInfoFromCombinedLevel('unknown'), null);
});
