'use strict';

const { execFileSync } = require('child_process');

/*
 * Detección de idioma del sistema operativo, para localizar el informe
 * (ver i18n.js). Cero dependencias: solo módulos nativos de Node.
 *
 * Invariante (ADR-003, talents-ai-score): solo se leen SEÑALES DE IDIOMA
 * (variables de entorno de locale, API Intl, preferencia de idioma del SO).
 * Nunca contenido, rutas, otras variables de entorno ni credenciales.
 *
 * Orden de precedencia (de más a menos explícito/autoritativo). Documentado
 * aquí porque cambiar el orden cambia el idioma que ve el talento:
 *
 *   1. LC_ALL    — POSIX: pisa cualquier otra variable de locale.
 *   2. LANG      — POSIX: locale general del sistema/shell.
 *   3. LANGUAGE  — extensión GNU: lista de preferencias ("es_ES:en"); se toma
 *                  la primera. Se comprueba tras LC_ALL/LANG porque fuera de
 *                  shells GNU (p.ej. macOS) suele venir vacía o inconsistente.
 *   4. macOS: `defaults read -g AppleLocale` — preferencia de idioma real
 *      fijada en Preferencias del Sistema. Se prueba SOLO si ninguna variable
 *      de entorno anterior dio idioma (p.ej. shell con LANG=C/POSIX o sin
 *      variables, pero el usuario sí tiene idioma fijado a nivel de SO). Se
 *      considera más autoritativa que Intl porque lee la preferencia real del
 *      SO, no una heurística de ICU que puede degradar a un default si el
 *      proceso no hereda el entorno de la shell (p.ej. lanzado desde una GUI).
 *   5. Intl.DateTimeFormat().resolvedOptions().locale — respaldo universal
 *      (cualquier plataforma, incluida Windows): Node/ICU siempre devuelve
 *      algo, así que se usa como último recurso algorítmico antes del
 *      fallback fijo.
 *   6. null — si nada de lo anterior resuelve un idioma. El fallback final a
 *      'en' (idioma universal) lo aplica el llamador (ver i18n.resolveLang).
 */

// Extrae un código de idioma de 2 letras ("es", "en"...) de una cadena de
// locale habitual: "es_ES.UTF-8", "es-ES", "es", o una lista "es_ES:en"
// (formato de LANGUAGE, se toma el primer elemento). "C"/"POSIX" significan
// "sin locale de idioma fijado", no un idioma real: se ignoran.
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
    return null; // clave sin fijar, comando ausente, o cualquier fallo: se ignora
  }
}

function langFromIntl() {
  try {
    return langFromLocaleString(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

// Devuelve el código de idioma detectado ('es', 'en', 'fr', ...) o null si no
// se pudo resolver ninguna señal. `env` es inyectable para tests (por defecto
// process.env). La decisión de a qué catálogo mapea (es vs en, con en como
// fallback universal) vive en i18n.js, no aquí.
function detectLangCode(env = process.env) {
  return langFromEnv(env) || langFromAppleLocale() || langFromIntl() || null;
}

module.exports = { detectLangCode, langFromLocaleString };
