'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCertsPayload, levelBand } = require('../src/graph-certs');

function projectWithCerts() {
  return {
    root: '/tmp/p',
    agentCertifications: {
      'code-reviewer': {
        level: 'P5',
        category: 'dev',
        role: 'Code Reviewer',
        rationale: 'Deep ownership across all areas.',
        areas: [
          { area: 'purpose_fit', tag: 'verified', evidence: 'Clear scope in the definition.' },
          { area: 'design_ownership', tag: 'verified', evidence: 'Owns the review rubric.' },
          { area: 'boundaries_guardrails', tag: 'partial', evidence: 'Some guardrails implied.' },
          { area: 'failure_handling', tag: 'verified', evidence: 'Handles empty diffs.' },
          { area: 'operation_evolution', tag: 'claimed', evidence: '' },
        ],
      },
    },
    certifications: {
      'id:42': { generatedAt: '2026-07-22T00:00:00Z', item: { skillId: 42, skillName: 'TypeScript', technology: 'NestJS', result: { score: 88, rationale: 'Strong typing discipline.', improvements: ['Extract ports', 'Add contract tests'] } } },
      'id:7': { generatedAt: '2026-07-22T00:00:00Z', item: { skillId: 7, skillName: 'Prompting', result: { score: 35, rationale: 'Nascent.', improvements: [] } } },
    },
  };
}

test('agents: P1-P5 level name, evidence DERIVED from areas (P5 never without evidence), areas mapped', () => {
  const p = buildCertsPayload(projectWithCerts(), 'es');
  assert.equal(p.agents.length, 1);
  const a = p.agents[0];
  assert.match(a.levelName, /P5/);
  assert.match(a.levelName, /Experto/); // es
  assert.equal(a.band, 'high'); // P5 -> high
  assert.equal(a.meta.length > 0, true); // category · role
  // deriveCertEvidence: verified areas surface as evidence (coherence: a P5 shows evidence)
  assert.ok(a.verified.length >= 2, 'verified evidence derived from areas');
  assert.ok(a.verified.some((e) => e.evidence.includes('review rubric')));
  // 5 areas passed through with localized names + tag labels
  assert.equal(a.areas.length, 5);
  assert.ok(a.areas.every((ar) => ar.name && ar.tag && ar.tagKey));
  assert.ok(a.rationale.includes('Deep ownership'));
});

test('skills: name(+tech), score, band, rationale, improvements', () => {
  const p = buildCertsPayload(projectWithCerts(), 'es');
  const ts = p.skills.find((s) => s.name.startsWith('TypeScript'));
  assert.equal(ts.name, 'TypeScript · NestJS');
  assert.equal(ts.score, 88);
  assert.equal(ts.band, 'high');
  assert.ok(ts.improvements.length === 2);
  const pr = p.skills.find((s) => s.name === 'Prompting');
  assert.equal(pr.band, 'low'); // 35 -> low
  assert.deepEqual(pr.improvements, []);
});

test('no certs => null (clean empty state, no misleading placeholder)', () => {
  assert.equal(buildCertsPayload({ root: '/x' }, 'es'), null);
  assert.equal(buildCertsPayload({ root: '/x', agentCertifications: {}, certifications: {} }, 'en'), null);
});

test('i18n: es and en both produce labels + pnScale P1..P5', () => {
  const es = buildCertsPayload(projectWithCerts(), 'es');
  const en = buildCertsPayload(projectWithCerts(), 'en');
  assert.equal(es.labels.agentsTitle, 'Agentes certificados');
  assert.equal(en.labels.agentsTitle, 'Certified agents');
  assert.match(es.pnScaleNote, /P1[\s\S]*P5/);
  assert.match(en.pnScaleNote, /P1[\s\S]*P5/);
  assert.ok(es.labels.why && en.labels.why);
});

test('levelBand mapping', () => {
  assert.equal(levelBand('P5'), 'high');
  assert.equal(levelBand('P4'), 'high');
  assert.equal(levelBand('P3'), 'mid');
  assert.equal(levelBand('P1'), 'low');
  assert.equal(levelBand('none'), 'low');
});
