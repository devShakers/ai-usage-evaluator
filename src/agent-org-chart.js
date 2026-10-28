'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');
const { EXCLUDED_DIRS } = require('./scan-exclusions');

// Deterministic (no-LLM) parser of the talent's AI agent org chart.

// Safety caps mirror scanner.js's FOOTPRINT_MAX_* (avoid pathological scans,
// never a product requirement).
const AGENTS_MAX_FILES = 500;
const AGENTS_MAX_DEPTH = 6;
const PLUGIN_SEARCH_MAX_DEPTH = 4;
const PLUGIN_SEARCH_MAX_DIRS = 2000;

// Only these frontmatter keys are ever captured.
const WHITELISTED_KEYS = new Set(['name', 'tools', 'model', 'parent']);

function realpathOrNull(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function listAgentMarkdownFiles(source) {
  const boundary = realpathOrNull(source.boundary);
  const results = [];
  const visited = new Set();
  const walk = (dir, depth) => {
    if (depth > AGENTS_MAX_DEPTH || results.length >= AGENTS_MAX_FILES) return;
    const real = realpathOrNull(dir);
    if (!real || visited.has(real)) return;
    visited.add(real);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= AGENTS_MAX_FILES) break;
      const full = path.join(dir, entry.name);
      let kind = entry;
      if (entry.isSymbolicLink()) {
        const target = realpathOrNull(full);
        if (!target || !boundary || !isInside(target, boundary)) continue;
        try {
          kind = fs.statSync(target);
        } catch {
          continue;
        }
      }
      if (kind.isDirectory()) walk(full, depth + 1);
      else if (kind.isFile() && entry.name.endsWith('.md')) results.push(full);
    }
  };
  walk(source.dir, 0);
  return results;
}

function pluginAgentDirs(root) {
  const dirs = [];
  let visited = 0;
  const walk = (dir, depth) => {
    if (visited >= PLUGIN_SEARCH_MAX_DIRS) return;
    visited += 1;
    if (fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) dirs.push(path.join(dir, 'agents'));
    if (depth >= PLUGIN_SEARCH_MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(root, 0);
  return dirs;
}

function stripQuotes(value) {
  const v = String(value).trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

// Minimal, dependency-free frontmatter reader (zero-dependency invariant, same as the rest of this repo).
function parseFrontmatter(content, { includeDescription = false } = {}) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const data = {};
  const captureKeys = includeDescription
    ? new Set([...WHITELISTED_KEYS, 'description'])
    : WHITELISTED_KEYS;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = kv[1];
    const rawValue = kv[2].trim();
    i += 1;

    // Block scalar (`|`, `>`, `|-`, `>-`, `|+`, `>+`): this is how `description` shows up in practice.
    if (/^[|>][-+]?$/.test(rawValue)) {
      const blockLines = [];
      while (i < lines.length && (lines[i].trim() === '' || /^\s+/.test(lines[i]))) {
        blockLines.push(lines[i].trim() === '' ? '' : lines[i].replace(/^\s+/, ''));
        i += 1;
      }
      if (includeDescription && key === 'description') {
        while (blockLines.length && blockLines[blockLines.length - 1] === '') blockLines.pop();
        data[key] = blockLines.join('\n');
      }
      continue;
    }

    // YAML block list continuation ("key:" on its own line, followed by
    // "- item" lines).
    if (rawValue === '') {
      const items = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(stripQuotes(lines[i].replace(/^\s*-\s+/, '')));
        i += 1;
      }
      if (items.length && captureKeys.has(key)) data[key] = items;
      continue;
    }

    if (!captureKeys.has(key)) continue; // never captured (e.g. an inline description, unless explicitly requested)

    // Inline YAML list: `tools: [Read, Write]`
    if (/^\[.*\]$/.test(rawValue)) {
      data[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((s) => stripQuotes(s))
        .filter(Boolean);
      continue;
    }

    // Comma-separated scalar (the format Claude Code's own docs use):
    // `tools: Read, Write, Bash`
    if (key === 'tools' && rawValue.includes(',')) {
      data[key] = rawValue
        .split(',')
        .map((s) => stripQuotes(s))
        .filter(Boolean);
      continue;
    }

    data[key] = stripQuotes(rawValue);
  }

  return data;
}

function buildAgentFromFrontmatter(fm, filePath) {
  const fallbackName = path.basename(filePath, path.extname(filePath));
  const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : fallbackName;

  const tools = Array.isArray(fm.tools) ? fm.tools : typeof fm.tools === 'string' ? [fm.tools] : [];

  return {
    name,
    tools,
    aiProduct: 'claude-code',
    model: typeof fm.model === 'string' && fm.model ? fm.model : null,
    // Hierarchy: first honour an explicit `parent` frontmatter key when a project declares one.
    parent: typeof fm.parent === 'string' && fm.parent ? fm.parent : null,
  };
}

// `parseAgentFile` USED TO BE HERE (removed): read one `.md` and build an agent from its frontmatter.

// Markdown body (everything after the closing ` ` of the frontmatter).
function bodyAfterFrontmatter(content) {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length) : '';
}

