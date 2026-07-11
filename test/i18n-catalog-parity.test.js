'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');

/*
 * talents-ai-score, i18n audit: structural safety net. Rather than relying
 * only on manually auditing every string, this walks BOTH catalogs
 * (es/en) recursively and asserts they expose the EXACT SAME set of key
 * paths — so a future addition to one catalog without its sibling in the
 * other is caught automatically by this test, not discovered later by a
 * talent seeing the wrong language.
 */

function collectKeyPaths(obj, prefix = '') {
  const paths = [];
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...collectKeyPaths(value, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

test('i18n catalogs: es and en expose the exact same set of key paths (no missing translation on either side)', () => {
  const es = getCatalog('es');
  const en = getCatalog('en');
  const esPaths = collectKeyPaths(es).sort();
  const enPaths = collectKeyPaths(en).sort();

  const missingInEn = esPaths.filter((p) => !enPaths.includes(p));
  const missingInEs = enPaths.filter((p) => !esPaths.includes(p));

  assert.deepEqual(missingInEn, [], `keys present in es but missing in en: ${missingInEn.join(', ')}`);
  assert.deepEqual(missingInEs, [], `keys present in en but missing in es: ${missingInEs.join(', ')}`);
});

test('i18n catalogs: every leaf value is either a non-empty string or a function (no accidental null/undefined placeholders)', () => {
  for (const lang of ['es', 'en']) {
    const catalog = getCatalog(lang);
    const paths = collectKeyPaths(catalog);
    for (const path of paths) {
      const value = path.split('.').reduce((o, k) => (o ? o[k] : undefined), catalog);
      const isValid = typeof value === 'function' || (typeof value === 'string' && value.length > 0);
      assert.ok(isValid, `${lang}.${path} is not a non-empty string or a function (got ${JSON.stringify(value)})`);
    }
  }
});

// talents-ai-score, i18n audit: specifically locks in the sections the
// coordinator called out by name, so a regression in any of them fails
// loudly and specifically rather than only via the generic parity check
// above.
test('i18n catalogs: tierNames, tierAnalysis, mcpCategories and categories all have both es and en', () => {
  const es = getCatalog('es');
  const en = getCatalog('en');
  for (const section of ['tierNames', 'tierAnalysis', 'mcpCategories', 'categories', 'levelNames']) {
    assert.ok(es[section], `es.${section} missing`);
    assert.ok(en[section], `en.${section} missing`);
  }
  for (const tierKey of ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']) {
    assert.ok(es.tierNames[tierKey], `es.tierNames.${tierKey} missing`);
    assert.ok(en.tierNames[tierKey], `en.tierNames.${tierKey} missing`);
    assert.notEqual(es.tierNames[tierKey], en.tierNames[tierKey], `${tierKey}: en tier name should differ from es`);
  }
});
