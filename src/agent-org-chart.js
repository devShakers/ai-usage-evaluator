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
 * tools, model, and the parent — the orchestrator -> subagent hierarchy. The
 * parent comes from an explicit `parent` frontmatter key when present, and
 * otherwise is DERIVED deterministically from the agent's own prose (see
 * `deriveParentFromText`): real Claude Code setups declare the hierarchy in
 * natural language, not a structured field, so without this the chart was
 * always flat. Every other frontmatter key, and CRUCIALLY `description`
 * (which in practice is a long free-text prompt that can leak project/
 * business framing), is walked over structurally to keep the parser in sync
 * but its content is NEVER captured, stored, or returned by
 * `parseAgentOrgChart` — this invariant (ADR-009) is unchanged. The markdown
 * body below the frontmatter is read TRANSIENTLY only to derive the parent
 * EDGE (a name->name relationship); only the resolved parent NAME is written
 * back, never any prose — so "structure + names only" still holds.
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
// Returns null only when the file has NO frontmatter block at all (not a
// valid agent definition — nothing this parser can extract from it).
//
// talents-ai-score bugfix: a file that DOES have a frontmatter block but
// whose `name` key is missing, blank, or malformed (real-world edge cases
// found while investigating this: `name:` with no value at all — Claude
// Code's own frontmatter still recognizes the file as an agent by its
// filename in that case — or a `name` line the regex-based parser above
// doesn't populate) used to be silently DROPPED from the whole org chart,
// which is worse than showing a name: the agent vanished entirely rather
// than showing with a name. Every agent must show a name — falls back to
// the file's own basename (extension stripped) when the frontmatter
// doesn't supply one, so a card is NEVER rendered with no name.
// Derives the AI PRODUCT an agent belongs to from its SOURCE (the directory/
// format it was parsed from), never hardcoded per agent. A `.claude/agents/*.md`
// file is a Claude Code subagent → `'claude-code'`. New product sources (other
// tools that expose agent definitions) add a branch here; the render maps the
// key to a display name via i18n. `null` when the source isn't recognised.
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
    // Hierarchy (ADR-009): first honour an explicit `parent` frontmatter key
    // when a project declares one. Claude Code's own subagent schema has NO
    // standard `parent` field, so in practice this is `null` here for almost
    // every real agent file — the orchestrator->subagent edges are instead
    // DERIVED deterministically from the agent's own prose in
    // `parseAgentOrgChart` (see `deriveParentFromText`). `null` after both
    // steps means "child of the implicit root orchestrator" (the root
    // orchestrator — the main Claude Code assistant — isn't a `.md` file, so
    // it's never listed as an agent of its own).
    parent: typeof fm.parent === 'string' && fm.parent ? fm.parent : null,
  };
}

function parseAgentFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const fm = parseFrontmatter(content);
  if (!fm) return null; // no frontmatter block at all: not a valid agent definition
  return buildAgentFromFrontmatter(fm, filePath);
}

// Markdown body (everything after the closing `---` of the frontmatter).
// Read TRANSIENTLY only to derive orchestrator->subagent edges (see
// deriveParentFromText) — never captured onto an agent, never returned by
// parseAgentOrgChart, so the ADR-009 "structure + names only" invariant holds.
function bodyAfterFrontmatter(content) {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length) : '';
}

