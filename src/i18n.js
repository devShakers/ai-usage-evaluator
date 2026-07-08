'use strict';

const { detectLangCode } = require('./locale');
const { CATEGORIES } = require('./detectors');

/*
 * Localización del informe (HTML + terminal) y de los avisos del CLI
 * relacionados con el informe. Solo dos idiomas soportados: 'es' y 'en'.
 * Regla de resolución: cualquier idioma que NO empiece por 'es' cae en
 * inglés — inglés es el fallback universal, no solo el idioma para
 * angloparlantes (talents-ai-score, report-i18n).
 *
 * Cambio aislado (talents-ai-score, report-i18n): esto NO toca
 * src/maturity.js ni src/detectors.js/src/scanner.js. `maturity.name` /
 * `maturity.next` (español) siguen intactos porque src/share.js los consume
 * tal cual en el payload (maturity.name -> levelName). Aquí se traduce por
 * CLAVE ESTABLE ya existente:
 *   - nivel de madurez -> maturity.key ('none'|'exploring'|...) y
 *     maturity.level (0-4), ambos ya devueltos por maturity.js sin cambios.
 *   - categoría de herramienta -> se resuelve la clave estable
 *     (AGENTIC_CLI, AI_EDITOR...) a partir del propio catálogo `CATEGORIES`
 *     que detectors.js YA exporta, invirtiendo su mapa clave->texto-en-español
 *     (ver categoryLabel más abajo). No se añade ni se cambia nada en
 *     detectors.js: solo se lee lo que ya expone.
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
      // Solo el sufijo: el número va ya en negrita aparte en el markup (ver
      // render-html.js), así se evita duplicar/parsear el string traducido.
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
  },
};

// Mapa inverso {texto en español -> clave estable}, construido a partir del
// catálogo CATEGORIES que detectors.js YA exporta (clave -> texto en
// español). No se toca detectors.js: solo se lee lo que ya expone, para poder
// traducir por clave en vez de por el string en español que consume el
// scanner/HTML sin cambios.
const CATEGORY_KEY_BY_LABEL_ES = Object.fromEntries(
  Object.entries(CATEGORIES).map(([key, label]) => [label, key]),
);

// Traduce el `category` de una tool (siempre en español, tal como lo produce
// el scanner) a la clave estable de CATEGORIES y de ahí al catálogo del
// idioma pedido. Si en el futuro detectors.js añadiera una categoría nueva
// sin registrar aquí su traducción, se degrada al texto en español tal cual
// (nunca rompe el render; el gap quedaría anotado para revisión, no oculto).
function categoryLabel(lang, categoryEs) {
  const key = CATEGORY_KEY_BY_LABEL_ES[categoryEs];
  const translated = key && catalogs[getResolvedLang(lang)].categories[key];
  return translated || categoryEs;
}

function getResolvedLang(lang) {
  return lang === 'es' || lang === 'en' ? lang : 'en';
}

// Regla de resolución: solo 'es' y 'en' soportados. Cualquier código que no
// empiece por 'es' cae en inglés (fallback universal).
function resolveLang(langCode) {
  return langCode && /^es/i.test(langCode) ? 'es' : 'en';
}

// Punto de entrada único para los llamadores del informe (bin/report.js):
// detecta el idioma del SO (ver locale.js) y devuelve ya el código de
// catálogo resuelto ('es' o 'en').
function detectReportLang(env = process.env) {
  return resolveLang(detectLangCode(env));
}

function getCatalog(lang) {
  return catalogs[getResolvedLang(lang)];
}

module.exports = { detectReportLang, resolveLang, getCatalog, categoryLabel };
