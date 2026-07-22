#!/usr/bin/env node
'use strict';

/*
 * `map` — materializes and OPENS the LOCAL report (graph protagonist, v2): the
 * interactive AI/codebase graph as the hero + footprint & certs as drawers.
 *
 * By DEFAULT it builds the graph from a LIVE footprint scan of the given root
 * (src/graph-scan.js — the same deterministic detectors `footprint` uses),
 * then enriches it with an LLM pass (src/graph-infer-client.js → the backend
 * `graph-inference` endpoint) for the flows/services/stores we can't detect
 * statically. The enrichment is NON-authoritative and best-effort: no endpoint,
 * or any failure, degrades cleanly to the deterministic graph (never crashes,
 * never fabricates). See docs/graph-report.md.
 *
 * Flags: --root <dir> --lang es|en --offline (no favicon fetch) --no-llm
 * (deterministic only) --contract <path> (render a pre-made foglamp contract
 * JSON instead of scanning) --stats (print enrichment counts + cost) --no-open.
 *
 * ZERO-network at view time: favicons embedded as data: URIs here. Localized
 * CLI copy is inline (es/en) so the i18n catalog / its parity test are untouched.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { detectReportLang } = require('../src/i18n');
const { buildGraphScan } = require('../src/graph-scan');
const { generateGraph } = require('../src/graph-generator');
const { makeGraphInferLlm } = require('../src/graph-infer-client');
const { getGraphInferenceEndpoint } = require('../src/config');
const { renderGraphReport } = require('../src/render-graph');
const { embedFavicons } = require('../src/favicon-embed');
const { openPath } = require('../src/open-file');
const { oscLink } = require('../src/osc-link');

const VALID_LANGS = new Set(['es', 'en']);
const LLM_NODE_KINDS = new Set(['entry', 'cron', 'service', 'store']);

const COPY = {
  es: {
    help: 'map — abre el report LOCAL (grafo protagonista + footprint y certificaciones en paneles). Uso: map [--root <dir>] [--lang es|en] [--offline] [--no-llm] [--contract <path>] [--stats] [--no-open]',
    error: 'No se pudo generar el report LOCAL.',
    ready: (link) => `Report LOCAL listo: ${link}`,
    opening: 'Abriendo en el navegador…',
    degraded: 'Enriquecimiento IA no disponible (endpoint sin configurar o fallo) — grafo determinista.',
    stats: (added, edges, cost, ms) =>
      `Enriquecimiento IA: +${added} nodos, +${edges} edges de flujo · ${cost} · ${ms}ms`,
  },
  en: {
    help: 'map — open the LOCAL report (graph hero + footprint & certifications as drawers). Usage: map [--root <dir>] [--lang es|en] [--offline] [--no-llm] [--contract <path>] [--stats] [--no-open]',
    error: 'Could not generate the LOCAL report.',
    ready: (link) => `LOCAL report ready: ${link}`,
    opening: 'Opening in your browser…',
    degraded: 'AI enrichment unavailable (endpoint unset or failed) — deterministic graph.',
    stats: (added, edges, cost, ms) =>
      `AI enrichment: +${added} nodes, +${edges} flow edges · ${cost} · ${ms}ms`,
  },
};

function parseArgs(argv) {
  const o = { root: null, lang: null, open: true, offline: false, llm: true, contract: null, stats: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = argv[++i];
    else if (a.startsWith('--root=')) o.root = a.slice(7);
    else if (a === '--lang') o.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = VALID_LANGS.has(v) ? v : null; }
    else if (a === '--contract') o.contract = argv[++i];
    else if (a.startsWith('--contract=')) o.contract = a.slice(11);
    else if (a === '--no-open') o.open = false;
    else if (a === '--offline') o.offline = true;
    else if (a === '--no-llm') o.llm = false;
    else if (a === '--stats') o.stats = true;
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

function collectDomains(contract) {
  const set = new Set();
  const add = (o) => { if (o && o.domain) set.add(o.domain); };
  ((contract.graph && contract.graph.nodes) || []).forEach(add);
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
  let contract;
  let footprint = null;
  const traces = [];

  try {
    if (o.contract) {
      // pre-made foglamp contract JSON (back-compat / demo) — no scan, no LLM
      contract = JSON.parse(fs.readFileSync(path.resolve(o.contract), 'utf8'));
      footprint = contract.footprint || null;
    } else {
      // LIVE: deterministic scan (adapter) + optional LLM enrichment
      const built = buildGraphScan(root);
      footprint = built.footprint;
      const llm = o.llm
        ? makeGraphInferLlm({ endpoint: getGraphInferenceEndpoint(), locale: lang })
        : null;
      contract = await generateGraph({ scan: built.scan, llm, onTrace: (e) => traces.push(e) });
    }
  } catch {
    process.stdout.write(`\n  ${c.error}\n\n`);
    return;
  }

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
        footprint,
        certs: contract.certs || null,
        favicons,
      },
      { lang }
    );
    const dir = path.join(root, '.ai-usage');
    fs.mkdirSync(dir, { recursive: true });
    outPath = path.join(dir, 'local-report.html');
    fs.writeFileSync(outPath, html);
  } catch {
    process.stdout.write(`\n  ${c.error}\n\n`);
    return;
  }

  const opened = o.open ? openPath(outPath) : false;
  process.stdout.write(`\n  ${c.ready(oscLink(pathToFileURL(outPath).href))}\n`);
  if (opened) process.stdout.write(`  ${c.opening}\n`);

  // enrichment stats / degrade note (live path only)
  if (!o.contract && o.llm) {
    const t = traces.find((x) => x.event === 'graph.infer');
    const added = (contract.graph.nodes || []).filter((n) => LLM_NODE_KINDS.has(n.kind)).length;
    const flowEdges = (contract.graph.edges || []).filter(
      (e) => e.kind === 'triggers' || e.kind === 'reads' || e.kind === 'writes',
    ).length;
    if (t && t.ok) {
      if (o.stats) {
        const cost = typeof t.costUsd === 'number' ? `$${t.costUsd.toFixed(4)}` : 'cost n/a';
        process.stdout.write(`  ${c.stats(added, flowEdges, cost, t.latencyMs || 0)}\n`);
      }
    } else {
      process.stdout.write(`  ${c.degraded}\n`);
    }
  }
  process.stdout.write('\n');
}

module.exports = { run, parseArgs, collectDomains };

if (require.main === module) {
  run();
}
