'use strict';

const { detectLangCode } = require('./locale');
const { CATEGORIES } = require('./detectors');

/*
 * Localization of the report (HTML + terminal) and of the CLI notices tied
 * to the report. Only two languages supported: 'es' and 'en'. Resolution
 * rule: any language that does NOT start with 'es' falls back to English —
 * English is the universal fallback, not just the language for English
 * speakers (talents-ai-score, report-i18n).
 *
 * Isolated change (talents-ai-score, report-i18n): this does NOT touch
 * src/maturity.js or src/detectors.js/src/scanner.js. `maturity.name` /
 * `maturity.next` (Spanish) remain untouched because src/share.js consumes
 * them as-is in the payload (maturity.name -> levelName). Here translation
 * happens by an already-existing STABLE KEY:
 *   - maturity level -> maturity.key ('none'|'exploring'|...) and
 *     maturity.level (0-4), both already returned by maturity.js unchanged.
 *   - tool category -> the stable key (AGENTIC_CLI, AI_EDITOR...) is
 *     resolved from the very `CATEGORIES` catalog that detectors.js ALREADY
 *     exports, by inverting its key->Spanish-text map (see categoryLabel
 *     below). Nothing is added or changed in detectors.js: only what it
 *     already exposes is read.
 *
 * Extension (talents-ai-score, ADR-007): the `consent` catalog below covers
 * the disclosure + consent + email-management copy used by
 * src/consent-flow.js and bin/report.js's one-shot consent commands. Unlike
 * the original report-i18n note above (which scoped this file to report
 * rendering only), the consent/disclosure flow is intentionally localized
 * too — GDPR-adjacent copy shouldn't default to a language the talent may
 * not read. It reuses the same `detectReportLang()` entry point.
 */

