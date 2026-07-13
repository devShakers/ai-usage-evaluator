'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatResolveReport } = require('../src/certify-render');
const { getCatalog } = require('../src/i18n');

/*
 * skill-code-certification, issue 004: the pure RESOLVE formatter. Renders
 * certifiable Skills and — the key requirement — non-certifiable detected
 * technologies WITH a reason, derived from detected-minus-certifiable so a
 * detected technology is never silently dropped.
 */

const es = getCatalog('es');
const en = getCatalog('en');

test('formatResolveReport: lists certifiable Skills tied to their technology', () => {
  const out = formatResolveReport(
    ['React', 'NestJS'],
    { certifiable: [{ skillId: 12, skillName: 'React', technology: 'React' }, { skillId: 3, skillName: 'NestJS', technology: 'NestJS' }], nonCertifiable: [] },
    en,
  );
  assert.match(out, /Certifiable:/);
  assert.match(out, /React \(React\) \[#12\]/);
  assert.match(out, /NestJS \(NestJS\) \[#3\]/);
});

test('formatResolveReport: non-certifiable = detected minus certifiable, with the server reason', () => {
  const out = formatResolveReport(
    ['React', 'Express', 'Django'],
    {
      certifiable: [{ skillId: 1, skillName: 'React', technology: 'React' }],
      nonCertifiable: [
        { technology: 'Express', reason: 'not-declared' },
        { technology: 'Django', reason: 'no-skill-match' },
      ],
    },
    en,
  );
  assert.match(out, /Not certifiable:/);
  assert.match(out, /Express — you haven't declared this Skill/);
  assert.match(out, /Django — no matching Skill in the Shakers catalog/);
  // React is certifiable, so it must NOT appear in the non-certifiable list.
  const notCertSection = out.slice(out.indexOf('Not certifiable:'));
  assert.equal(notCertSection.includes('React'), false);
});

test('formatResolveReport: detected tech with no server reason falls back to a generic reason (never dropped)', () => {
  const out = formatResolveReport(
    ['Express'],
    { certifiable: [], nonCertifiable: [] },
    en,
  );
  assert.match(out, /Express — not certifiable/);
});

test('formatResolveReport: empty states for both lists', () => {
  const out = formatResolveReport([], { certifiable: [], nonCertifiable: [] }, en);
  assert.match(out, /No detected technology maps to a Skill/);
  assert.match(out, /every detected technology is certifiable|None —/);
});

test('formatResolveReport: Spanish catalog renders Spanish reasons', () => {
  const out = formatResolveReport(
    ['Express'],
    { certifiable: [], nonCertifiable: [{ technology: 'Express', reason: 'not-declared' }] },
    es,
  );
  assert.match(out, /no has declarado esta Skill/);
});

test('formatResolveReport: skillId omitted when null', () => {
  const out = formatResolveReport(
    ['React'],
    { certifiable: [{ skillId: null, skillName: 'React', technology: 'React' }], nonCertifiable: [] },
    en,
  );
  assert.match(out, /React \(React\)/);
  assert.equal(out.includes('[#'), false);
});
