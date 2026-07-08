'use strict';

const { execFileSync } = require('child_process');

/*
 * Operating system language detection, to localize the report (see
 * i18n.js). Zero dependencies: only native Node modules.
 *
 * Invariant (ADR-003, talents-ai-score): only LANGUAGE SIGNALS are read
 * (locale environment variables, the Intl API, the OS's language
 * preference). Never content, paths, other environment variables, or
 * credentials.
 *
 * Precedence order (from most to least explicit/authoritative). Documented
 * here because changing the order changes the language the talent sees:
 *
 *   1. LC_ALL    — POSIX: overrides any other locale variable.
 *   2. LANG      — POSIX: the system/shell's general locale.
 *   3. LANGUAGE  — GNU extension: a preference list ("es_ES:en"); the first
 *                  one is taken. Checked after LC_ALL/LANG because outside
 *                  GNU shells (e.g. macOS) it's usually empty or inconsistent.
 *   4. macOS: `defaults read -g AppleLocale` — the real language preference
 *      set in System Preferences. Only tried if no earlier environment
 *      variable gave a language (e.g. a shell with LANG=C/POSIX or no
 *      variables at all, but the user does have a language set at the OS
 *      level). Considered more authoritative than Intl because it reads the
 *      OS's actual preference, not an ICU heuristic that can degrade to a
 *      default if the process doesn't inherit the shell's environment
 *      (e.g. launched from a GUI).
 *   5. Intl.DateTimeFormat().resolvedOptions().locale — universal fallback
 *      (any platform, including Windows): Node/ICU always returns
 *      something, so it's used as the last algorithmic resort before the
 *      fixed fallback.
 *   6. null — if none of the above resolves a language. The final fallback
 *      to 'en' (the universal language) is applied by the caller (see
 *      i18n.resolveLang).
 */

// Extracts a 2-letter language code ("es", "en"...) from a common locale
// string: "es_ES.UTF-8", "es-ES", "es", or a list "es_ES:en" (LANGUAGE
// format, the first element is taken). "C"/"POSIX" mean "no language locale
// set", not a real language: they're ignored.
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

// Returns the detected language code ('es', 'en', 'fr', ...) or null if no
// signal could be resolved. `env` is injectable for tests (defaults to
// process.env). The decision of which catalog it maps to (es vs en, with en
// as the universal fallback) lives in i18n.js, not here.
function detectLangCode(env = process.env) {
  return langFromEnv(env) || langFromAppleLocale() || langFromIntl() || null;
}

module.exports = { detectLangCode, langFromLocaleString };
