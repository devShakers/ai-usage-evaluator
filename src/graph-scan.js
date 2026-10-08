'use strict';

// graph-scan.js — the DETECTOR → scan adapter for the LOCAL report (`map`).

const path = require('path');
const { scan } = require('./scanner');
const { classify } = require('./maturity');
const { setupLevelForTier } = require('./tier-engine');
const { sanitizeRenderText } = require('./sanitize-network-text');
// The ONE agent-shaping layer, shared with the terminal report (issue 089).
const { buildAgentCardTree } = require('./render-html');

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'x';
}

// Bare Claude aliases → the current EXACT model id (Claude 5 family + Opus 4.8 + Haiku 4.5).
const CLAUDE_ALIASES = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
};

// Normalize a raw agent `model` string to a graph model node keyed by the EXACT model id (one node per distinct exact id — never collapsed to a vendor family).
function modelNode(raw) {
  const original = String(raw || '').trim();
  const m = original.toLowerCase();
  if (!m) return null;
  // `inherit` (or the session default): be honest — no specific id invented.
  if (m === 'inherit' || m === 'default') return { id: 'inherit', label: 'inherit', domain: null };
  // Bare Claude alias → exact id.
  if (CLAUDE_ALIASES[m]) return { id: CLAUDE_ALIASES[m], label: CLAUDE_ALIASES[m], domain: 'claude.ai' };
  // Already an exact/qualified id — keep it verbatim, key by it.
  if (/claude/.test(m)) return { id: m, label: original, domain: 'claude.ai' };
  if (/gemini/.test(m)) return { id: m, label: original, domain: 'gemini.google.com' };
  if (/gpt|o1|o3|openai/.test(m)) return { id: m, label: original, domain: 'openai.com' };
  // unknown but present: keep it as a node so the agent has a call target
  return { id: slug(m), label: original, domain: null };
}

// Light, deterministic store hints from technologies (fed to the LLM pass only
// as hints; never emitted as authoritative store nodes here).
function storeHints(technologies) {
  const t = (technologies || []).map((x) => String(x).toLowerCase());
  const hints = [];
  if (t.some((x) => /prisma|postgres|pg\b/.test(x))) hints.push('postgresql');
  if (t.some((x) => /mongo/.test(x))) hints.push('mongodb');
  if (t.some((x) => /redis/.test(x))) hints.push('redis');
  if (t.some((x) => /s3|aws-sdk/.test(x))) hints.push('aws-s3');
  return hints;
}

function buildGraphScan(root, { scanFn = scan, classifyFn = classify } = {}) {
  const abs = path.resolve(root || process.cwd());
  const report = scanFn({ root: abs });
  const maturity = classifyFn(report);

  const agentsRaw = Array.isArray(report.agents) ? report.agents : [];
  const technologies = Array.isArray(report.technologies) ? report.technologies : [];

  // agents (+ their models), deduped by slug(name)
  const seenAgent = new Set();
  const agents = [];
  const modelsById = new Map();
  const nameToId = new Map();
  for (const a of agentsRaw) {
    const id = slug(a.name);
    if (!a.name || seenAgent.has(id)) continue;
    seenAgent.add(id);
    nameToId.set(a.name, id);
    const mn = modelNode(a.model);
    if (mn && !modelsById.has(mn.id)) modelsById.set(mn.id, mn);
    agents.push({
      id,
      label: a.name,
      _parentName: a.parent || null,
      ...(mn ? { model: mn.id } : {}),
      ...(a.aiProduct ? { group: a.aiProduct } : {}),
      // Sub-label = the EXACT resolved model id (not the raw alias like "opus").
      ...(mn ? { sub: mn.label } : a.aiProduct ? { sub: a.aiProduct } : {}),
    });
  }
  // second pass: resolve parent NAME -> parent agent id (orchestrator hierarchy)
  for (const ag of agents) {
    const pid = ag._parentName ? nameToId.get(ag._parentName) : null;
    if (pid && pid !== ag.id) ag.parent = pid;
    delete ag._parentName;
  }

  const scanOut = {
    project: {
      name: path.basename(abs) || 'project',
      slug: slug(path.basename(abs)),
      date: new Date().toISOString().slice(0, 10),
    },
    agents,
    models: Array.from(modelsById.values()),
    tools: [],
    integrations: [],
    technologies,
    // hints for the LLM enrichment pass (structural only)
    entrypoints: [],
    stores: storeHints(technologies),
  };

  return {
    scan: scanOut,
    footprint: buildFootprintDrawer(report, maturity),
    report,
    maturity,
  };
}

