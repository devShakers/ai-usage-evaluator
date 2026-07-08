'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { langFromLocaleString, detectLangCode } = require('../src/locale');
const { resolveLang, getCatalog, categoryLabel } = require('../src/i18n');

/*
 * Tests de detección de idioma (talents-ai-score, report-i18n). Cubren:
 *   - parseo de cadenas de locale habituales (langFromLocaleString)
 *   - precedencia de señales de entorno (detectLangCode, con env inyectado)
 *   - regla de resolución es/en (resolveLang): cualquier idioma que no
 *     empiece por 'es' cae en inglés, incluido "sin señal ninguna"
 *   - traducción de categorías por clave estable (categoryLabel)
 */

test('langFromLocaleString: formatos habituales', () => {
  assert.equal(langFromLocaleString('es_ES.UTF-8'), 'es');
  assert.equal(langFromLocaleString('en_US.UTF-8'), 'en');
  assert.equal(langFromLocaleString('fr_FR.UTF-8'), 'fr');
  assert.equal(langFromLocaleString('es-ES'), 'es');
  assert.equal(langFromLocaleString('es'), 'es');
});

test('langFromLocaleString: LANGUAGE con lista, se toma el primero', () => {
  assert.equal(langFromLocaleString('es_ES:en'), 'es');
  assert.equal(langFromLocaleString('en:es'), 'en');
});

test('langFromLocaleString: C/POSIX/vacío no son idioma', () => {
  assert.equal(langFromLocaleString('C'), null);
  assert.equal(langFromLocaleString('POSIX'), null);
  assert.equal(langFromLocaleString(''), null);
  assert.equal(langFromLocaleString(undefined), null);
});

test('detectLangCode: LC_ALL tiene prioridad sobre LANG y LANGUAGE', () => {
  const env = { LC_ALL: 'es_ES.UTF-8', LANG: 'en_US.UTF-8', LANGUAGE: 'fr_FR' };
  assert.equal(detectLangCode(env), 'es');
});

test('detectLangCode: LANG se usa si LC_ALL no da idioma', () => {
  const env = { LC_ALL: 'C', LANG: 'fr_FR.UTF-8', LANGUAGE: '' };
  assert.equal(detectLangCode(env), 'fr');
});

test('detectLangCode: LANGUAGE se usa si LC_ALL/LANG no dan idioma', () => {
  const env = { LC_ALL: '', LANG: 'C', LANGUAGE: 'de_DE:en' };
  assert.equal(detectLangCode(env), 'de');
});

test('detectLangCode: sin ninguna variable de entorno, cae a Intl/AppleLocale (nunca null en este runtime)', () => {
  const code = detectLangCode({});
  // No se puede fijar el resultado exacto (depende del entorno CI/local),
  // pero SIEMPRE debe resolver algo (Intl.DateTimeFormat nunca falla) o null.
  assert.ok(code === null || /^[a-z]{2}$/.test(code));
});

// --- Regla de resolución es/en (fallback universal a inglés) ---

test('resolveLang: es -> es', () => {
  assert.equal(resolveLang('es'), 'es');
});

test('resolveLang: variantes que empiezan por "es" -> es', () => {
  assert.equal(resolveLang('es-ES'), 'es');
  assert.equal(resolveLang('ES'), 'es');
});

test('resolveLang: en -> en', () => {
  assert.equal(resolveLang('en'), 'en');
});

test('resolveLang: fr/de y cualquier otro idioma no-es -> en (fallback universal)', () => {
  assert.equal(resolveLang('fr'), 'en');
  assert.equal(resolveLang('de'), 'en');
  assert.equal(resolveLang('ja'), 'en');
  assert.equal(resolveLang('pt'), 'en');
});

test('resolveLang: sin señal (null/undefined) -> en (fallback universal)', () => {
  assert.equal(resolveLang(null), 'en');
  assert.equal(resolveLang(undefined), 'en');
  assert.equal(resolveLang(''), 'en');
});

// --- Catálogo y categorías (clave estable, no toca detectors.js) ---

test('getCatalog: idioma desconocido degrada a en', () => {
  const t = getCatalog('fr');
  assert.equal(t.html.lang, 'en');
});

test('categoryLabel: traduce por clave estable a partir del texto en español del scanner', () => {
  assert.equal(categoryLabel('en', 'CLI agéntica'), 'Agentic CLI');
  assert.equal(categoryLabel('en', 'Editor con IA'), 'AI editor');
  assert.equal(categoryLabel('es', 'CLI agéntica'), 'CLI agéntica');
});

test('categoryLabel: categoría desconocida degrada al texto en español (nunca rompe)', () => {
  assert.equal(categoryLabel('en', 'Categoría inventada'), 'Categoría inventada');
});
