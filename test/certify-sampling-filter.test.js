'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { filterResolveBySampling, hasSampling, NO_SAMPLING_REASON } = require('../src/certify-sampling-filter');

/*
 * skill-code-certification (sampling fix): the RESOLVE result must be filtered
 * so the invariant  listed-as-certifiable <=> has-a-defined-sampling  holds.
 * A technology the server marks certifiable but for which this CLI has no code
 * sampling (an ecosystem the detector doesn't parse yet, e.g. Rails) is demoted
 * to nonCertifiable with reason 'no-sampling' — otherwise the talent could pick
 * it and then hit "no hay muestreo definido" at certify time.
 */

// Every technology the DETECTOR emits is now sampleable, so the remaining job
// of the filter is to guard against a tech the RESOLVE SERVER marks certifiable
// that the CLI has no sampling for at all — e.g. an ecosystem the detector
// doesn't parse yet (Ruby/Rails, per tech-detector.js's honest-limitation note)
// or a renamed/novel server-side string. 'Rails' stands in for that case.
test('hasSampling: true for a tech with an extension mapping, false without', () => {
  assert.equal(hasSampling('React'), true);
  assert.equal(hasSampling('Jest'), true);
  assert.equal(hasSampling('Vitest'), true); // now sampleable via its test files
  assert.equal(hasSampling('Tailwind CSS'), true); // now sampleable via its config
  assert.equal(hasSampling('Rails'), false); // CLI has no sampling for it
  assert.equal(hasSampling('COBOL'), false);
});

test('filterResolveBySampling: keeps sampleable certifiable entries untouched', () => {
  const result = {
    certifiable: [
      { skillId: 1, skillName: 'React', technology: 'React' },
      { skillId: 2, skillName: 'NestJS', technology: 'NestJS' },
    ],
    nonCertifiable: [],
  };
  const out = filterResolveBySampling(result);
  assert.equal(out.certifiable.length, 2);
  assert.equal(out.nonCertifiable.length, 0);
});

test('filterResolveBySampling: demotes a certifiable-but-unsampleable tech to nonCertifiable', () => {
  const result = {
    certifiable: [
      { skillId: 10, skillName: 'React', technology: 'React' },
      { skillId: 410, skillName: 'Rails', technology: 'Rails' }, // CLI has no sampling for it
    ],
    nonCertifiable: [],
  };
  const out = filterResolveBySampling(result);
  assert.deepEqual(out.certifiable.map((e) => e.technology), ['React']);
  assert.equal(out.nonCertifiable.length, 1);
  assert.deepEqual(out.nonCertifiable[0], { technology: 'Rails', reason: NO_SAMPLING_REASON });
});

test('filterResolveBySampling: preserves existing nonCertifiable entries and their reasons', () => {
  const result = {
    certifiable: [{ skillId: 5, skillName: 'Rails', technology: 'Rails' }],
    nonCertifiable: [{ technology: 'Django', reason: 'not-declared' }],
  };
  const out = filterResolveBySampling(result);
  assert.equal(out.certifiable.length, 0);
  const django = out.nonCertifiable.find((n) => n.technology === 'Django');
  const rails = out.nonCertifiable.find((n) => n.technology === 'Rails');
  assert.equal(django.reason, 'not-declared'); // untouched
  assert.equal(rails.reason, NO_SAMPLING_REASON);
});

test('filterResolveBySampling: does not duplicate or clobber a tech already in nonCertifiable', () => {
  const result = {
    certifiable: [{ skillId: 7, skillName: 'Rails', technology: 'Rails' }],
    nonCertifiable: [{ technology: 'Rails', reason: 'not-declared' }],
  };
  const out = filterResolveBySampling(result);
  const railsEntries = out.nonCertifiable.filter((n) => n.technology === 'Rails');
  assert.equal(railsEntries.length, 1, 'no duplicate');
  assert.equal(railsEntries[0].reason, 'not-declared', 'existing reason preserved');
});

test('filterResolveBySampling: tolerates missing/empty arrays', () => {
  assert.deepEqual(filterResolveBySampling({}).certifiable, []);
  assert.deepEqual(filterResolveBySampling({}).nonCertifiable, []);
  assert.deepEqual(filterResolveBySampling({ certifiable: null }).certifiable, []);
});