const catalogs = {
  es: {
    categories: {
      AGENTIC_CLI: 'CLI agéntica',
      AI_EDITOR: 'Editor con IA',
      IDE_ASSISTANT: 'Asistente en IDE',
      COMPLETION: 'Autocompletado',
      AI_TERMINAL: 'Terminal con IA',
    },
    levelNames: {
      none: 'Sin rastro de IA',
      exploring: 'Explorando',
      integrated: 'Integrado',
      power: 'Power user',
      orchestrator: 'Orquestador',
    },
    nextSteps: {
      0: 'Instala una herramienta de IA (Claude Code, Cursor o Copilot) y pruébala en un proyecto real.',
      1: 'Añade un fichero de instrucciones al proyecto (CLAUDE.md, .cursorrules o copilot-instructions.md) para dar contexto persistente.',
      2: 'Conecta un servidor MCP o crea reglas/comandos propios para que la IA acceda a tus datos y flujos.',
      3: 'Combina una CLI agéntica con MCP y skills/comandos propios; automatiza una tarea recurrente de principio a fin.',
      4: 'Ya operas a nivel de orquestación: documenta tu setup y encadena agentes o ejecución en background.',
    },
    recency: {
      today: 'hoy',
      this_week: 'esta semana',
      this_month: 'este mes',
      this_quarter: 'este trimestre',
      stale: 'desactualizado',
    },
    terminal: {
      brandSub: 'perfil de uso de IA',
      toolsDetected: (n, total) => `${n}/${total} herramientas detectadas`,
      level: (level, name) => `Nivel ${level} · ${name}`,
      detectedHeading: 'Detectadas',
      none: '(ninguna)',
      notDetected: (names) => `No detectadas: ${names}`,
      environment: 'Entorno',
      editors: 'editores',
      noEditorsDetected: 'ninguno detectado',
      nextStep: 'Siguiente paso',
      files: (n) => `${n} ${n === 1 ? 'fichero' : 'ficheros'}`,
      lastModified: (label) => `última modificación: ${label}`,
    },
    html: {
      lang: 'es',
      title: (level) => `AI Footprint · Nivel ${level}`,
      h1: 'Tu perfil de uso de IA',
      sub: 'Un vistazo local a qué herramientas de IA tienes y cuánto las has configurado.',
      levelOf: (level) => `Nivel ${level} de 4`,
      // Suffix only: the number is already bolded separately in the markup
      // (see render-html.js), so we avoid duplicating/parsing the translated string.
      detectedSuffix: (total) => `de ${total} herramientas detectadas`,
      maturity: 'Madurez',
      tools: 'Herramientas',
      notDetected: 'no detectada',
      configIntensity: 'intensidad de configuración',
      files: (n) => `${n}&nbsp;${n === 1 ? 'fichero' : 'ficheros'}`,
      lastModified: (dateStr) => `última modificación: ${dateStr}`,
      environment: 'Entorno',
      platform: 'Plataforma',
      architecture: 'Arquitectura',
      installedEditors: 'Editores instalados',
      noEditorsDetected: 'ninguno detectado',
      nextStep: 'Siguiente paso',
      privacyNote:
        'Este informe se ha generado en local. Solo registra qué herramientas '
        + 'existen, cuántas configuraciones tienes y tu nivel: nunca el contenido '
        + 'de tus ficheros, rutas ni credenciales.',
      metaLine: (dateStr, anonId, platform) =>
        `Generado ${dateStr} · id anónimo <code>${anonId}</code> · plataforma ${platform}`,
      rawData: 'Ver los datos exactos de este informe (JSON)',
    },
    cli: {
      saved: (dir) => `Guardado en ${dir}`,
      useHtmlHint: 'Usa --html para abrir el dashboard visual.',
      tempDashboard: (file) => `Dashboard temporal: ${file}`,
    },
    consent: {
      disclosureTitle: 'Antes de continuar: qué pasa con tu informe',
      sendsHeading: 'SI ACEPTAS, esto se envía:',
      sendsList: [
        'Nivel (0-4) y puntuación (0-100)',
        'Categorías y lista de herramientas detectadas',
        'Conteos y booleanos derivados (profundidad de configuración)',
        'Recencia de configuración (fecha de última modificación de ficheros de setup, no de tu actividad)',
        'El correo que introduzcas (para vincular el informe a tu perfil de Talent, si existe)',
      ],
      neverSendsHeading: 'NUNCA se envía:',
      neverSendsList: [
        'El contenido de tus ficheros',
        'Rutas absolutas de tu sistema',
        'Variables de entorno ni credenciales',
        'Historiales de shell ni logs de herramientas',
      ],
      purpose: 'Propósito: entender la adopción de IA en el pool de talento de Shakers.',
      indicativeNotice: 'Este dato es indicativo, no verificado (el correo no se comprueba).',
      revocableNotice: 'Es revocable en cualquier momento con: ai-footprint --consent-revoke',
      legalPlaceholder: '[PENDIENTE DE REVISIÓN LEGAL: texto de aviso RGPD a redactar por un experto legal/laboral antes de activar el envío contra talentos reales — ADR-007]',
      consentQuestion: '¿Aceptas enviar este informe? (s/n):',
      invalidAnswer: 'Respuesta no reconocida. Responde "s" (sí) o "n" (no).',
      emailPrompt: 'Introduce tu correo:',
      invalidEmail: 'Correo no válido, inténtalo de nuevo.',
      notObtained: 'No se ha podido registrar tu respuesta; se te volverá a preguntar la próxima vez.',
      deniedSaved: 'Entendido, no se enviará nada. Puedes cambiar de opinión más adelante volviendo a ejecutar el comando.',
      grantedSaved: (email) => `Gracias. A partir de ahora tu informe se enviará automáticamente (correo: ${email}, máx. 1 vez por hora).`,
      status: {
        heading: 'Estado del consentimiento',
        decisionGranted: 'Decisión: concedido (granted)',
        decisionDenied: 'Decisión: rechazado (denied)',
        decisionNone: 'Decisión: sin decisión todavía',
        email: (value) => `Correo: ${value || '(sin correo)'}`,
        lastSentAt: (value) => `Último envío: ${value || '(nunca)'}`,
      },
      revoked: 'Consentimiento revocado. No se enviarán más informes automáticamente.',
      emailChanged: (email) => `Correo actualizado a ${email}. Se usará en el próximo envío.`,
      emailInvalidCli: 'Correo no válido. Uso: ai-footprint --consent-email tu@correo.com',
    },
  },
  en: {
    categories: {
      AGENTIC_CLI: 'Agentic CLI',
      AI_EDITOR: 'AI editor',
      IDE_ASSISTANT: 'IDE assistant',
      COMPLETION: 'Autocomplete',
      AI_TERMINAL: 'AI terminal',
    },
    levelNames: {
      none: 'No AI footprint',
      exploring: 'Exploring',
      integrated: 'Integrated',
      power: 'Power user',
      orchestrator: 'Orchestrator',
    },
    nextSteps: {
      0: 'Install an AI tool (Claude Code, Cursor or Copilot) and try it on a real project.',
      1: 'Add an instructions file to the project (CLAUDE.md, .cursorrules or copilot-instructions.md) to give it persistent context.',
      2: 'Connect an MCP server or create your own rules/commands so the AI can reach your data and workflows.',
      3: 'Combine an agentic CLI with MCP and your own skills/commands; automate a recurring task end to end.',
      4: 'You already operate at orchestration level: document your setup and chain agents or background runs.',
    },
    recency: {
      today: 'today',
      this_week: 'this week',
      this_month: 'this month',
      this_quarter: 'this quarter',
      stale: 'outdated',
    },
    terminal: {
      brandSub: 'AI usage profile',
      toolsDetected: (n, total) => `${n}/${total} tools detected`,
      level: (level, name) => `Level ${level} · ${name}`,
      detectedHeading: 'Detected',
      none: '(none)',
      notDetected: (names) => `Not detected: ${names}`,
      environment: 'Environment',
      editors: 'editors',
      noEditorsDetected: 'none detected',
      nextStep: 'Next step',
      files: (n) => `${n} ${n === 1 ? 'file' : 'files'}`,
      lastModified: (label) => `last modified: ${label}`,
    },
    html: {
      lang: 'en',
      title: (level) => `AI Footprint · Level ${level}`,
      h1: 'Your AI usage profile',
      sub: 'A local snapshot of which AI tools you have and how deeply you have configured them.',
      levelOf: (level) => `Level ${level} of 4`,
      detectedSuffix: (total) => `of ${total} tools detected`,
      maturity: 'Maturity',
      tools: 'Tools',
      notDetected: 'not detected',
      configIntensity: 'configuration intensity',
      files: (n) => `${n}&nbsp;${n === 1 ? 'file' : 'files'}`,
      lastModified: (dateStr) => `last modified: ${dateStr}`,
      environment: 'Environment',
      platform: 'Platform',
      architecture: 'Architecture',
      installedEditors: 'Installed editors',
      noEditorsDetected: 'none detected',
      nextStep: 'Next step',
      privacyNote:
        'This report was generated locally. It only records which tools exist, '
        + 'how many configurations you have and your level: never the content of '
        + 'your files, paths or credentials.',
      metaLine: (dateStr, anonId, platform) =>
        `Generated ${dateStr} · anonymous id <code>${anonId}</code> · platform ${platform}`,
      rawData: "View this report's exact data (JSON)",
    },
    cli: {
      saved: (dir) => `Saved to ${dir}`,
      useHtmlHint: 'Use --html to open the visual dashboard.',
      tempDashboard: (file) => `Temporary dashboard: ${file}`,
    },
    consent: {
      disclosureTitle: 'Before continuing: what happens with your report',
      sendsHeading: 'IF YOU ACCEPT, this is sent:',
      sendsList: [
        'Level (0-4) and score (0-100)',
        'Categories and the list of detected tools',
        'Derived counts and booleans (configuration depth)',
        'Setup recency (last-modified date of setup config files, not of your activity)',
        'The email you type in (to link the report to your Talent profile, if one exists)',
      ],
      neverSendsHeading: 'NEVER sent:',
      neverSendsList: [
        'The content of your files',
        'Absolute paths on your system',
        'Environment variables or credentials',
        'Shell history or tool logs',
      ],
      purpose: 'Purpose: understand AI adoption across the Shakers talent pool.',
      indicativeNotice: 'This data is indicative, not verified (the email is not checked).',
      revocableNotice: 'It is revocable at any time with: ai-footprint --consent-revoke',
      legalPlaceholder: '[PENDING LEGAL REVIEW: GDPR notice text to be drafted by a legal/labor expert before enabling sending against real talents — ADR-007]',
      consentQuestion: 'Do you accept sending this report? (y/n):',
      invalidAnswer: 'Answer not recognized. Reply "y" (yes) or "n" (no).',
      emailPrompt: 'Enter your email:',
      invalidEmail: 'Invalid email, try again.',
      notObtained: "Couldn't record your answer; you'll be asked again next time.",
      deniedSaved: 'Understood, nothing will be sent. You can change your mind later by running the command again.',
      grantedSaved: (email) => `Thanks. From now on your report will be sent automatically (email: ${email}, max. once per hour).`,
      status: {
        heading: 'Consent status',
        decisionGranted: 'Decision: granted',
        decisionDenied: 'Decision: denied',
        decisionNone: 'Decision: no decision yet',
        email: (value) => `Email: ${value || '(none)'}`,
        lastSentAt: (value) => `Last sent: ${value || '(never)'}`,
      },
      revoked: 'Consent revoked. No more reports will be sent automatically.',
      emailChanged: (email) => `Email updated to ${email}. It will be used on the next send.`,
      emailInvalidCli: 'Invalid email. Usage: ai-footprint --consent-email you@example.com',
    },
  },
};

