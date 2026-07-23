#!/usr/bin/env node
'use strict';

/*
 * `map` — materializes and OPENS the LOCAL report (graph protagonist, v2): the
 * interactive AI/codebase graph as the hero + footprint & certs as drawers.
 *
 * The GRAPH is a MAP OF WHAT THE REPO DOES (foglamp-style), produced by an
 * INTEGRATED LLM analysis of the code: src/repo-context.js collects a
 * content-free structural context (entrypoints, AI call-sites, provider/
 * integration imports, Prisma stores, crons, modules, deps) and the backend
 * `graph-inference` route (gemini-2.5-pro) assembles the whole foglamp graph;
 * src/graph-assemble.js validates/caps it and derives stats/topX. This REPLACES
 * the old footprint-derived base — footprint detection now feeds ONLY the
 * AI-usage drawer.
 *
 * Graceful degrade: no endpoint / --no-llm / any LLM failure => fall back to the
 * deterministic AI-agent subgraph (buildGraphScan + generateGraph). Never crashes,
 * never fabricates. See docs/graph-report.md.
 *
 * Flags: --root <dir> --lang es|en --offline (no favicon fetch) --no-llm
 * (skip analysis, deterministic agent graph) --contract <path> (render a
 * pre-made foglamp scan.json instead) --stats (print nodes/edges/latency) --no-open.
 *
 * ZERO-network at view time: favicons embedded as data: URIs here. Localized CLI
 * copy is inline (es/en) so the i18n catalog / its parity test are untouched.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { detectReportLang } = require('../src/i18n');
const { collectRepoContext } = require('../src/repo-context');
const { makeCodebaseAnalyzer } = require('../src/graph-infer-client');
const { assembleContract } = require('../src/graph-assemble');
const { buildGraphScan } = require('../src/graph-scan');
const { generateGraph } = require('../src/graph-generator');
const { getGraphInferenceEndpoint } = require('../src/config');
const { renderGraphReport } = require('../src/render-graph');
const { embedFavicons } = require('../src/favicon-embed');
const { loadState } = require('../src/report-store');
const { buildCertsPayload } = require('../src/graph-certs');
const { openPath } = require('../src/open-file');
const { oscLink } = require('../src/osc-link');
const { withStaticStatus, withPhasedSpinner } = require('../src/terminal-progress');

const VALID_LANGS = new Set(['es', 'en']);

const COPY = {
  es: {
    help: 'map — abre el report LOCAL (grafo del codebase por análisis IA + footprint y certificaciones en paneles). Uso: map [--root <dir>] [--lang es|en] [--offline] [--no-llm] [--contract <path>] [--stats] [--no-open]',
    error: 'No se pudo generar el report LOCAL.',
    ready: (link) => `Report LOCAL listo: ${link}`,
    opening: 'Abriendo en el navegador…',
    degradeReduced: (n) => `Mostrando vista REDUCIDA (subgrafo de agentes determinista, ${n} nodos) — NO es el grafo completo del codebase.`,
    stats: (n, e, ms) => `Análisis IA del codebase: ${n} nodos, ${e} edges · ${ms}ms`,
    collecting: 'Recogiendo contexto del repo…',
    // Rotating reassurance during the single long (~1 min) Pro analysis wait —
    // time-phased, not a real progress read (the call is opaque single-shot).
    phases: [
      'Analizando el código con IA…',
      'Identificando agentes y modelos…',
      'Mapeando flujos, stores e integraciones…',
      'Componiendo el grafo del codebase…',
    ],
  },
  en: {
    help: 'map — open the LOCAL report (codebase graph via AI analysis + footprint & certifications as drawers). Usage: map [--root <dir>] [--lang es|en] [--offline] [--no-llm] [--contract <path>] [--stats] [--no-open]',
    error: 'Could not generate the LOCAL report.',
    ready: (link) => `LOCAL report ready: ${link}`,
    opening: 'Opening in your browser…',
    degradeReduced: (n) => `Showing a REDUCED view (deterministic agent subgraph, ${n} nodes) — NOT the full codebase graph.`,
    stats: (n, e, ms) => `Codebase AI analysis: ${n} nodes, ${e} edges · ${ms}ms`,
    collecting: 'Collecting repo context…',
    // Rotating reassurance during the single long (~1 min) Pro analysis wait —
    // time-phased, not a real progress read (the call is opaque single-shot).
    phases: [
      'Analyzing the code with AI…',
      'Identifying agents and models…',
      'Mapping flows, stores and integrations…',
      'Composing the codebase graph…',
    ],
  },
};

// Loud, reason-specific fallback copy. `cli` is the prominent stderr warning;
// `banner` is the in-report banner text — so the reduced 4-node agent subgraph
// is NEVER mistaken for the real codebase graph (regression fix).
const DEGRADE = {
  es: {
    'no-endpoint': {
      cli: 'Análisis IA OMITIDO — endpoint no configurado. Define AI_FOOTPRINT_GRAPH_INFER_ENDPOINT (o el ingest) y reintenta.',
      banner: 'Vista REDUCIDA (solo agentes): el análisis IA del codebase no se ejecutó — endpoint no configurado. Este NO es el grafo completo.',
    },
    'analysis-failed': {
      cli: 'Análisis IA FALLÓ (endpoint inaccesible, rate-limit, o error del proveedor). Reintenta en un momento.',
      banner: 'Vista REDUCIDA (solo agentes): el análisis IA del codebase FALLÓ (inaccesible / rate-limit / error del proveedor). Este NO es el grafo completo — reintenta.',
    },
    'no-llm': {
      cli: 'Análisis IA desactivado (--no-llm).',
      banner: 'Vista REDUCIDA (solo agentes) por --no-llm. Este NO es el grafo completo del codebase.',
    },
  },
  en: {
    'no-endpoint': {
      cli: 'AI analysis SKIPPED — endpoint not configured. Set AI_FOOTPRINT_GRAPH_INFER_ENDPOINT (or the ingest) and retry.',
      banner: 'REDUCED view (agents only): the AI codebase analysis did not run — endpoint not configured. This is NOT the full graph.',
    },
    'analysis-failed': {
      cli: 'AI analysis FAILED (endpoint unreachable, rate-limited, or provider error). Retry in a moment.',
      banner: 'REDUCED view (agents only): the AI codebase analysis FAILED (unreachable / rate-limited / provider error). This is NOT the full graph — retry.',
    },
    'no-llm': {
      cli: 'AI analysis disabled (--no-llm).',
      banner: 'REDUCED view (agents only) due to --no-llm. This is NOT the full codebase graph.',
    },
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

// Deterministic fallback graph (AI-agent subgraph from detectors) when the LLM
// analysis is unavailable — never fabricated, just the little we can prove.
async function deterministicFallback(root) {
  const built = buildGraphScan(root);
  const contract = await generateGraph({ scan: built.scan, llm: null });
  return { contract, footprint: built.footprint };
}

async function run(argv = process.argv.slice(2), { ask } = {}) { // eslint-disable-line no-unused-vars
  const o = parseArgs(argv);
  const lang = o.lang || detectReportLang();
  const c = COPY[lang] || COPY.en;
  if (o.help) { process.stdout.write(`\n  ${c.help}\n\n`); return; }

  const root = path.resolve(o.root || process.cwd());
  let contract = null;
  let footprint = null;
  let analysis = null; // { latencyMs } when the LLM analysis produced the graph
  let degraded = false;
  let degradeReason = null; // 'no-llm' | 'no-endpoint' | 'analysis-failed'

  try {
    if (o.contract) {
      contract = JSON.parse(fs.readFileSync(path.resolve(o.contract), 'utf8'));
      footprint = contract.footprint || null;
    } else {
      // Footprint drawer ALWAYS from the live scan (AI-usage), independent of graph.
      try { footprint = buildGraphScan(root).footprint; } catch { footprint = null; }
      // GRAPH: integrated LLM codebase analysis. Feedback on stderr (stdout
      // stays clean for the report path + --stats): a static status for the
      // fast synchronous context collection, then a phased spinner rotating
      // reassuring copy through the one long, opaque Pro wait (~1 min).
      if (!o.llm) {
        degradeReason = 'no-llm';
      } else {
        const ctx = withStaticStatus(c.collecting, () => collectRepoContext(root));
        const endpoint = getGraphInferenceEndpoint();
        if (!endpoint) {
          degradeReason = 'no-endpoint'; // nothing to call — don't flash the spinner
        } else {
          const analyzer = makeCodebaseAnalyzer({ endpoint, locale: lang });
          const g = await withPhasedSpinner(c.phases, () => analyzer.analyze(ctx));
          if (g && Array.isArray(g.nodes) && g.nodes.length) {
            const built = assembleContract(ctx.project, g);
            if (built) { contract = built; analysis = { latencyMs: g.latencyMs }; }
          }
          // endpoint was set but the call/parse yielded nothing usable — the
          // analysis FAILED (unreachable, rate-limited, upstream 5xx, bad body).
          if (!contract) degradeReason = 'analysis-failed';
        }
      }
      // Degrade to the deterministic agent subgraph if analysis unavailable.
      if (!contract) {
        const fb = await deterministicFallback(root);
        contract = fb.contract;
        if (!footprint) footprint = fb.footprint;
        degraded = true;
      }
    }
  } catch {
    process.stdout.write(`\n  ${c.error}\n\n`);
    return;
  }

  // Certifications drawer: real data from report-store (same source as `report`).
  let certs = null;
  try {
    const project = (loadState().projects || {})[root];
    certs = project ? buildCertsPayload(project, lang) : null;
  } catch {
    certs = null;
  }
  if (!certs) {
    certs = {
      labels: { empty: lang === 'es' ? 'Aún no hay certificaciones para este proyecto. Ejecuta certify.' : 'No certifications for this project yet. Run certify.' },
      agents: [],
      skills: [],
    };
  }

  const degradeCopy = degraded && degradeReason ? (DEGRADE[lang] || DEGRADE.en)[degradeReason] : null;

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
        certs,
        favicons,
        // Loud in-report banner so a reduced fallback is never taken for the answer.
        degrade: degradeCopy ? { reason: degradeReason, banner: degradeCopy.banner } : null,
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

  if (!o.contract) {
    if (analysis) {
      if (o.stats) {
        const n = (contract.graph.nodes || []).length;
        const e = (contract.graph.edges || []).length;
        process.stdout.write(`  ${c.stats(n, e, analysis.latencyMs || 0)}\n`);
      }
    } else if (degradeCopy) {
      // LOUD, reason-specific warning on stderr (side channel) — never a quiet
      // one-liner mistaken for success. Names the reason + how to recover.
      const nodeCount = (contract.graph && contract.graph.nodes ? contract.graph.nodes.length : 0);
      process.stderr.write(`\n  ⚠  ${degradeCopy.cli}\n     ${c.degradeReduced(nodeCount)}\n`);
    }
  }
  process.stdout.write('\n');
}

module.exports = { run, parseArgs, collectDomains, deterministicFallback };

if (require.main === module) {
  run();
}
