'use strict';

const fs = require('fs');
const path = require('path');

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
 * What's extracted (structure + names ONLY): per agent -> name/role, wired
 * tools, model, and the parent it declares (if any) — the orchestrator ->
 * subagent hierarchy. Every other frontmatter key, and CRUCIALLY
 * `description` (which in practice is a long free-text prompt that can leak
 * project/business framing), is walked over structurally to keep the parser
 * in sync but its content is NEVER captured, stored, or returned. The
 * markdown body below the frontmatter (the system prompt itself) is never
 * read at all.
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
// WHITELISTED_KEYS; everything else — most importantly `description`, which
// is typically a multi-line block scalar holding the agent's full prompt —
// is walked over structurally (so line-parsing stays in sync with the file)
// but its content is never assigned anywhere.
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const data = {};
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
    // continuation lines to stay in sync with the rest of the file, but
    // never store the content — regardless of whether the key is
    // whitelisted (a whitelisted key is never expected to be a block
    // scalar in practice; if it were, treating it as "no value" is the
    // safe default, not a crash).
    if (/^[|>][-+]?$/.test(rawValue)) {
      while (i < lines.length && (lines[i].trim() === '' || /^\s+/.test(lines[i]))) {
        i += 1;
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
      if (items.length && WHITELISTED_KEYS.has(key)) data[key] = items;
      continue;
    }

    if (!WHITELISTED_KEYS.has(key)) continue; // never captured (e.g. an inline description)

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

// Deterministic (no-LLM) agent org chart, scoped to `<root>/.claude/agents/`
// (ADR-009). Never scans project/business code. Missing directory, empty
// directory, or files without a valid `name` all resolve to an empty/
// partial list — never throws.
function parseAgentOrgChart(root) {
  const dir = path.join(root, '.claude', 'agents');
  const files = listAgentMarkdownFiles(dir);
  const agents = [];
  for (const file of files) {
    const agent = parseAgentFile(file);
    if (agent) agents.push(agent);
  }
  return agents;
}

module.exports = { parseAgentOrgChart, parseFrontmatter, parseAgentFile };
