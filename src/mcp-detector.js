'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

// KEYWORD -> { SERVICE LABEL, CATEGORY } (issue 110).
const SERVICE_CATALOG = [
  // --- data ---
  { kw: 'postgresql', label: 'Postgres', category: 'data' },
  { kw: 'postgres', label: 'Postgres', category: 'data' },
  { kw: 'mysql', label: 'MySQL', category: 'data' },
  { kw: 'sqlite', label: 'SQLite', category: 'data' },
  { kw: 'mongo', label: 'MongoDB', category: 'data' },
  { kw: 'redis', label: 'Redis', category: 'data' },
  { kw: 'snowflake', label: 'Snowflake', category: 'data' },
  { kw: 'bigquery', label: 'BigQuery', category: 'data' },
  { kw: 'clickhouse', label: 'ClickHouse', category: 'data' },
  { kw: 'dynamodb', label: 'DynamoDB', category: 'data' },
  { kw: 'elastic', label: 'Elasticsearch', category: 'data' },
  { kw: 'supabase', label: 'Supabase', category: 'data' },
  { kw: 'airtable', label: 'Airtable', category: 'data' },
  { kw: 'notion', label: 'Notion', category: 'data' },
  { kw: 'looker', label: 'Looker', category: 'data' },
  { kw: 'attio', label: 'Attio', category: 'data' },
  { kw: 'sheet', label: 'Google Sheets', category: 'data' },
  { kw: 'drive', label: 'Google Drive', category: 'data' },
  { kw: 'database', label: null, category: 'data' },
  // --- comms ---
  { kw: 'slack', label: 'Slack', category: 'comms' },
  { kw: 'discord', label: 'Discord', category: 'comms' },
  { kw: 'gmail', label: 'Gmail', category: 'comms' },
  { kw: 'teams', label: 'Microsoft Teams', category: 'comms' },
  { kw: 'telegram', label: 'Telegram', category: 'comms' },
  { kw: 'whatsapp', label: 'WhatsApp', category: 'comms' },
  { kw: 'twilio', label: 'Twilio', category: 'comms' },
  { kw: 'zoom', label: 'Zoom', category: 'comms' },
  { kw: 'email', label: null, category: 'comms' },
  { kw: 'mail', label: null, category: 'comms' },
  { kw: 'sms', label: null, category: 'comms' },
  // --- dev ---
  { kw: 'github', label: 'GitHub', category: 'dev' },
  { kw: 'gitlab', label: 'GitLab', category: 'dev' },
  { kw: 'bitbucket', label: 'Bitbucket', category: 'dev' },
  { kw: 'kubernetes', label: 'Kubernetes', category: 'dev' },
  { kw: 'k8s', label: 'Kubernetes', category: 'dev' },
  { kw: 'docker', label: 'Docker', category: 'dev' },
  { kw: 'sentry', label: 'Sentry', category: 'dev' },
  { kw: 'linear', label: 'Linear', category: 'dev' },
  { kw: 'jira', label: 'Jira', category: 'dev' },
  { kw: 'confluence', label: 'Confluence', category: 'dev' },
  { kw: 'figma', label: 'Figma', category: 'dev' },
  { kw: 'terraform', label: 'Terraform', category: 'dev' },
  { kw: 'cloudflare', label: 'Cloudflare', category: 'dev' },
  { kw: 'vercel', label: 'Vercel', category: 'dev' },
  { kw: 'netlify', label: 'Netlify', category: 'dev' },
  { kw: 'railway', label: 'Railway', category: 'dev' },
  { kw: 'context7', label: 'Context7', category: 'dev' },
  { kw: 'aws', label: 'AWS', category: 'dev' },
  { kw: 'filesystem', label: 'Filesystem', category: 'dev' },
  { kw: 'git', label: null, category: 'dev' },
  // --- browser ---
  { kw: 'playwright', label: 'Playwright', category: 'browser' },
  { kw: 'puppeteer', label: 'Puppeteer', category: 'browser' },
  { kw: 'browserbase', label: 'Browserbase', category: 'browser' },
  { kw: 'browser-use', label: 'Browser Use', category: 'browser' },
  { kw: 'stagehand', label: 'Stagehand', category: 'browser' },
  { kw: 'chromium', label: 'Chromium', category: 'browser' },
  { kw: 'chrome', label: 'Chrome', category: 'browser' },
  { kw: 'browser', label: null, category: 'browser' },
];

// ORDER IS BEHAVIOUR, and it is preserved from the previous table on purpose.
function matchService(name) {
  const lower = String(name).toLowerCase();
  return SERVICE_CATALOG.find((entry) => lower.includes(entry.kw)) || null;
}

function categorizeMcpServerName(name) {
  const hit = matchService(name);
  return hit ? hit.category : 'other';
}

// The product behind a server name, or `null` when the name does not carry one.
function serviceForMcpServerName(name) {
  const hit = matchService(name);
  return hit && hit.label ? hit.label : null;
}

