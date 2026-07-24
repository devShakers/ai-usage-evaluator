'use strict';

/*
 * graph-scan.js — the DETECTOR → scan adapter for the LOCAL report (`map`).
 *
 * Turns a LIVE footprint scan of ANY project root into the deterministic
 * `scan` shape that src/graph-generator.js consumes. This is what lets
 * `map <root>` work on an arbitrary talent project — not just a repo that
 * already ships a hand-made `.foglamp/graph.json`.
 *
 * Deterministic sources (the SAME detectors `footprint` uses, no LLM):
 *   - scan(root).agents      declared agents from .claude/agents/*.md
 *                            (name / model / parent hierarchy / aiProduct)
 *   - scan(root).technologies dependency-manifest technologies
 *   - classify(report)       the 0–4 maturity band + 0–100 score (drawer)
 *
 * These become the AUTHORITATIVE layer: `agent` + `model` nodes, the provable
 * `agent → model` (calls) edges, and the orchestrator → subagent (triggers)
 * hierarchy edges. The LLM pass (graph-generator + graph-infer-client) then
 * enriches with the services/stores/flows/integrations we can't detect
 * statically.
 *
 * NOTE: `tools`/`integrations` are intentionally EMPTY here — the frontmatter
 * `tools` are Claude Code capabilities (Read/Edit/Bash…), not external AI
 * microservices, so surfacing them as graph nodes would be noise. Real
 * external tools/integrations are left for the LLM enrichment pass.
 */

const path = require('path');
const { scan } = require('./scanner');
const { classify } = require('./maturity');
const { setupLevelForTier } = require('./tier-engine');

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'x';
}

// Bare Claude aliases → the current EXACT model id (Claude 5 family + Opus 4.8 +
// Haiku 4.5). Only an EXACT bare alias resolves; an already-qualified id like
// `claude-3-opus` is kept verbatim (it matches the /claude/ branch below).
const CLAUDE_ALIASES = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
};

// Normalize a raw agent `model` string to a graph model node keyed by the EXACT
// model id (one node per distinct exact id — never collapsed to a vendor family).
// Honest on `inherit`/unknown: we surface it as-is, never a fabricated id.
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

/*
 * buildGraphScan(root) -> { scan, footprint, report, maturity }
 *   scan       the deterministic input for generateGraph()
 *   footprint  drawer payload (tier/ladder/score/tools/technologies) — #3
 *   report/maturity  raw detector output (so the caller can reuse them)
 */
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

// Setup-level ladder for the drawer (ADR-016): the 3 Setup Levels + "Not
// certified", replacing the retired 0-4 maturity ladder. Labels are es (the
// drawer is Spanish); render-sheet localizes via the i18n `setupLevels` catalog
// when a locale is available.
const SETUP_LADDER = [
  { rank: 0, key: 'none', label: 'Sin certificar' },
  { rank: 1, key: 'S1', label: 'S1 · Asistido' },
  { rank: 2, key: 'S2', label: 'S2 · Extendido' },
  { rank: 3, key: 'S3', label: 'S3 · Orquestado' },
];

// #3 — footprint drawer payload from the live scan (defensive: tolerates
// whatever fields classify()/scan() expose).
function buildFootprintDrawer(report, maturity) {
  const score = maturity && typeof maturity.score === 'number' ? maturity.score : 0;
  const tierKey = (maturity && (maturity.tierKey || maturity.key)) || '';
  const tierNum = maturity && typeof maturity.tier === 'number'
    ? maturity.tier
    : (/^T([0-7])$/.test(tierKey) ? Number(tierKey.slice(1)) : null);
  const tierName = (maturity && maturity.tierName) || '—';
  // Setup Level (ADR-016) replaces the 0-4 band as the drawer's headline rollup.
  // Prefer the maturity's own `setupLevel`; derive from the tier for older /
  // partial maturity objects that predate it.
  const setup = (maturity && maturity.setupLevel)
    || (tierNum != null ? setupLevelForTier(tierNum) : { key: 'none', code: null, rank: 0, emoji: '○' });
  const setupLabel = (SETUP_LADDER.find((s) => s.key === setup.key) || SETUP_LADDER[0]).label;
  const technologies = Array.isArray(report.technologies) ? report.technologies : [];
  // Installed AI dev tools (assistants). `report.tools` is an ARRAY of tool
  // objects ({ id, name, detected, ... }) — earlier code indexed it as an
  // object keyed by name, so the pills showed the numeric ARRAY INDEX ("0",
  // "1"…) instead of the tool name. Read the array and use each tool's `.name`.
  const toolList = Array.isArray(report.tools)
    ? report.tools
    : report.tools && typeof report.tools === 'object'
      ? Object.entries(report.tools).map(([id, v]) => ({ id, ...(v && typeof v === 'object' ? v : {}) }))
      : [];
  const tools = [];
  for (const t of toolList) {
    if (!t || !(t.detected || t.installed || t.present)) continue;
    const nm = (typeof t.name === 'string' && t.name) || prettyTool(t.id || t.key || '');
    if (nm) tools.push(nm);
  }

  return {
    score,
    // `setup` is the ADR-016 rollup shown in the drawer hero; `tier` keeps the
    // tierKey · tierName chip. `level`/`name` on `tier` retained (legacy) so an
    // older render-sheet build reading them never crashes — no longer shown.
    setup: { key: setup.key, code: setup.code, rank: setup.rank, emoji: setup.emoji, label: setupLabel },
    tier: { key: tierKey || 'none', name: tierName, label: tierKey ? `${tierKey} · ${tierName}` : tierName },
    ladder: SETUP_LADDER,
    // "Lectura": a deterministic, human-readable one-liner from the scan (no LLM,
    // no fabricated content). Previously hardcoded '' → an empty box in the drawer.
    summary: buildReading({ setupLabel, tierKey, tierName, score, nTools: tools.length, nTech: technologies.length }),
    tools,
    technologies,
  };
}

/**
 * Deterministic Spanish reading of the footprint (the drawer is es), composed
 * ONLY from real scan numbers — never invented prose. Kept factual so it can't
 * leak a dangling token like an unfilled `(${…})`.
 */
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
