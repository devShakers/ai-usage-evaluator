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
    p(`  ${c.green}●${c.reset} ${t.name} ${c.gray}(${t.category})${c.reset}${extra}`);
  }
  p();

  // No detectadas
  const missing = report.tools.filter((t) => !t.detected);
  if (missing.length) {
    p(`  ${c.gray}No detectadas: ${missing.map((t) => t.name).join(', ')}${c.reset}`);
    p();
  }

  // Siguiente paso
  p(`  ${c.bold}${c.yellow}Siguiente paso${c.reset}`);
  p(`  ${c.white}${maturity.next}${c.reset}`);
  p();

  return lines.join('\n');
}

module.exports = { renderTerminal };
