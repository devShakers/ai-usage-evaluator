#!/usr/bin/env node
'use strict';

/*
 * `map` — materializes and OPENS the LOCAL report (graph protagonist, v2). This
 * is the FULL report kept by the talent: the interactive AI/codebase graph as
 * the hero, with footprint + certifications as toggleable side drawers.
 *
 * Split from the old single `report` command (see docs/graph-report.md):
 *   map    -> LOCAL report  (this file; graph hero, full detail)
 *   sheet  -> SHAREABLE report (footprint + certs, no graph; = former `report`)
 *
 * Data source: the foglamp graph CONTRACT for the project. Today it is read
 * from `<root>/.foglamp/graph.json` (or `.foglamp/scan.json`), the artifact the
 * hybrid generator (src/graph-generator.js) produces. Wiring the generator to
 * the LIVE footprint scan (detector -> scan adapter + optional Gemini flow
 * pass) is the next integration; until then `map` renders whatever contract is
 * present and prints an actionable message when there is none.
 *
 * ZERO-network at view time: favicons are embedded as data: URIs here, at
 * generation time (best-effort; `--offline` skips it -> monogram fallback).
 * Localized CLI copy is inline (es/en) so we don't perturb the i18n catalog /
 * its parity test; the report page itself follows the run language.
 */

const fs = require('fs');
const path = require('path');
const { detectReportLang } = require('../src/i18n');
const { renderGraphReport } = require('../src/render-graph');
const { embedFavicons } = require('../src/favicon-embed');
const { openPath } = require('../src/open-file');
const { oscLink } = require('../src/osc-link');
const { pathToFileURL } = require('url');

const VALID_LANGS = new Set(['es', 'en']);

const COPY = {
  es: {
    help: 'map — abre el report LOCAL (grafo protagonista + footprint y certificaciones en paneles). Uso: map [--root <dir>] [--lang es|en] [--offline] [--no-open]',
    noData: 'No hay grafo para este proyecto todavía. Genera el contrato (.foglamp/graph.json) o ejecuta footprint primero.',
    error: 'No se pudo generar el report LOCAL.',
    ready: (link) => `Report LOCAL listo: ${link}`,
    opening: 'Abriendo en el navegador…',
  },
  en: {
    help: 'map — open the LOCAL report (graph hero + footprint & certifications as drawers). Usage: map [--root <dir>] [--lang es|en] [--offline] [--no-open]',
    noData: 'No graph for this project yet. Generate the contract (.foglamp/graph.json) or run footprint first.',
    error: 'Could not generate the LOCAL report.',
    ready: (link) => `LOCAL report ready: ${link}`,
    opening: 'Opening in your browser…',
  },
};

function parseArgs(argv) {
  const o = { root: null, lang: null, open: true, offline: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = argv[++i];
    else if (a.startsWith('--root=')) o.root = a.slice(7);
    else if (a === '--lang') o.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = VALID_LANGS.has(v) ? v : null; }
    else if (a === '--no-open') o.open = false;
    else if (a === '--offline') o.offline = true;
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

function findContract(root) {
  for (const rel of ['.foglamp/graph.json', '.foglamp/scan.json']) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* fallthrough */ }
    }
  }
  return null;
}

// domains referenced by the graph nodes + topX, for favicon embedding
function collectDomains(contract) {
  const set = new Set();
  const add = (o) => { if (o && o.domain) set.add(o.domain); };
  (contract.graph && contract.graph.nodes || []).forEach(add);
  (contract.topModels || []).forEach(add);
  (contract.topIntegrations || []).forEach(add);
  return Array.from(set);
}

async function run(argv = process.argv.slice(2), { ask } = {}) { // eslint-disable-line no-unused-vars
  const o = parseArgs(argv);
  const lang = o.lang || detectReportLang();
  const c = COPY[lang] || COPY.en;

  if (o.help) { process.stdout.write(`\n  ${c.help}\n\n`); return; }

  const root = path.resolve(o.root || process.cwd());
  const contract = findContract(root);
  if (!contract || !contract.graph) { process.stdout.write(`\n  ${c.noData}\n\n`); return; }

  let outPath;
  try {
    const favicons = o.offline ? null : await embedFavicons(collectDomains(contract), { enabled: true });
    const html = renderGraphReport(
      {
        version: contract.version || 1,
        project: contract.project,
        stats: contract.stats,
        topModels: contract.topModels || [],
        topTools: contract.topTools || [],
        topIntegrations: contract.topIntegrations || [],
        graph: contract.graph,
        footprint: contract.footprint || null,
        certs: contract.certs || null,
        favicons,
      },
      { lang }
    );
    const dir = path.join(root, '.foglamp');
    fs.mkdirSync(dir, { recursive: true });
    outPath = path.join(dir, 'report.html');
    fs.writeFileSync(outPath, html);
  } catch {
    process.stdout.write(`\n  ${c.error}\n\n`);
    return;
  }

  const opened = o.open ? openPath(outPath) : false;
  process.stdout.write(`\n  ${c.ready(oscLink(pathToFileURL(outPath).href))}\n`);
  if (opened) process.stdout.write(`  ${c.opening}\n`);
  process.stdout.write('\n');
}

module.exports = { run, parseArgs, findContract, collectDomains };

if (require.main === module) {
  run();
}
