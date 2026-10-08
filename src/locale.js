'use strict';

const { execFileSync } = require('child_process');

// Operating system language detection, to localize the report (see i18n.js).

// Extracts a 2-letter language code ("es", "en"...) from a common locale string: "es_ES.UTF-8", "es-ES", "es", or a list "es_ES:en" (LANGUAGE format, the first element is taken).
function langFromLocaleString(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value || /^(c|posix)$/i.test(value)) return null;
  const first = value.split(':')[0];
  const match = first.match(/^([a-zA-Z]{2})/);
  return match ? match[1].toLowerCase() : null;
}

function langFromEnv(env) {
  for (const key of ['LC_ALL', 'LANG', 'LANGUAGE']) {
    const lang = langFromLocaleString(env[key]);
    if (lang) return lang;
  }
  return null;
}

// macOS DISPLAY language (top of "Preferred languages"), e.g. ("en-US", "es-ES").
// This is the UI-language intent, unlike AppleLocale/LANG which carry the region.
function langFromAppleLanguages() {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync('defaults', ['read', '-g', 'AppleLanguages'], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8');
    const first = out.replace(/[()]/g, '').split(',')[0].replace(/["\s]/g, '');
    return langFromLocaleString(first);
  } catch {
    return null; // key not set, command missing, or any other failure: ignored
  }
}

function langFromAppleLocale() {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync('defaults', ['read', '-g', 'AppleLocale'], {
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8');
    return langFromLocaleString(out);
  } catch {
    return null; // key not set, command missing, or any other failure: ignored
  }
}

function langFromIntl() {
  try {
    return langFromLocaleString(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

// Returns the detected language code ('es', 'en', 'fr', ...) or null if no signal could be resolved.
// macOS display language (AppleLanguages) wins over env LANG/LC_ALL (region/format), then AppleLocale, then Intl.
// `sys` overrides the macOS/Intl readers for deterministic tests (they ignore `env` and read the real host).
function detectLangCode(env = process.env, sys = {}) {
  const appleLanguages = sys.appleLanguages || langFromAppleLanguages;
  const appleLocale = sys.appleLocale || langFromAppleLocale;
  const intl = sys.intl || langFromIntl;
  return appleLanguages() || langFromEnv(env) || appleLocale() || intl() || null;
}

module.exports = { detectLangCode, langFromLocaleString };
