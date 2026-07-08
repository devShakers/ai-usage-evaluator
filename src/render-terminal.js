'use strict';

const { getCatalog, categoryLabel } = require('./i18n');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

function bar(score, width = 24) {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// `lang` ('es'|'en', ver src/i18n.js) decide el catálogo de texto. Los datos
// del informe (report/maturity) no cambian con el idioma, solo su copy.
// Nivel y categoría se traducen por CLAVE ESTABLE (maturity.key/level,
// categoría vía categoryLabel) sin tocar maturity.js/detectors.js — ver
// cabecera de src/i18n.js.
function renderTerminal(report, maturity, lang) {
  const t = getCatalog(lang);
  const lines = [];
  const p = (s = '') => lines.push(s);

  const levelName = t.levelNames[maturity.key] || maturity.name;
  const nextStep = t.nextSteps[maturity.level] || maturity.next;

  p();
  p(`${c.bold}${c.cyan}  AI FOOTPRINT${c.reset}${c.gray}  ·  ${t.terminal.brandSub}${c.reset}`);
  p(`${c.gray}  ${new Date(report.generatedAt).toLocaleString()}  ·  ${t.terminal.toolsDetected(report.tools.filter((x) => x.detected).length, report.tools.length)}${c.reset}`);
  p();

  // Nivel
  p(`  ${c.bold}${c.white}${t.terminal.level(maturity.level, levelName)}${c.reset}`);
  p(`  ${c.cyan}${bar(maturity.score)}${c.reset} ${c.dim}${maturity.score}/100${c.reset}`);
  p();

  // Detectadas
  p(`  ${c.bold}${t.terminal.detectedHeading}${c.reset}`);
  const detected = report.tools.filter((tool) => tool.detected);
  if (detected.length === 0) {
    p(`  ${c.gray}  ${t.terminal.none}${c.reset}`);
  }
  for (const tool of detected) {
    const depthBits = Object.entries(tool.depth)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    const extra = depthBits ? `${c.dim} — ${depthBits}${c.reset}` : '';
    const version = tool.version ? `${c.dim} v${tool.version}${c.reset}` : '';
    const footprint =
      tool.footprint && (tool.footprint.files > 0 || tool.footprint.bytes > 0)
        ? `${c.dim} · ${t.terminal.files(tool.footprint.files)}, ${formatBytes(tool.footprint.bytes)}${c.reset}`
        : '';
    const recency =
      tool.recency && tool.recency.bucket
        ? `${c.dim} · ${t.terminal.lastModified(t.recency[tool.recency.bucket] || tool.recency.bucket)}${c.reset}`
        : '';
    p(`  ${c.green}●${c.reset} ${tool.name}${version} ${c.gray}(${categoryLabel(lang, tool.category)})${c.reset}${extra}`);
    if (footprint || recency) p(`    ${footprint}${recency}`);
  }
  p();

  // No detectadas
  const missing = report.tools.filter((tool) => !tool.detected);
  if (missing.length) {
    p(`  ${c.gray}${t.terminal.notDetected(missing.map((tool) => tool.name).join(', '))}${c.reset}`);
    p();
  }

  // Entorno
  if (report.environment) {
    const env = report.environment;
    const editors = env.editorsInstalled && env.editorsInstalled.length
      ? env.editorsInstalled.join(', ')
      : t.terminal.noEditorsDetected;
    p(`  ${c.bold}${t.terminal.environment}${c.reset}`);
    p(`  ${c.gray}${env.platform}/${env.arch} · Node ${env.nodeVersion} · ${t.terminal.editors}: ${editors}${c.reset}`);
    p();
  }

  // Siguiente paso
  p(`  ${c.bold}${c.yellow}${t.terminal.nextStep}${c.reset}`);
  p(`  ${c.white}${nextStep}${c.reset}`);
  p();

  return lines.join('\n');
}

module.exports = { renderTerminal };
