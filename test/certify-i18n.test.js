'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');

/*
 * skill-code-certification, issue 004: focused es/en parity for the NEW
 * `certify` catalog section (the generic i18n-catalog-parity test also
 * covers it structurally; this one locks the section in by name and checks
 * the functions render for both languages, per the issue's AC).
 */

const es = getCatalog('es');
const en = getCatalog('en');

test('certify section exists in both es and en', () => {
  assert.ok(es.certify, 'es.certify missing');
  assert.ok(en.certify, 'en.certify missing');
});

test('certify: same key set in es and en (including reasons subkeys)', () => {
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(es.certify), keys(en.certify));
  assert.deepEqual(keys(es.certify.reasons), keys(en.certify.reasons));
});

test('certify: reason keys cover the server contract keys + generic fallback', () => {
  for (const cat of [es.certify.reasons, en.certify.reasons]) {
    assert.ok(cat['no-skill-match']);
    assert.ok(cat['not-declared']);
    assert.ok(cat.notCertifiable);
  }
});

test('certify: function entries render non-empty strings in both languages', () => {
  for (const cat of [es.certify, en.certify]) {
    assert.ok(cat.certifiableLine('React', 'React', 7).length > 0);
    assert.ok(cat.nonCertifiableLine('Express', 'because').length > 0);
    assert.ok(cat.emailUsing('a@b.com').length > 0);
    assert.ok(cat.technologiesDetected('React, NestJS').length > 0);
    assert.ok(cat.errorHttp(503).length > 0);
  }
});

test('certify: es and en strings actually differ for a sample of keys (real translation, not a copy)', () => {
  assert.notEqual(es.certify.disclaimerQuestion, en.certify.disclaimerQuestion);
  assert.notEqual(es.certify.resolveHeading, en.certify.resolveHeading);
});

test('certify (missing-migrations bugfix): errorBackendOutdated is present, actionable, and DISTINCT from the network error', () => {
  for (const cat of [es.certify, en.certify]) {
    assert.ok(cat.errorBackendOutdated && cat.errorBackendOutdated.length > 0);
    // Must NOT be the network-error copy — it's the server, not the connection.
    assert.notEqual(cat.errorBackendOutdated, cat.errorNetwork);
  }
  // Actionable wording in each language (migrations / restart).
  assert.match(es.certify.errorBackendOutdated, /migraciones/i);
  assert.match(es.certify.errorBackendOutdated, /reinic/i);
  assert.match(en.certify.errorBackendOutdated, /migrations/i);
  assert.match(en.certify.errorBackendOutdated, /restart/i);
  // Real translation, not a copy.
  assert.notEqual(es.certify.errorBackendOutdated, en.certify.errorBackendOutdated);
});