const HIERARCHY_DIRECTS = /\b(defines?|sets?|directs?|approves?|coordinat\w+|orchestrat\w+|owns?)\b/i;
const HIERARCHY_EXECUTES = /\byou\s+(execute|produce|implement|carry\s+out)\b|\byou\s+don'?t\s+strateg|passes?\s+through\s+you|execution\s+agent/i;
const HIERARCHY_NEGATION = /\b(do\s+not|don'?t\s+touch|not\s+touch|never|nunca|no\s+toques)\b/i;

function deriveParentFromText(selfName, text, knownNames) {
  if (!text) return null;
  const units = text.split(/\r?\n|(?<=[.!?])\s+/);
  for (const unit of units) {
    if (HIERARCHY_NEGATION.test(unit)) continue;
    if (!HIERARCHY_DIRECTS.test(unit) || !HIERARCHY_EXECUTES.test(unit)) continue;
    const matches = [];
    for (const other of knownNames) {
      if (other === selfName) continue;
      const re = new RegExp('\\b' + other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (re.test(unit)) matches.push(other);
    }
    if (matches.length === 1) return matches[0]; // exactly one -> unambiguous
  }
  return null;
}

function agentSources(roots) {
  const sources = [];
  for (const root of roots) {
    for (const dir of [path.join(root, '.claude', 'agents'), ...pluginAgentDirs(root)]) {
      sources.push({ dir, boundary: root, project: true });
    }
  }
  const homeClaude = path.join(getHomeDir(), '.claude');
  sources.push({ dir: path.join(homeClaude, 'agents'), boundary: homeClaude, project: false });
  return sources;
}

function agentDirs(root) {
  return agentSources([root]);
}

function agentDirsForRoots(roots) {
  return agentSources(Array.isArray(roots) ? roots : [roots]);
}

// Deterministic (no-LLM) agent org chart over a fixed list of `.claude/agents/` directories (in precedence order — first occurrence of a name wins).
function parseAgentOrgChartFromDirs(dirs) {
  const seen = new Set();
  const agents = [];
  // TRANSIENT prose (description + body) per agent, kept LOCAL to this function purely to derive parent edges below.
  const textByName = new Map();

  for (const source of dirs) {
    for (const file of listAgentMarkdownFiles(source)) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      if (!fm) continue; // no frontmatter block: not a valid agent definition
      const agent = buildAgentFromFrontmatter(fm, file);
      if (seen.has(agent.name)) continue; // project wins on a name collision (dir order)
      seen.add(agent.name);
      agents.push(agent);
      const fmWithDesc = parseFrontmatter(content, { includeDescription: true });
      const desc = fmWithDesc && typeof fmWithDesc.description === 'string' ? fmWithDesc.description : '';
      textByName.set(agent.name, `${desc}\n${bodyAfterFrontmatter(content)}`);
    }
  }

  // Derive orchestrator->subagent edges from prose for agents that declare no explicit `parent` (the common case).
  const knownNames = agents.map((a) => a.name);
  for (const agent of agents) {
    if (agent.parent) continue;
    const derived = deriveParentFromText(agent.name, textByName.get(agent.name), knownNames);
    if (derived && derived !== agent.name) agent.parent = derived;
  }

  // Defensive: break a direct 2-cycle from mutual cues (A<->B).
  const byName = new Map(agents.map((a) => [a.name, a]));
  for (const agent of agents) {
    if (!agent.parent) continue;
    const p = byName.get(agent.parent);
    if (p && p.parent === agent.name) p.parent = null;
  }

  return agents;
}

// Deterministic (no-LLM) agent org chart, scoped to `.claude/agents/` in BOTH the project root and the home directory (project ∪ home).
function parseAgentOrgChart(root) {
  return parseAgentOrgChartFromDirs(agentDirs(root));
}

// Per-repo AI-usage scoping: the org chart across ALL selected project roots (∪ home, once), deduped by name.
function parseAgentOrgChartForRoots(roots) {
  return parseAgentOrgChartFromDirs(agentDirsForRoots(roots));
}

// Returns `[{ name, description }]` — the ONLY function in this module that ever returns description/prompt content.
function parseAgentDescriptionsFromDirs(dirs) {
  const seen = new Set();
  const result = [];
  for (const source of dirs) {
    for (const file of listAgentMarkdownFiles(source)) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content, { includeDescription: true });
      if (!fm) continue;
      const fallbackName = path.basename(file, path.extname(file));
      const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : fallbackName;
      if (!seen.has(name)) {
        seen.add(name);
        result.push({ name, description: typeof fm.description === 'string' ? fm.description : '' });
      }
    }
  }
  return result;
}

