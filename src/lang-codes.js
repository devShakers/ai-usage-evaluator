'use strict';

const LANG_CODES = ['es', 'en', 'it', 'pt', 'fr'];

function toLowerLang(language) {
  const lower = String(language || 'en').trim().toLowerCase();
  return LANG_CODES.includes(lower) ? lower : 'en';
}

function toUpperLang(language) {
  return toLowerLang(language).toUpperCase();
}

module.exports = { LANG_CODES, toLowerLang, toUpperLang };
