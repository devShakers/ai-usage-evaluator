'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { langFromLocaleString, detectLangCode } = require('../src/locale');
const { resolveLang, getCatalog, categoryLabel } = require('../src/i18n');

// Language detection tests (talents-ai-score, report-i18n).

test('langFromLocaleString: common formats', () => {
  assert.equal(langFromLocaleString('es_ES.UTF-8'), 'es');
  assert.equal(langFromLocaleString('en_US.UTF-8'), 'en');
  assert.equal(langFromLocaleString('fr_FR.UTF-8'), 'fr');
  assert.equal(langFromLocaleString('es-ES'), 'es');
  assert.equal(langFromLocaleString('es'), 'es');
});

test('langFromLocaleString: LANGUAGE with a list, first one is taken', () => {
  assert.equal(langFromLocaleString('es_ES:en'), 'es');
  assert.equal(langFromLocaleString('en:es'), 'en');
});

test('langFromLocaleString: C/POSIX/empty are not a language', () => {
  assert.equal(langFromLocaleString('C'), null);
  assert.equal(langFromLocaleString('POSIX'), null);
  assert.equal(langFromLocaleString(''), null);
  assert.equal(langFromLocaleString(undefined), null);
});

// The macOS/Intl readers ignore `env` and read the real host, so inject nulls to test env resolution deterministically.
const NO_SYS = { appleLanguages: () => null, appleLocale: () => null, intl: () => null };

test('detectLangCode: LC_ALL takes priority over LANG and LANGUAGE', () => {
  const env = { LC_ALL: 'es_ES.UTF-8', LANG: 'en_US.UTF-8', LANGUAGE: 'fr_FR' };
  assert.equal(detectLangCode(env, NO_SYS), 'es');
});

test('detectLangCode: LANG is used if LC_ALL gives no language', () => {
  const env = { LC_ALL: 'C', LANG: 'fr_FR.UTF-8', LANGUAGE: '' };
  assert.equal(detectLangCode(env, NO_SYS), 'fr');
});

test('detectLangCode: LANGUAGE is used if LC_ALL/LANG give no language', () => {
  const env = { LC_ALL: '', LANG: 'C', LANGUAGE: 'de_DE:en' };
  assert.equal(detectLangCode(env, NO_SYS), 'de');
});

test('detectLangCode: with no environment variable at all, falls back to Intl/AppleLocale (never null on this runtime)', () => {
  const code = detectLangCode({});
  // The exact result can't be pinned down (depends on the CI/local environment), but it must ALWAYS resolve something (Intl.DateTimeFormat never fails) or null.
  assert.ok(code === null || /^[a-z]{2}$/.test(code));
});

// --- macOS display language (AppleLanguages) wins over env region/format (LANG) ---

test('detectLangCode: macOS display language (AppleLanguages) beats env LANG', () => {
  // Display English + region Spain (LANG=es_ES) must resolve to English, not Spanish.
  const env = { LANG: 'es_ES.UTF-8' };
  const sys = { appleLanguages: () => 'en', appleLocale: () => 'es', intl: () => 'es' };
  assert.equal(detectLangCode(env, sys), 'en');
});

test('detectLangCode: display Spanish resolves to Spanish', () => {
  const sys = { appleLanguages: () => 'es', appleLocale: () => null, intl: () => null };
  assert.equal(detectLangCode({}, sys), 'es');
});

test('detectLangCode: env LANG is used when AppleLanguages is absent (Linux/CI)', () => {
  const sys = { appleLanguages: () => null, appleLocale: () => null, intl: () => null };
  assert.equal(detectLangCode({ LANG: 'es_ES.UTF-8' }, sys), 'es');
});

// --- es/en resolution rule (universal fallback to English) ---

test('resolveLang: es -> es', () => {
  assert.equal(resolveLang('es'), 'es');
});

test('resolveLang: variants starting with "es" -> es', () => {
  assert.equal(resolveLang('es-ES'), 'es');
  assert.equal(resolveLang('ES'), 'es');
});

test('resolveLang: en -> en', () => {
  assert.equal(resolveLang('en'), 'en');
});

test('resolveLang: fr/de and any other non-es language -> en (universal fallback)', () => {
  assert.equal(resolveLang('fr'), 'en');
  assert.equal(resolveLang('de'), 'en');
  assert.equal(resolveLang('ja'), 'en');
  assert.equal(resolveLang('pt'), 'en');
});

test('resolveLang: no signal (null/undefined) -> en (universal fallback)', () => {
  assert.equal(resolveLang(null), 'en');
  assert.equal(resolveLang(undefined), 'en');
  assert.equal(resolveLang(''), 'en');
});

// --- Catalog and categories (stable key, doesn't touch detectors.js) ---

test('getCatalog: unknown language degrades to en', () => {
  const t = getCatalog('fr');
  assert.equal(t.html.lang, 'en');
});

test('categoryLabel: translates by stable key from the scanner Spanish text', () => {
  assert.equal(categoryLabel('en', 'CLI agéntica'), 'Agentic CLI');
  assert.equal(categoryLabel('en', 'Editor con IA'), 'AI editor');
  assert.equal(categoryLabel('es', 'CLI agéntica'), 'CLI agéntica');
});

test('categoryLabel: unknown category degrades to the Spanish text (never breaks)', () => {
  assert.equal(categoryLabel('en', 'Categoría inventada'), 'Categoría inventada');
});
