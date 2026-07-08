'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/*
 * Persistence ALWAYS in the user's home directory, never in the scanned
 * project's directory. This way the report doesn't slip into a commit
 * (that would be a leak, since it lists your setup) and doesn't clutter the
 * talent's repos. Saves:
 *   - latest.json  (overwritten each time)
 *   - report.html  (dashboard, overwritten each time)
 *   - history/<date>.json  (history to see evolution over time)
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
