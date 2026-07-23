'use strict';

/*
 * graph-assemble.js — turn the LLM's analysis graph ({nodes,edges}) into the
 * full foglamp CONTRACT (version/project/stats/topX/graph), validated + capped.
 * Reuses graph-generator's frozen constants (KINDS/EDGE_KINDS/CAPS/clampStr) so
 * validation stays in one place. stats + topModels/topTools/topIntegrations are
 * DERIVED here from the node kinds (the LLM returns only nodes+edges).
 */

const { KINDS, EDGE_KINDS, CAPS, clampStr } = require('./graph-generator');

function pickTop(nodes, kind, cap) {
  return nodes
    .filter((n) => n.kind === kind)
    .slice(0, cap)
    .map((n) => ({ id: n.id, label: n.label, ...(n.domain ? { domain: n.domain } : {}) }));
}

/*
 * assembleContract(project, { nodes, edges }) -> foglamp contract | null
 * Returns null when there are no usable nodes (caller then degrades).
 */
function assembleContract(project, graph) {
  const inNodes = (graph && Array.isArray(graph.nodes)) ? graph.nodes : [];
  const inEdges = (graph && Array.isArray(graph.edges)) ? graph.edges : [];

  const nodes = [];
  const seen = new Set();
  for (const n of inNodes) {
    if (nodes.length >= CAPS.nodes) break;
    if (!n || !n.id || seen.has(n.id) || !KINDS.has(n.kind)) continue;
    seen.add(n.id);
    nodes.push({
      id: n.id,
      label: clampStr(n.label || n.id, CAPS.label),
      kind: n.kind,
      ...(n.sub ? { sub: clampStr(n.sub, CAPS.sub) } : {}),
      ...(n.domain ? { domain: String(n.domain) } : {}),
      ...(n.group ? { group: clampStr(n.group, CAPS.label) } : {}),
      ...(n.detail ? { detail: clampStr(n.detail, CAPS.detail) } : {}),
      ...(n.sourceRef ? { sourceRef: String(n.sourceRef) } : {}),
    });
  }
  if (!nodes.length) return null;

  const edges = [];
  const eseen = new Set();
  for (const e of inEdges) {
    if (edges.length >= CAPS.edges) break;
    if (!e || !seen.has(e.from) || !seen.has(e.to) || e.from === e.to) continue;
    const kind = EDGE_KINDS.has(e.kind) ? e.kind : 'calls';
    const key = `${e.from}>${e.to}>${kind}`;
    if (eseen.has(key)) continue;
    eseen.add(key);
    edges.push({ from: e.from, to: e.to, kind, ...(e.label ? { label: clampStr(e.label, CAPS.edgeLabel) } : {}) });
  }

  const stats = {
    agents: nodes.filter((n) => n.kind === 'agent').length,
    models: nodes.filter((n) => n.kind === 'model').length,
    tools: nodes.filter((n) => n.kind === 'tool').length,
    integrations: nodes.filter((n) => n.kind === 'external').length,
  };

  return {
    version: 1,
    project: {
      name: clampStr(project.name, 60),
      slug: project.slug,
      ...(project.tagline ? { tagline: clampStr(project.tagline, 120) } : {}),
      date: project.date || new Date().toISOString().slice(0, 10),
    },
    stats,
    topModels: pickTop(nodes, 'model', CAPS.topModels),
    topTools: pickTop(nodes, 'tool', CAPS.topTools),
    topIntegrations: pickTop(nodes, 'external', CAPS.topIntegrations),
    graph: { nodes, edges },
  };
}

module.exports = { assembleContract };
