'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/*
 * Persistencia SIEMPRE en el home del usuario, nunca en el directorio del
 * proyecto escaneado. Así el informe no se cuela en un commit (sería una fuga,
 * porque lista tu setup) y no ensucia los repos del talento. Guarda:
 *   - latest.json  (se sobrescribe)
 *   - report.html  (dashboard, se sobrescribe)
 *   - history/<fecha>.json  (histórico para ver evolución)
 */

function baseDir() {
  return path.join(os.homedir(), '.config', 'ai-footprint');
}

function save(report, html) {
  const dir = baseDir();
  const histDir = path.join(dir, 'history');
  fs.mkdirSync(histDir, { recursive: true });

  const latest = path.join(dir, 'latest.json');
  const htmlPath = path.join(dir, 'report.html');
  const stamp = report.generatedAt.slice(0, 10);
  const hist = path.join(histDir, `${stamp}.json`);

  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(latest, json);
  fs.writeFileSync(hist, json);
  if (html) fs.writeFileSync(htmlPath, html);

  return { dir, latest, htmlPath, hist };
}

module.exports = { save, baseDir };
