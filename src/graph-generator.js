'use strict';

// graph-generator.js — HYBRID generation of the foglamp graph contract.

const KINDS = new Set(['entry', 'cron', 'agent', 'model', 'tool', 'service', 'store', 'external']);
const LLM_INTRODUCIBLE = new Set(['entry', 'cron', 'service', 'store']);
const EDGE_KINDS = new Set(['calls', 'reads', 'writes', 'triggers']);

const CAPS = {
  nodes: 60,
  edges: 120,
  topModels: 3,
  topTools: 10,
  topIntegrations: 10,
  label: 28,
  sub: 40,
  edgeLabel: 24,
  detail: 200,
};

function clampStr(s, max) {
  if (s == null) return undefined;
  s = String(s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Secret-ish patterns; the structural summary should never carry these, but we
// belt-and-braces scrub every string that leaves the machine toward the LLM.
const SECRET_RE = [
  /(?:sk|pk|ghp|gho|xox[baprs]|AKIA|ya29)[-_][A-Za-z0-9]{6,}/g, // known key prefixes
  /[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, // JWT-ish
  // long base64 blobs — excludes '/' so file PATHS (many slashes) are NOT
  // mistaken for secrets; real token blobs are contiguous/URL-safe.
  /\b[A-Za-z0-9+]{40,}={0,2}\b/g,
  /(?:password|secret|token|api[_-]?key|bearer)\s*[:=]\s*\S+/gi,
];

function scrubString(s) {
  if (s == null) return s;
  let out = String(s);
  for (const re of SECRET_RE) out = out.replace(re, '[redacted]');
  return out;
}

// DETERMINISTIC assembly.
function assembleDeterministic(scan) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const push = (n) => {
    if (!n.id || seen.has(n.id) || !KINDS.has(n.kind)) return;
    seen.add(n.id);
    nodes.push({
      id: n.id,
      label: clampStr(n.label || n.id, CAPS.label),
      kind: n.kind,
      ...(n.sub ? { sub: clampStr(n.sub, CAPS.sub) } : {}),
      ...(n.domain ? { domain: n.domain } : {}),
      ...(n.group ? { group: clampStr(n.group, CAPS.label) } : {}),
      ...(n.detail ? { detail: clampStr(n.detail, CAPS.detail) } : {}),
      ...(n.sourceRef ? { sourceRef: n.sourceRef } : {}),
    });
  };

  (scan.models || []).forEach((m) => push({ ...m, kind: 'model' }));
  (scan.tools || []).forEach((t) => push({ ...t, kind: 'tool' }));
  (scan.integrations || []).forEach((i) => push({ ...i, kind: 'external' }));
  (scan.agents || []).forEach((a) => {
    push({ id: a.id, label: a.label, kind: 'agent', sub: a.sub, group: a.group, detail: a.detail, sourceRef: a.sourceRef });
    // deterministic call edge agent -> model|tool (we know what each agent calls)
    const target = a.model || a.toolId || a.tool;
    if (target && seen.has(target)) edges.push({ from: a.id, to: target, kind: 'calls' });
  });
  // orchestrator -> subagent hierarchy (parent triggers child), deterministic
  (scan.agents || []).forEach((a) => {
    if (a.parent && seen.has(a.parent) && seen.has(a.id) && a.parent !== a.id) {
      edges.push({ from: a.parent, to: a.id, kind: 'triggers' });
    }
  });

  const stats = {
    agents: (scan.agents || []).length,
    models: (scan.models || []).length,
    tools: (scan.tools || []).length,
    integrations: (scan.integrations || []).length,
  };
  const topModels = (scan.models || []).slice(0, CAPS.topModels).map((m) => ({ id: m.id, label: m.label, ...(m.domain ? { domain: m.domain } : {}) }));
  const topTools = (scan.tools || []).slice(0, CAPS.topTools).map((t) => ({ id: t.id, label: t.label, ...(t.domain ? { domain: t.domain } : {}) }));
  const topIntegrations = (scan.integrations || []).slice(0, CAPS.topIntegrations).map((i) => ({ id: i.id, label: i.label, ...(i.domain ? { domain: i.domain } : {}) }));

  return { nodes, edges, stats, topModels, topTools, topIntegrations };
}

// Build the CONTENT-FREE structural summary handed to the LLM.
function buildScrubbedSummary(scan, base) {
  return {
    project: { name: scrubString(scan.project.name), slug: scan.project.slug },
    nodes: base.nodes.map((n) => ({
      id: n.id,
      label: scrubString(n.label),
      kind: n.kind,
      ...(n.sub ? { sub: scrubString(n.sub) } : {}),
      ...(n.group ? { group: n.group } : {}),
      ...(n.sourceRef ? { sourceRef: scrubString(n.sourceRef) } : {}),
    })),
    detectedEdges: base.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
    hints: {
      entrypoints: (scan.entrypoints || []).map((p) => scrubString(p)),
      stores: (scan.stores || []).map((s) => scrubString(s)),
      technologies: scan.technologies || [],
    },
  };
}

// MERGE + VALIDATE the LLM enrichment onto the deterministic base.
function mergeEnrichment(base, enrichment) {
  const byId = new Map(base.nodes.map((n) => [n.id, n]));
  const nodes = base.nodes.slice();

  for (const raw of (enrichment && enrichment.nodes) || []) {
    if (!raw || !raw.id) continue;
    const existing = byId.get(raw.id);
    if (existing) {
      // may only FILL missing group/detail/sub — never override kind
      if (!existing.group && raw.group) existing.group = clampStr(raw.group, CAPS.label);
      if (!existing.detail && raw.detail) existing.detail = clampStr(raw.detail, CAPS.detail);
      if (!existing.sub && raw.sub) existing.sub = clampStr(raw.sub, CAPS.sub);
      continue;
    }
    // new node: only entry/cron/service/store are LLM-introducible
    if (!LLM_INTRODUCIBLE.has(raw.kind)) continue;
    const n = {
      id: raw.id,
      label: clampStr(raw.label || raw.id, CAPS.label),
      kind: raw.kind,
      ...(raw.sub ? { sub: clampStr(raw.sub, CAPS.sub) } : {}),
      ...(raw.group ? { group: clampStr(raw.group, CAPS.label) } : {}),
      ...(raw.detail ? { detail: clampStr(raw.detail, CAPS.detail) } : {}),
      ...(raw.sourceRef ? { sourceRef: raw.sourceRef } : {}),
    };
    byId.set(n.id, n);
    nodes.push(n);
    if (nodes.length >= CAPS.nodes) break;
  }

  // edges: deterministic first, then valid LLM edges; dedupe; cap
  const edges = [];
  const edgeSeen = new Set();
  const addEdge = (e) => {
    if (!e || !byId.has(e.from) || !byId.has(e.to)) return;
    if (e.from === e.to) return;
    const kind = EDGE_KINDS.has(e.kind) ? e.kind : 'calls';
    const key = e.from + '>' + e.to + '>' + kind;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push({ from: e.from, to: e.to, kind, ...(e.label ? { label: clampStr(e.label, CAPS.edgeLabel) } : {}) });
  };
  base.edges.forEach(addEdge);
  for (const e of (enrichment && enrichment.edges) || []) {
    if (edges.length >= CAPS.edges) break;
    addEdge(e);
  }

  return { nodes: nodes.slice(0, CAPS.nodes), edges: edges.slice(0, CAPS.edges) };
}

async function generateGraph({ scan, llm = null, onTrace = null } = {}) {
  if (!scan || !scan.project) throw new Error('graph-generator: scan.project required');
  const base = assembleDeterministic(scan);

  let enrichment = { nodes: [], edges: [] };
  if (llm && typeof llm.inferGraph === 'function') {
    const summary = buildScrubbedSummary(scan, base);
    const started = Date.now();
    try {
      const res = await llm.inferGraph(summary);
      enrichment = res && typeof res === 'object' ? res : enrichment;
      emitTrace(onTrace, {
        event: 'graph.infer',
        ok: true,
        model: (res && res.__model) || (llm.model) || 'unknown',
        inputTokens: res && res.__inputTokens,
        outputTokens: res && res.__outputTokens,
        costUsd: res && res.__costUsd,
        latencyMs: Date.now() - started,
        contentFree: true,
      });
    } catch (err) {
      // enrichment is best-effort; a failed LLM pass yields the deterministic
      // graph, never a crash and never a fabricated flow.
      emitTrace(onTrace, { event: 'graph.infer', ok: false, error: err && err.name, latencyMs: Date.now() - started, contentFree: true });
    }
  }

  const graph = mergeEnrichment(base, enrichment);
  return {
    version: 1,
    project: {
      name: clampStr(scan.project.name, 60),
      slug: scan.project.slug,
      ...(scan.project.tagline ? { tagline: clampStr(scan.project.tagline, 120) } : {}),
      ...(scan.project.iconDomain ? { iconDomain: scan.project.iconDomain } : {}),
      date: scan.project.date || new Date().toISOString().slice(0, 10),
    },
    stats: base.stats,
    topModels: base.topModels,
    topTools: base.topTools,
    topIntegrations: base.topIntegrations,
    graph,
  };
}

function emitTrace(onTrace, evt) {
  if (typeof onTrace === 'function') {
    try { onTrace(evt); } catch { /* instrumentation must never break generation */ }
  }
}

module.exports = {
  generateGraph,
  assembleDeterministic,
  buildScrubbedSummary,
  mergeEnrichment,
  scrubString,
  clampStr,
  CAPS,
  KINDS,
  EDGE_KINDS,
  LLM_INTRODUCIBLE,
};
