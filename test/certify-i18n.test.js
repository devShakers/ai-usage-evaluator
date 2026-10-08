'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');

// The `certify` namespace was trimmed when `certify` became a dimension LiveKit interview: only the SHARED keys survive (disclaimer family + `report`); the dimension-interview copy lives in `certifyDimension`.
const es = getCatalog('es');
const en = getCatalog('en');

const DISCLAIMER_KEYS = [
  'disclaimer', 'disclaimerQuestion', 'disclaimerAcceptedFlag',
  'disclaimerNonInteractive', 'disclaimerDeclined', 'disclaimerInvalidAnswer', 'disclaimerNoAnswer',
];

test('certify section exists in both es and en with only the shared kept keys', () => {
  for (const c of [es.certify, en.certify]) {
    for (const k of DISCLAIMER_KEYS) assert.ok(typeof c[k] === 'string' && c[k].length > 0, `${k} missing`);
    assert.ok(c.report && typeof c.report === 'object', 'report sub-object missing');
    // The retired skill-code keys must be gone.
    for (const gone of ['help', 'resolveHeading', 'selectHeading', 'reasons', 'errorBackendOutdated', 'certifiableLine']) {
      assert.equal(gone in c, false, `retired key still present: ${gone}`);
    }
  }
});

test('certify: same key set in es and en', () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(es.certify), keys(en.certify));
  assert.deepEqual(keys(es.certify.report), keys(en.certify.report));
});

test('certify: disclaimer copy is a real translation, not a copy', () => {
  assert.notEqual(es.certify.disclaimerQuestion, en.certify.disclaimerQuestion);
  assert.notEqual(es.certify.disclaimer, en.certify.disclaimer);
});

test('certifyDimension section exists in both es and en (the new certify flow)', () => {
  assert.ok(es.certifyDimension && es.certifyDimension.title);
  assert.ok(en.certifyDimension && en.certifyDimension.title);
  assert.notEqual(es.certifyDimension.title, en.certifyDimension.title);
});
