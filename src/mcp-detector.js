'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

/*
 * Deterministic (no-LLM) MCP server detector BY NAME (talents-ai-score,
 * issue 015 / ADR-013-014) — extends the existing count-only MCP signal
 * (`tool.depth.mcpServers`, scanner.js) with WHICH servers are configured
 * and what KIND they are.
 *
 * Source: KNOWN MCP config locations only — a mix of project and home
 * paths, per each tool's own convention (ADR-014's "proyecto ∪ home" scope,
 * applied here from the start since this is a new detector):
 *   - `<root>/.mcp.json`                              (Claude Code, project)
 *   - `<home>/.claude.json`                            (Claude Code, home)
 *   - `<root>/.cursor/mcp.json`                        (Cursor, project)
 *   - `<home>/.codeium/windsurf/mcp_config.json`        (Windsurf, home)
 *   - `<home>/.gemini/settings.json`                    (Gemini CLI, home)
 *
 * What's extracted: ONLY the `mcpServers` object's top-level KEYS (server
 * names) from each file — never the values, which can carry commands, URLs,
 * or environment variables (potential secrets). Names are deduped across
 * every location (a server configured in two places is one capability, not
 * two) and categorized by a keyword heuristic into
 * `data | comms | dev | browser | other` — a derived signal, never the raw
 * config. `browser` feeds issue 018's browser-tools detector.
 *
 * Heuristic caveat (same ageing-catalog spirit as detectors.js/ADR-001):
 * the keyword lists below are a best-effort snapshot of common MCP server
 * names in the ecosystem as of this writing, not an official registry —
 * expect false "other" categorizations for niche/new servers, never a
 * false category for a name that doesn't match (defaults to "other").
 */

const CATEGORY_KEYWORDS = {
  data: [
    'postgres', 'postgresql', 'mysql', 'sqlite', 'mongo', 'redis', 'snowflake',
    'bigquery', 'elastic', 'supabase', 'airtable', 'sheet', 'drive', 'database',
    'notion', 'dynamodb', 'clickhouse',
  ],
  comms: [
    'slack', 'discord', 'gmail', 'email', 'mail', 'teams', 'telegram',
    'whatsapp', 'twilio', 'sms', 'zoom',
  ],
  dev: [
    'github', 'gitlab', 'git', 'filesystem', 'docker', 'kubernetes', 'k8s',
    'sentry', 'linear', 'jira', 'figma', 'aws', 'terraform', 'cloudflare',
    'vercel', 'netlify', 'bitbucket', 'confluence',
  ],
  browser: [
    'playwright', 'puppeteer', 'browser', 'chrome', 'chromium', 'browserbase',
    'stagehand', 'browser-use',
  ],
};

const CATEGORY_ORDER = ['data', 'comms', 'dev', 'browser'];

function categorizeMcpServerName(name) {
  const lower = String(name).toLowerCase();
  for (const category of CATEGORY_ORDER) {
    if (CATEGORY_KEYWORDS[category].some((kw) => lower.includes(kw))) return category;
  }
  return 'other';
}

function knownMcpConfigPaths(root) {
  const home = getHomeDir();
  return [
    path.join(root, '.mcp.json'),
    path.join(home, '.claude.json'),
    path.join(root, '.cursor', 'mcp.json'),
    path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    path.join(home, '.gemini', 'settings.json'),
  ];
}

// Reads ONLY the `mcpServers` object's top-level keys from one config file.
// Never reads or returns any value under those keys.
function readMcpServerNames(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return [];
  }
  const servers = obj && typeof obj === 'object' ? obj.mcpServers : null;
  return servers && typeof servers === 'object' ? Object.keys(servers) : [];
}

// Deterministic (no-LLM) MCP-by-name detection, scoped to KNOWN config
// locations only (project ∪ home). Never throws — missing files, malformed
// JSON, or an unreadable home directory all degrade to "nothing found" for
// that location, never breaking detection of the others.
function detectMcpServers(root) {
  const names = new Set();
  for (const file of knownMcpConfigPaths(root)) {
    for (const name of readMcpServerNames(file)) names.add(name);
  }

  const servers = [...names]
    .sort()
    .map((name) => ({ name, category: categorizeMcpServerName(name) }));

  const countsByCategory = { data: 0, comms: 0, dev: 0, browser: 0, other: 0 };
  for (const s of servers) countsByCategory[s.category] += 1;

  return { servers, countsByCategory, total: servers.length };
}

module.exports = { detectMcpServers, categorizeMcpServerName };
