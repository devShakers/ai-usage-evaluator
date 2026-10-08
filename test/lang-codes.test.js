'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { toLowerLang, toUpperLang, LANG_CODES } = require('../src/lang-codes');
const { detectFlowLang } = require('../src/i18n');

test('toLowerLang/toUpperLang: map the supported set, default en, per-casing', () => {
  assert.equal(toLowerLang('ES'), 'es');
  assert.equal(toUpperLang('es'), 'ES');
  assert.equal(toLowerLang('it'), 'it');
  assert.equal(toUpperLang('PT'), 'PT');
  assert.deepEqual(LANG_CODES, ['es', 'en', 'it', 'pt', 'fr']);
});

test('unsupported or empty language falls back to en', () => {
  assert.equal(toLowerLang('de'), 'en');
  assert.equal(toUpperLang('zh'), 'EN');
  assert.equal(toLowerLang(''), 'en');
  assert.equal(toLowerLang(undefined), 'en');
});

// Inject null macOS/Intl readers so the env (LANG/LC_ALL) path is exercised host-independently.
const NO_SYS = { appleLanguages: () => null, appleLocale: () => null, intl: () => null };

test('detectFlowLang: reads the machine locale (LANG) and maps to the supported set', () => {
  assert.equal(detectFlowLang({ LANG: 'es_ES.UTF-8' }, NO_SYS), 'es');
  assert.equal(detectFlowLang({ LANG: 'it_IT.UTF-8' }, NO_SYS), 'it');
  assert.equal(detectFlowLang({ LC_ALL: 'pt_PT', LANG: 'en_US' }, NO_SYS), 'pt', 'LC_ALL wins over LANG');
});

test('detectFlowLang: an unsupported machine locale defaults to en', () => {
  assert.equal(detectFlowLang({ LANG: 'de_DE.UTF-8' }, NO_SYS), 'en');
});