// Setup-level ladder for the drawer (ADR-016): the 3 Setup Levels + "Not certified", replacing the retired 0-4 maturity ladder.
const SETUP_LADDER = [
  { rank: 0, key: 'none', label: 'Sin certificar' },
  { rank: 1, key: 'S1', label: 'S1 · Asistido' },
  { rank: 2, key: 'S2', label: 'S2 · Extendido' },
  { rank: 3, key: 'S3', label: 'S3 · Orquestado' },
];

// #3 footprint drawer payload from the live scan (defensive). Detected agents =
// a FLAT list with a depth number, not a tree object (issue 089).
function drawerAgents(report, t) {
  let tree;
  try {
    tree = buildAgentCardTree(report, t);
  } catch {
    return [];
  }
  // WHICH agents an evaluation actually covered.
  const evaluatedNames = new Set(
    report && report.agentEvaluation && Array.isArray(report.agentEvaluation.evaluations)
      ? report.agentEvaluation.evaluations
        .filter((e) => e && typeof e.name === 'string')
        .map((e) => sanitizeRenderText(e.name))
      : [],
  );
  const rows = [];
  const walk = (card, depth, seen) => {
    if (seen.has(card.name)) return; // malformed parent chain: never loop
    const nextSeen = new Set(seen);
    nextSeen.add(card.name);
    const children = tree.childrenByParent.get(card.name) || [];
    const cls = card.classification && card.classification.catalogId ? card.classification : null;
    rows.push({
      name: sanitizeRenderText(card.name),
      model: card.model ? sanitizeRenderText(card.model) : (card.aiProduct ? sanitizeRenderText(card.aiProduct) : null),
      // `whatItDoes` is already the merged description (synthesis > frontmatter >
      // humanised-name fallback) and already sanitised by the shaping layer.
      whatItDoes: card.whatItDoes || null,
      // The category is a REQUIREMENT of the design, and it is the agent → catalog-seed association, not the Talent's tier.
      category: cls ? cls.category : null,
      // THREE STATES, NOT TWO (issue 106).
      evaluated: evaluatedNames.has(card.name),
      // COPIED from the card, never recomputed (2026-08-03).
      evaluationState: card.evaluationState || (evaluatedNames.has(card.name) ? (cls ? 'classified' : 'unclassified') : 'not-evaluated'),
      role: cls && cls.role ? sanitizeRenderText(cls.role) : null,
      depth,
      hasChildren: children.length > 0,
    });
    for (const child of children) walk(child, depth + 1, nextSeen);
  };
  for (const root of tree.roots) walk(root, 0, new Set());
  return rows;
}