// THE single inventory of MCP config locations (issue 112).
const MCP_CONFIG_LOCATIONS = [
  // --- Claude Code (already read before 112) ---
  { tool: 'claude-code', scope: 'project', keys: ['mcpServers'], confidence: 'high', file: (root) => path.join(root, '.mcp.json') },
  { tool: 'claude-code', scope: 'home', keys: ['mcpServers'], confidence: 'high', file: (root, home) => path.join(home, '.claude.json') },
  // --- Cursor: the project one was read, the GLOBAL one was the bug ---
  { tool: 'cursor', scope: 'project', keys: ['mcpServers'], confidence: 'high', file: (root) => path.join(root, '.cursor', 'mcp.json') },
  { tool: 'cursor', scope: 'home', keys: ['mcpServers'], confidence: 'high', file: (root, home) => path.join(home, '.cursor', 'mcp.json') },
  // --- Windsurf (home only; no project-level MCP config known) ---
  { tool: 'windsurf', scope: 'home', keys: ['mcpServers'], confidence: 'medium', file: (root, home) => path.join(home, '.codeium', 'windsurf', 'mcp_config.json') },
  // --- Gemini CLI: home was read; the project-level settings file was not ---
  { tool: 'gemini-cli', scope: 'home', keys: ['mcpServers'], confidence: 'medium', file: (root, home) => path.join(home, '.gemini', 'settings.json') },
  { tool: 'gemini-cli', scope: 'project', keys: ['mcpServers'], confidence: 'medium', file: (root) => path.join(root, '.gemini', 'settings.json') },
  // VS Code: `servers`, not `mcpServers`, and three OS-specific user paths.
  { tool: null, scope: 'project', keys: ['servers', 'mcpServers'], confidence: 'medium', file: (root) => path.join(root, '.vscode', 'mcp.json') },
  { tool: null, scope: 'home', keys: ['servers', 'mcpServers'], confidence: 'medium', file: (root, home) => path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json') },
  { tool: null, scope: 'home', keys: ['servers', 'mcpServers'], confidence: 'medium', file: (root, home) => path.join(home, '.config', 'Code', 'User', 'mcp.json') },
  { tool: null, scope: 'home', keys: ['servers', 'mcpServers'], confidence: 'medium', file: (root, home) => path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json') },
  // --- Claude Desktop: same `mcpServers` shape, three OS-specific paths ---
  { tool: null, scope: 'home', keys: ['mcpServers'], confidence: 'medium', file: (root, home) => path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') },
  { tool: null, scope: 'home', keys: ['mcpServers'], confidence: 'medium', file: (root, home) => path.join(home, '.config', 'Claude', 'claude_desktop_config.json') },
  { tool: null, scope: 'home', keys: ['mcpServers'], confidence: 'medium', file: (root, home) => path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json') },
];

// Reads ONLY the top-level keys of the server map from one config file, trying
// each declared key in order. Never reads or returns any value under those keys.
function readMcpServerNames(file, keys = ['mcpServers']) {
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
  if (!obj || typeof obj !== 'object') return [];
  for (const key of keys) {
    const servers = obj[key];
    if (servers && typeof servers === 'object' && !Array.isArray(servers)) return Object.keys(servers);
  }
  return [];
}

// Deterministic (no-LLM) MCP-by-name detection over every location in `MCP_CONFIG_LOCATIONS` (project ∪ home).
function detectMcpServers(root) {
  const home = getHomeDir();
  // name -> { scopes:Set, tools:Set }
  const found = new Map();
  const byTool = {};

  for (const loc of MCP_CONFIG_LOCATIONS) {
    let file;
    try {
      file = loc.file(root, home);
    } catch {
      continue; // an unresolvable home never breaks the other locations
    }
    const names = readMcpServerNames(file, loc.keys);
    if (loc.tool && names.length) {
      // Per-tool count is the union across THAT tool's own locations, so a
      // server configured both in the project and globally counts once for it.
      const set = byTool[`__set_${loc.tool}`] || (byTool[`__set_${loc.tool}`] = new Set());
      for (const n of names) set.add(n);
    }
    for (const name of names) {
      const entry = found.get(name) || { scopes: new Set(), tools: new Set() };
      entry.scopes.add(loc.scope);
      if (loc.tool) entry.tools.add(loc.tool);
      found.set(name, entry);
    }
  }

  // Collapse the per-tool sets into plain counts (and drop the working keys).
  for (const key of Object.keys(byTool)) {
    if (key.startsWith('__set_')) {
      byTool[key.slice('__set_'.length)] = byTool[key].size;
      delete byTool[key];
    }
  }

  const servers = [...found.keys()]
    .sort()
    .map((name) => {
      const entry = found.get(name);
      return {
        name,
        category: categorizeMcpServerName(name),
        // 'project' wins when a server is declared in both: the most specific
        // scope is the honest label for "this repo uses it".
        scope: entry.scopes.has('project') ? 'project' : 'home',
        // Issue 110: the PRODUCT, derived from the name only. `null` when the
        // name carries none — a state, not a hole.
        service: serviceForMcpServerName(name),
      };
    });

  return buildMcpAggregate(servers, byTool);
}

// Builds the report's `mcp` block from an already-resolved server list + the per-tool counts.
function buildMcpAggregate(servers, byTool = {}) {
  const sorted = [...servers].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const countsByCategory = { data: 0, comms: 0, dev: 0, browser: 0, other: 0 };
  for (const s of sorted) countsByCategory[s.category] += 1;

  const byService = new Map();
  let unidentified = 0;
  for (const s of sorted) {
    if (!s.service) {
      unidentified += 1;
      continue;
    }
    byService.set(s.service, (byService.get(s.service) || 0) + 1);
  }
  const services = [...byService.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));

  return { servers: sorted, services, unidentified, countsByCategory, total: sorted.length, byTool };
}

module.exports = {
  detectMcpServers,
  buildMcpAggregate,
  categorizeMcpServerName,
  serviceForMcpServerName,
  MCP_CONFIG_LOCATIONS,
  SERVICE_CATALOG,
};
