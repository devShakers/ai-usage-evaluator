'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

/*
 * Deterministic (no-LLM) parser of the talent's AI agent org chart
 * (talents-ai-score, ADR-009).
 *
 * Source: KNOWN AI config files only — primarily `.claude/agents/*.md`
 * frontmatter (`name`, `tools`, `model`, and `parent` if a project declares
 * it explicitly). Same spirit as scanner.js/detectors.js (ADR-003): never
 * scans project/business code, only config files a known AI tool itself
 * writes/reads. Other tools (Cursor, Windsurf, Copilot, Cline...) don't ship
 * a declarative, structured multi-agent org-chart file format as of this
 * writing — their "rules"/"custom modes" describe a single assistant
 * persona, not a name/tools/model/hierarchy schema — so they are
 * deliberately left OUT of this deterministic parser rather than guessed
 * at. Left for a human to add if/when such a format stabilizes (see
 * detectors.js's ageing-catalog note, ADR-001, same spirit).
 *
 * talents-ai-score, ADR-014 (closed decision #5): scope is PROJECT ∪ HOME —
 * `.claude/agents/` is read from both the scanned project root AND the
 * talent's home directory (personal/global subagents), applied uniformly
 * with every other category for tier coherence (issue 019). On a name
 * collision, the PROJECT-level agent wins (mirrors Claude Code's own
 * documented precedence rule for project vs. personal subagents).
 *
 * What's extracted (structure + names ONLY): per agent -> name/role, wired
 * tools, model, and the parent it declares (if any) — the orchestrator ->
 * subagent hierarchy. Every other frontmatter key, and CRUCIALLY
 * `description` (which in practice is a long free-text prompt that can leak
 * project/business framing), is walked over structurally to keep the parser
 * in sync but its content is NEVER captured, stored, or returned by
 * `parseAgentOrgChart` — this invariant (ADR-009) is unchanged. The markdown
 * body below the frontmatter (the system prompt itself) is never read at
 * all, by either function below.
 *
 * talents-ai-score, ADR-010 (deliberate, gated exception to the invariant
 * above): `parseAgentDescriptions` is a SEPARATE, explicitly-named function
 * that DOES return `description` content — the only place in this module
 * that does. It exists solely to feed the ephemeral, server-side agent
 * "synthesis" request (`src/agent-synthesis.js`), never `report.agents` /
 * the deterministic org chart / the persistence payload.
 */

// Safety caps mirror scanner.js's FOOTPRINT_MAX_* (avoid pathological scans,
// never a product requirement).
const AGENTS_MAX_FILES = 500;
const AGENTS_MAX_DEPTH = 6;

// Only these frontmatter keys are ever captured. `description` (and any
// other key a project's frontmatter might add) is intentionally absent from
// this set, which is the enforcement point for "never content, only
// structure + names".
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

// Minimal, dependency-free frontmatter reader (zero-dependency invariant,
// same as the rest of this repo). Only extracts scalar/list values for
// WHITELISTED_KEYS (plus `description` when `includeDescription` is
// explicitly passed — ADR-010's gated exception, used only by
// `parseAgentDescriptions` below). Anything else is walked over
// structurally (so line-parsing stays in sync with the file) but its
// content is never assigned anywhere.
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

    // Block scalar (`|`, `>`, `|-`, `>-`, `|+`, `>+`): this is how
    // `description` shows up in practice. Consume its indented/blank
    // continuation lines to stay in sync with the rest of the file. Its
    // content is captured ONLY when `key` is `description` AND
    // `includeDescription` was explicitly passed (ADR-010) — every other
    // block scalar, whitelisted or not, is discarded, same as before.
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
// Returns null if it doesn't declare a `name` (not a valid agent
// definition) or has no frontmatter at all.
function parseAgentFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const fm = parseFrontmatter(content);
  if (!fm || !fm.name) return null;

  const tools = Array.isArray(fm.tools) ? fm.tools : typeof fm.tools === 'string' ? [fm.tools] : [];

  return {
    name: fm.name,
    tools,
    model: typeof fm.model === 'string' && fm.model ? fm.model : null,
    // Hierarchy (ADR-009): only set if the frontmatter declares `parent`
    // explicitly ("si es inferible"). Claude Code's own subagent schema has
    // no standard `parent` field, so in practice this resolves to `null`
    // for every discovered agent, which the shape treats as "child of the
    // root orchestrator" — the root orchestrator itself (e.g. the main
    // Claude Code assistant) isn't a `.md` file, so it's never listed as an
    // agent of its own.
    parent: typeof fm.parent === 'string' && fm.parent ? fm.parent : null,
  };
}

// Both `.claude/agents/` locations in scope order (project first, so it
// wins on a name collision when the results are merged/deduped below).
function agentDirs(root) {
  return [path.join(root, '.claude', 'agents'), path.join(getHomeDir(), '.claude', 'agents')];
}

// Deterministic (no-LLM) agent org chart, scoped to `.claude/agents/` in
// BOTH the project root and the home directory (ADR-014, project ∪ home).
// Never scans project/business code. Missing directories, empty
// directories, or files without a valid `name` all resolve to an empty/
// partial list — never throws. Deduped by name: the project-level
// definition wins over a personal one with the same name.
function parseAgentOrgChart(root) {
  const seen = new Set();
  const agents = [];
  for (const dir of agentDirs(root)) {
    for (const file of listAgentMarkdownFiles(dir)) {
      const agent = parseAgentFile(file);
      if (!agent || seen.has(agent.name)) continue;
      seen.add(agent.name);
      agents.push(agent);
    }
  }
  return agents;
}

// talents-ai-score, ADR-010: returns `[{ name, description }]` — the ONLY
// function in this module that ever returns description/prompt content.
// Used exclusively to build the EPHEMERAL agent-synthesis request
// (src/agent-synthesis.js), which scrubs obvious secrets/PII before it ever
// leaves the machine and never persists this raw text (only the LLM's
// structured synthesis result does, via src/share.js's whitelist). Agents
// without a `description` are still included (empty string), so the caller
// can still send their structural data to the synthesis endpoint.
function parseAgentDescriptions(root) {
  const seen = new Set();
  const result = [];
  for (const dir of agentDirs(root)) {
    for (const file of listAgentMarkdownFiles(dir)) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content, { includeDescription: true });
      if (fm && fm.name && !seen.has(fm.name)) {
        seen.add(fm.name);
        result.push({ name: fm.name, description: typeof fm.description === 'string' ? fm.description : '' });
      }
    }
  }
  return result;
}

module.exports = { parseAgentOrgChart, parseFrontmatter, parseAgentFile, parseAgentDescriptions };