function parseAgentDescriptions(root) {
  return parseAgentDescriptionsFromDirs(agentDirs(root));
}

// Per-repo AI-usage scoping: card-description fallbacks across ALL selected
// project roots (∪ home, once), same dedup/precedence as parseAgentOrgChartForRoots.
function parseAgentDescriptionsForRoots(roots) {
  return parseAgentDescriptionsFromDirs(agentDirsForRoots(roots));
}

function parseAgentDefinitionsFromDirs(dirs) {
  const seen = new Set();
  const result = [];
  for (const source of dirs) {
    for (const file of listAgentMarkdownFiles(source)) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content, { includeDescription: true });
      if (!fm) continue;
      const fallbackName = path.basename(file, path.extname(file));
      const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : fallbackName;
      if (seen.has(name)) continue;
      seen.add(name);
      const description = typeof fm.description === 'string' ? fm.description : '';
      const body = bodyAfterFrontmatter(content);
      const definition = [description, body].map((s) => (s || '').trim()).filter(Boolean).join('\n\n');
      result.push({ name, definition });
    }
  }
  return result;
}

function parseAgentDefinitions(root) {
  return parseAgentDefinitionsFromDirs(agentDirs(root));
}

// Per-repo AI-usage scoping: full agent definitions (for the quality-evaluation
// call) across ALL selected project roots (∪ home, once), same dedup/precedence.
function parseAgentDefinitionsForRoots(roots) {
  return parseAgentDefinitionsFromDirs(agentDirsForRoots(roots));
}

function agentSourceFilesByName(root) {
  const byName = new Map();
  for (const source of agentDirs(root)) {
    for (const file of listAgentMarkdownFiles(source)) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      if (!fm) continue;
      const agent = buildAgentFromFrontmatter(fm, file);
      if (byName.has(agent.name)) continue;
      byName.set(agent.name, source.project ? path.relative(root, file).split(path.sep).join('/') : null);
    }
  }
  return byName;
}

module.exports = {
  parseAgentOrgChart,
  parseAgentOrgChartForRoots,
  parseFrontmatter,
  parseAgentDescriptions,
  parseAgentDescriptionsForRoots,
  parseAgentDefinitions,
  parseAgentDefinitionsForRoots,
  agentSourceFilesByName,
};
