'use strict';

/*
 * render-graph.js — the LOCAL report renderer (ADR: graph-report split).
 *
 * Productizes the approved visual spec (see mockup-report-v2.html, verified
 * with headless screenshots) into a self-contained HTML document whose HERO is
 * the interactive AI/codebase graph, with footprint + certifications as
 * toggleable side drawers.
 *
 * Design invariants (kept identical to the rest of the reports):
 *   - ZERO network AT VIEW TIME. The dagre layout engine is embedded inline in
 *     the template; favicons are inlined as data: URIs at GENERATION time (see
 *     favicon-embed.js) — the opened HTML never fetches anything.
 *   - Self-contained single .html (inline CSS/JS, no CDN, no @font-face).
 *   - Both themes (light Shakers default + dark foglamp feel) with a toggle.
 *   - prefers-reduced-motion respected.
 *
 * The heavy CSS/JS lives VERBATIM in src/templates/graph-report.html (the
 * verified mockup, templatized). This module only injects the data payload and
 * the run language — so the renderer and the mockup never diverge.
 *
 * Contract of `payload` (the foglamp graph contract + report extras): see
 * docs/graph-report.md and src/graph-generator.js (which produces `graph`).
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'graph-report.html');

// Loaded once; the template is a static asset shipped with the CLI.
let _template = null;
function template() {
  if (_template == null) _template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return _template;
}

/*
 * Build the full data object the template's client script consumes. Mirrors the
 * foglamp contract exactly (version/project/stats/topX/graph) plus the report
 * extras (footprint, certs, favicons). Missing pieces degrade gracefully:
 * empty footprint/certs => the drawer just shows nothing; no favicons => the
 * renderer falls back to colored monograms.
 */
function buildPayload({
  version = 1,
  project,
  stats,
  topModels = [],
  topTools = [],
  topIntegrations = [],
  graph,
  footprint = null,
  certs = null,
  favicons = null,
  degrade = null,
} = {}) {
  if (!project || !graph || !Array.isArray(graph.nodes)) {
    throw new Error('render-graph: payload requires project and graph.nodes');
  }
  return {
    version,
    project,
    stats: stats || {
      agents: graph.nodes.filter((n) => n.kind === 'agent').length,
      models: graph.nodes.filter((n) => n.kind === 'model').length,
      tools: topTools.length,
      integrations: topIntegrations.length,
    },
    topModels,
    topTools,
    topIntegrations,
    graph,
    // The template reads DATA.footprint / DATA.certs unconditionally; keep them
    // objects so the drawers render (empty) instead of throwing.
    footprint: footprint || emptyFootprint(),
    certs: certs || { agents: [], skills: [] },
    favicons: favicons || null,
    // When present, the template shows a LOUD banner so a reduced fallback graph
    // is never mistaken for the full codebase analysis. null on a normal run.
    degrade: degrade && degrade.banner ? { reason: String(degrade.reason || ''), banner: String(degrade.banner) } : null,
  };
}

function emptyFootprint() {
  return {
    score: 0,
    tier: { level: 0, key: 'none', name: '—', label: '—' },
    ladder: [
      { n: 0, name: 'Sin rastro de IA' },
      { n: 1, name: 'Explorando' },
      { n: 2, name: 'Integrado' },
      { n: 3, name: 'Power user' },
      { n: 4, name: 'Orquestador' },
    ],
    summary: '',
    tools: [],
    technologies: [],
  };
}

/*
 * renderGraphReport(payload, { lang }) -> full self-contained HTML string.
 * `payload` is either a raw foglamp contract + extras (see buildPayload) or an
 * already-built payload; we always normalize through buildPayload.
 */
function renderGraphReport(payload, { lang = 'es' } = {}) {
  const data = buildPayload(payload);
  const json = JSON.stringify(data)
    // keep the JSON safe inside a <script> block (escape angle brackets and
    // the two line separators that are illegal in a JS string literal)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return template()
    .replace('__DATA_INJECT__', () => json)
    .replace('__LANG__', lang === 'en' ? 'en' : 'es');
}

module.exports = { renderGraphReport, buildPayload };