// Reverse map {Spanish text -> stable key}, built from the CATEGORIES
// catalog that detectors.js ALREADY exports (key -> Spanish text).
// detectors.js is not touched: only what it already exposes is read, so we
// can translate by key instead of by the Spanish string consumed by the
// scanner/HTML unchanged.
const CATEGORY_KEY_BY_LABEL_ES = Object.fromEntries(
  Object.entries(CATEGORIES).map(([key, label]) => [label, key]),
);

// Translates a tool's `category` (always in Spanish, as produced by the
// scanner) to the stable CATEGORIES key and from there to the requested
// language's catalog. If detectors.js were to add a new category in the
// future without registering its translation here, it degrades to the
// Spanish text as-is (never breaks rendering; the gap would be flagged for
// review, not hidden).
function categoryLabel(lang, categoryEs) {
  const key = CATEGORY_KEY_BY_LABEL_ES[categoryEs];
  const translated = key && catalogs[getResolvedLang(lang)].categories[key];
  return translated || categoryEs;
}

function getResolvedLang(lang) {
  return lang === 'es' || lang === 'en' ? lang : 'en';
}

// Resolution rule: only 'es' and 'en' supported. Any code that doesn't
// start with 'es' falls back to English (universal fallback).
function resolveLang(langCode) {
  return langCode && /^es/i.test(langCode) ? 'es' : 'en';
}

// Single entry point for report callers (bin/report.js): detects the OS
// language (see locale.js) and already returns the resolved catalog code
// ('es' or 'en').
function detectReportLang(env = process.env) {
  return resolveLang(detectLangCode(env));
}

function getCatalog(lang) {
  return catalogs[getResolvedLang(lang)];
}

module.exports = { detectReportLang, resolveLang, getCatalog, categoryLabel };