// talents-ai-score bugfix (orchestrated hierarchy not drawn): Claude Code's
// subagent schema has no `parent` field, so real multi-agent setups express
// the orchestrator->subagent hierarchy in each agent's OWN prose (e.g. nuply:
// "The growth-manager defines the strategy; you execute it."), not in a
// structured key. Left unresolved, EVERY agent was `parent: null` -> every
// card rendered as a flat root -> the renderers (which already draw nesting
// from `parent`) had no edges to draw. We derive an edge ONLY when an agent's
// text names EXACTLY ONE other known agent inside a single sentence that
// carries BOTH:
//   - a DIRECTION cue (that other agent defines/sets/coordinates the work), and
//   - an EXECUTION cue (THIS agent carries it out),
// and that sentence is NOT a negation line. Requiring both cues in the same
// sentence is what separates a genuine subordination from a sibling boundary
// ("You do NOT touch growth strategy (growth-manager)") or a peer hand-off
// ("Handoff a `project-manager` ...") — both of which name other agents too
// but are NOT parent/child. Two+ named agents in one directive sentence is
// ambiguous (could be a peer list) and is deliberately skipped rather than
// guessed.
//
// PRIVACY (ADR-009 preserved): the prose is inspected TRANSIENTLY here; the
// ONLY thing ever written back to the org chart is the resolved parent's
// NAME (itself another whitelisted agent name). No description/body text is
// stored or returned.
const HIERARCHY_DIRECTS = /\b(defines?|sets?|directs?|approves?|coordinat\w+|orchestrat\w+|owns?)\b/i;
const HIERARCHY_EXECUTES = /\byou\s+(execute|produce|implement|carry\s+out)\b|\byou\s+don'?t\s+strateg|passes?\s+through\s+you|execution\s+agent/i;
const HIERARCHY_NEGATION = /\b(do\s+not|don'?t\s+touch|not\s+touch|never|nunca|no\s+toques)\b/i;

function deriveParentFromText(selfName, text, knownNames) {
  if (!text) return null;
  // Split on line breaks and sentence-ending punctuation, but NOT on `;` —
  // the canonical subordination phrasing ("X defines the strategy; you
  // execute it") keeps the direction and execution cues in one clause.
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

// Deterministic (no-LLM) agent org chart, scoped to `.claude/agents/` in
// BOTH the project root and the home directory (ADR-014, project ∪ home).
// Never scans project/business code. Missing directories, empty
// directories, or files without a valid `name` all resolve to an empty/
// partial list — never throws. Deduped by name: the project-level
// definition wins over a personal one with the same name.
function parseAgentOrgChart(root) {
  const seen = new Set();
  const agents = [];
  // TRANSIENT prose (description + body) per agent, kept LOCAL to this
  // function purely to derive parent edges below. Never returned. Discarded
  // when this function returns, so the org chart itself stays "names +
  // structure only" (ADR-009).
  const textByName = new Map();

  for (const dir of agentDirs(root)) {
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

  // Derive orchestrator->subagent edges from prose for agents that declare no
  // explicit `parent` (the common case). Explicit frontmatter `parent` always
  // wins over a derived one.
  const knownNames = agents.map((a) => a.name);
  for (const agent of agents) {
    if (agent.parent) continue;
    const derived = deriveParentFromText(agent.name, textByName.get(agent.name), knownNames);
    if (derived && derived !== agent.name) agent.parent = derived;
  }

  // Defensive: break a direct 2-cycle from mutual cues (A<->B). The renderers
  // already guard cycles with a `visited` set (never an infinite loop), but a
  // self-consistent chart is cleaner: root the one processed later.
  const byName = new Map(agents.map((a) => [a.name, a]));
  for (const agent of agents) {
    if (!agent.parent) continue;
    const p = byName.get(agent.parent);
    if (p && p.parent === agent.name) p.parent = null;
  }

  return agents;
}

// talents-ai-score, ADR-010: returns `[{ name, description }]` — the ONLY
// function in this module that ever returns description/prompt content.
// Originally used exclusively to build the EPHEMERAL agent-synthesis
// request (src/agent-synthesis.js), which scrubs obvious secrets/PII
// before it ever leaves the machine and never persists this raw text
// (only the LLM's structured synthesis result does, via src/share.js's
// whitelist). Agents without a `description` are still included (empty
// string), so the caller can still send their structural data to the
// synthesis endpoint.
//
// talents-ai-score (user feedback, real-browser testing): ALSO reused now
// as the fallback source for the agent card's own displayed description
// when synthesis doesn't run or doesn't cover an agent — bin/report.js
// attaches this to `report.agentDescriptions`, read by
// render-html.js/render-terminal.js's shared buildAgentCardTree. This is
// a LOCAL-ONLY display use (the report is always shown locally,
// unconditionally, per ADR-011) — strictly LESS exposure than what
// already happens for synthesis (sending it to an external endpoint), so
// no new privacy boundary is crossed. Still never touches the
// persistence payload (src/share.js's derivePayload never reads this
// field — see its own header comment).
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
      if (!fm) continue;
      // Same fallback-to-filename rule as parseAgentFile above, so an
      // agent missing/blank `name` in its frontmatter isn't dropped here
      // either — its description still reaches the synthesis request,
      // matched against the SAME name parseAgentOrgChart will have used.
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

// ADR-016 agent evaluation: returns `[{ name, definition }]` where `definition`
// is the agent's FULL authored definition — its frontmatter `description` PLUS
// its body (the instructions/boundaries/structure the quality score is meant to
// judge). This is distinct from parseAgentDescriptions (frontmatter description
// ONLY, used by synthesis + card display): a large share of real agents put
// their actual definition in the BODY with a thin or absent `description:`, so
// sending the description alone yields an EMPTY definition and the evaluation
// backend omits the agent (degrade-by-omission) → no score. Using the full body
// guarantees a substantial definition to score. Scrubbing happens downstream
// (src/agent-evaluation.js, client + network boundary). Same project ∪ home
// scope + name-fallback rules as parseAgentDescriptions.
function parseAgentDefinitions(root) {
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

module.exports = { parseAgentOrgChart, parseFrontmatter, parseAgentFile, parseAgentDescriptions, parseAgentDefinitions };
