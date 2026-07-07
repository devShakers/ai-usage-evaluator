'use strict';

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

const RECENCY_LABEL = {
  today: 'hoy',
  this_week: 'esta semana',
  this_month: 'este mes',
  this_quarter: 'este trimestre',
  stale: 'sin tocar hace tiempo',
};

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

function renderTerminal(report, maturity) {
  const lines = [];
  const p = (s = '') => lines.push(s);

  p();
  p(`${c.bold}${c.cyan}  AI FOOTPRINT${c.reset}${c.gray}  ·  perfil de uso de IA${c.reset}`);
  p(`${c.gray}  ${new Date(report.generatedAt).toLocaleString()}  ·  ${report.tools.filter(t=>t.detected).length}/${report.tools.length} herramientas detectadas${c.reset}`);
  p();

  // Nivel
  p(`  ${c.bold}${c.white}Nivel ${maturity.level} · ${maturity.name}${c.reset}`);
  p(`  ${c.cyan}${bar(maturity.score)}${c.reset} ${c.dim}${maturity.score}/100${c.reset}`);
  p();

  // Detectadas
  p(`  ${c.bold}Detectadas${c.reset}`);
  const detected = report.tools.filter((t) => t.detected);
  if (detected.length === 0) {
    p(`  ${c.gray}  (ninguna)${c.reset}`);
  }
  for (const t of detected) {
    const depthBits = Object.entries(t.depth)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
    const extra = depthBits ? `${c.dim} — ${depthBits}${c.reset}` : '';
    const version = t.version ? `${c.dim} v${t.version}${c.reset}` : '';
    const footprint =
      t.footprint && (t.footprint.files > 0 || t.footprint.bytes > 0)
        ? `${c.dim} · ${t.footprint.files} ficheros, ${formatBytes(t.footprint.bytes)}${c.reset}`
        : '';
    const recency =
      t.recency && t.recency.bucket
        ? `${c.dim} · última modificación: ${RECENCY_LABEL[t.recency.bucket] || t.recency.bucket}${c.reset}`
        : '';
    p(`  ${c.green}●${c.reset} ${t.name}${version} ${c.gray}(${t.category})${c.reset}${extra}`);
    if (footprint || recency) p(`    ${footprint}${recency}`);
  }
  p();

  // No detectadas
  const missing = report.tools.filter((t) => !t.detected);
  if (missing.length) {
    p(`  ${c.gray}No detectadas: ${missing.map((t) => t.name).join(', ')}${c.reset}`);
    p();
  }

  // Entorno
  if (report.environment) {
    const env = report.environment;
    const editors = env.editorsInstalled && env.editorsInstalled.length
      ? env.editorsInstalled.join(', ')
      : 'ninguno detectado';
    p(`  ${c.bold}Entorno${c.reset}`);
    p(`  ${c.gray}${env.platform}/${env.arch} · Node ${env.nodeVersion} · editores: ${editors}${c.reset}`);
    p();
  }

  // Siguiente paso
  p(`  ${c.bold}${c.yellow}Siguiente paso${c.reset}`);
  p(`  ${c.white}${maturity.next}${c.reset}`);
  p();

  return lines.join('\n');
}

module.exports = { renderTerminal };
