'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

// Deterministic (no-LLM) parser of the talent's AI agent org chart (talents-ai-score, ADR-009).

// Safety caps mirror scanner.js's FOOTPRINT_MAX_* (avoid pathological scans,
// never a product requirement).
const AGENTS_MAX_FILES = 500;
const AGENTS_MAX_DEPTH = 6;

// Only these frontmatter keys are ever captured.
const WHITELISTED_KEYS = new Set(['name', 'tools', 'model', 'parent']);

function listAgentMarkdownFiles(dir, depth = 0, budget = { count: 0 }) {
  const results = [];
  if (depth > AGENTS_MAX_DEPTH || budget.count >= AGENTS_MAX_FILES) return results;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results; // no .claude/agents directory: not an error, just nothing to parse
  }
  for (const entry of entries) {
    if (budget.count >= AGENTS_MAX_FILES) break;
    if (entry.isSymbolicLink()) continue; // never follow symlinks (mirrors scanner.js)
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listAgentMarkdownFiles(full, depth + 1, budget));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      budget.count += 1;
      results.push(full);
    }
  }
  return results;
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

// Parses one `.claude/agents/*.md` file into { name, tools, model, parent }.
function deriveAiProduct(filePath) {
  const p = String(filePath || '').replace(/\\/g, '/');
  if (p.includes('/.claude/agents/') || p.includes('/.claude/agents')) return 'claude-code';
  return null;
}

function buildAgentFromFrontmatter(fm, filePath) {
  const fallbackName = path.basename(filePath, path.extname(filePath));
  const name = typeof fm.name === 'string' && fm.name.trim() ? fm.name.trim() : fallbackName;

  const tools = Array.isArray(fm.tools) ? fm.tools : typeof fm.tools === 'string' ? [fm.tools] : [];

  return {
    name,
    tools,
    // AI product derived from the source path (see deriveAiProduct) — shown on
    // the card in place of the LLM `model`.
    aiProduct: deriveAiProduct(filePath),
    model: typeof fm.model === 'string' && fm.model ? fm.model : null,
    // Hierarchy (ADR-009): first honour an explicit `parent` frontmatter key when a project declares one.
    parent: typeof fm.parent === 'string' && fm.parent ? fm.parent : null,
  };
}

// `parseAgentFile` USED TO BE HERE (removed by issue 093's sweep): read one `.md` and build an agent from its frontmatter.

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

// Both `.claude/agents/` locations in scope order (project first, so it
// wins on a name collision when the results are merged/deduped below).
function agentDirs(root) {
  return [path.join(root, '.claude', 'agents'), path.join(getHomeDir(), '.claude', 'agents')];
}

// Per-repo AI-usage scoping: `.claude/agents/` across EVERY selected project root, PLUS home appended ONCE at the end.
function agentDirsForRoots(roots) {
  const dirs = [];
  for (const root of roots) dirs.push(path.join(root, '.claude', 'agents'));
  dirs.push(path.join(getHomeDir(), '.claude', 'agents'));
  return dirs;
}

// Deterministic (no-LLM) agent org chart over a fixed list of `.claude/agents/` directories (in precedence order — first occurrence of a name wins).
function parseAgentOrgChartFromDirs(dirs) {
  const seen = new Set();
  const agents = [];
  // TRANSIENT prose (description + body) per agent, kept LOCAL to this function purely to derive parent edges below.
  const textByName = new Map();

  for (const dir of dirs) {
    for (const file of listAgentMarkdownFiles(dir)) {
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

// Deterministic (no-LLM) agent org chart, scoped to `.claude/agents/` in BOTH the project root and the home directory (ADR-014, project ∪ home).
function parseAgentOrgChart(root) {
  return parseAgentOrgChartFromDirs(agentDirs(root));
}

// Per-repo AI-usage scoping: the org chart across ALL selected project roots (∪ home, once), deduped by name.
function parseAgentOrgChartForRoots(roots) {
  return parseAgentOrgChartFromDirs(agentDirsForRoots(Array.isArray(roots) ? roots : [roots]));
}

// talents-ai-score, ADR-010: returns `[{ name, description }]` — the ONLY function in this module that ever returns description/prompt content.
function parseAgentDescriptionsFromDirs(dirs) {
  const seen = new Set();
  const result = [];
  for (const dir of dirs) {
    for (const file of listAgentMarkdownFiles(dir)) {
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
  return parseAgentDescriptionsFromDirs(agentDirsForRoots(Array.isArray(roots) ? roots : [roots]));
}

function parseAgentDefinitionsFromDirs(dirs) {
  const seen = new Set();
  const result = [];
  for (const dir of dirs) {
    for (const file of listAgentMarkdownFiles(dir)) {
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
  return parseAgentDefinitionsFromDirs(agentDirsForRoots(Array.isArray(roots) ? roots : [roots]));
}

function agentSourceFilesByName(root) {
  const byName = new Map();
  const dirs = agentDirs(root);
  dirs.forEach((dir, dirIndex) => {
    for (const file of listAgentMarkdownFiles(dir)) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      if (!fm) continue;
      const agent = buildAgentFromFrontmatter(fm, file);
      if (byName.has(agent.name)) continue; // project (dirIndex 0) wins on collision
      const rel =
        dirIndex === 0 ? path.relative(root, file).split(path.sep).join('/') : null;
      byName.set(agent.name, rel);
    }
  });
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