function buildFootprintDrawer(report, maturity, t) {
  const score = maturity && typeof maturity.score === 'number' ? maturity.score : 0;
  const tierKey = (maturity && (maturity.tierKey || maturity.key)) || '';
  const tierNum = maturity && typeof maturity.tier === 'number'
    ? maturity.tier
    : (/^T([0-7])$/.test(tierKey) ? Number(tierKey.slice(1)) : null);
  const tierName = (maturity && maturity.tierName) || '—';
  // Setup Level (ADR-016) replaces the 0-4 band as the drawer's headline rollup.
  const setup = (maturity && maturity.setupLevel)
    || (tierNum != null ? setupLevelForTier(tierNum) : { key: 'none', code: null, rank: 0, emoji: '○' });
  const setupLabel = (SETUP_LADDER.find((s) => s.key === setup.key) || SETUP_LADDER[0]).label;
  // Issue 055: this drawer payload feeds the shareable sheet AND the graph report, and both only `esc()`.
  const technologies = (Array.isArray(report.technologies) ? report.technologies : [])
    .map((x) => (typeof x === 'string' ? sanitizeRenderText(x) : x));
  // Installed AI dev tools (assistants).
  const toolList = Array.isArray(report.tools)
    ? report.tools
    : report.tools && typeof report.tools === 'object'
      ? Object.entries(report.tools).map(([id, v]) => ({ id, ...(v && typeof v === 'object' ? v : {}) }))
      : [];
  const tools = [];
  for (const t of toolList) {
    if (!t || !(t.detected || t.installed || t.present)) continue;
    const nm = (typeof t.name === 'string' && t.name) || prettyTool(t.id || t.key || '');
    if (nm) tools.push(sanitizeRenderText(nm));
  }

  return {
    score,
    // `setup` is the ADR-016 rollup shown in the drawer hero; `tier` keeps the tierKey · tierName chip.
    setup: { key: setup.key, code: setup.code, rank: setup.rank, emoji: setup.emoji, label: setupLabel },
    tier: { key: tierKey || 'none', name: tierName, label: tierKey ? `${tierKey} · ${tierName}` : tierName },
    ladder: SETUP_LADDER,
    // "Lectura": a deterministic, human-readable one-liner from the scan (no LLM,
    // no fabricated content). Previously hardcoded '' → an empty box in the drawer.
    summary: buildReading({ setupLabel, tierKey, tierName, score, nTools: tools.length, nTech: technologies.length }),
    tools,
    technologies,
    // Issue 089: ALL detected agents, always.
    agents: drawerAgents(report, t),
    // Issue 110: the SERVICES behind the MCP servers, shaped ONCE here for both consumers of this drawer (the shareable sheet and the graph report), the same way `agents` is.
    mcp: {
      services: (report.mcp && Array.isArray(report.mcp.services) ? report.mcp.services : [])
        .map((x) => ({ label: sanitizeRenderText(x.label), count: x.count })),
      unidentified: (report.mcp && typeof report.mcp.unidentified === 'number') ? report.mcp.unidentified : 0,
      total: (report.mcp && typeof report.mcp.total === 'number') ? report.mcp.total : 0,
    },
  };
}

// Deterministic Spanish reading of the footprint (the drawer is es), composed ONLY from real scan numbers — never invented prose.
function buildReading({ setupLabel, tierKey, tierName, score, nTools, nTech }) {
  const tier = tierKey ? `${tierKey} · ${tierName}` : tierName;
  const toolsPart = nTools > 0 ? `${nTools} herramienta${nTools === 1 ? '' : 's'} de IA detectada${nTools === 1 ? '' : 's'}` : 'sin herramientas de IA detectadas';
  const techPart = nTech > 0 ? `${nTech} tecnología${nTech === 1 ? '' : 's'} en el proyecto` : 'sin tecnologías detectadas';
  return `Nivel de setup ${setupLabel} (${tier}), score ${score}/100. ${toolsPart[0].toUpperCase()}${toolsPart.slice(1)} y ${techPart}.`;
}

function prettyTool(key) {
  const map = {
    'claude-code': 'Claude Code', cursor: 'Cursor', 'github-copilot': 'GitHub Copilot',
    windsurf: 'Windsurf', aider: 'Aider', continue: 'Continue', 'gemini-cli': 'Gemini CLI',
    'codex-cli': 'Codex CLI', trae: 'Trae',
  };
  return map[key] || key;
}

module.exports = { buildGraphScan, buildFootprintDrawer, modelNode, slug };
