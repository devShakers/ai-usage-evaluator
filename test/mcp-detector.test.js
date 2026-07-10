'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectMcpServers } = require('../src/mcp-detector');

/*
 * talents-ai-score, issue 015 (ADR-013/014): deterministic (no-LLM) MCP
 * server detector BY NAME, not just count. Reads only KNOWN MCP config
 * locations (`.mcp.json`, `~/.claude.json`, `.cursor/mcp.json`,
 * `~/.codeium/windsurf/mcp_config.json`, `~/.gemini/settings.json`) — a mix
 * of project and home paths per each tool's own convention (ADR-014 scope:
 * project ∪ home). Extracts ONLY the `mcpServers` object's top-level KEYS
 * (server names) — never values (which can carry URLs, command args, env
 * vars). Categorizes each name by heuristic into data/comms/dev/browser/
 * other — a derived signal, never the raw config.
 */

let tmpProject;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-mcp-project-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-mcp-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function write(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('detectMcpServers: no config files anywhere -> empty result, never throws', () => {
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers, []);
  assert.deepEqual(result.countsByCategory, { data: 0, comms: 0, dev: 0, browser: 0, other: 0 });
  assert.equal(result.total, 0);
});

test('detectMcpServers: parses .mcp.json (project) server names', () => {
  write(tmpProject, '.mcp.json', JSON.stringify({ mcpServers: { postgres: { command: 'x' }, github: {} } }));
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers.map((s) => s.name).sort(), ['github', 'postgres']);
});

test('detectMcpServers: parses ~/.claude.json (home) server names', () => {
  write(tmpHome, '.claude.json', JSON.stringify({ mcpServers: { slack: {} } }));
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers.map((s) => s.name), ['slack']);
});

test('detectMcpServers: parses .cursor/mcp.json (project) server names', () => {
  write(tmpProject, '.cursor/mcp.json', JSON.stringify({ mcpServers: { figma: {} } }));
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers.map((s) => s.name), ['figma']);
});

test('detectMcpServers: parses ~/.codeium/windsurf/mcp_config.json (home) server names', () => {
  write(tmpHome, '.codeium/windsurf/mcp_config.json', JSON.stringify({ mcpServers: { playwright: {} } }));
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers.map((s) => s.name), ['playwright']);
});

test('detectMcpServers: parses ~/.gemini/settings.json (home) server names', () => {
  write(tmpHome, '.gemini/settings.json', JSON.stringify({ mcpServers: { 'google-drive': {} } }));
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers.map((s) => s.name), ['google-drive']);
});

test('detectMcpServers: merges across ALL known locations, dedupes by name, sorted', () => {
  write(tmpProject, '.mcp.json', JSON.stringify({ mcpServers: { postgres: {} } }));
  write(tmpHome, '.claude.json', JSON.stringify({ mcpServers: { postgres: {}, slack: {} } }));
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers.map((s) => s.name).sort(), ['postgres', 'slack']);
  assert.equal(result.total, 2);
});

test('detectMcpServers: categorizes known names by heuristic (data/comms/dev/browser)', () => {
  write(tmpProject, '.mcp.json', JSON.stringify({
    mcpServers: {
      postgres: {}, // data
      slack: {}, // comms
      github: {}, // dev
      playwright: {}, // browser
      'some-totally-unknown-thing': {}, // other
    },
  }));
  const result = detectMcpServers(tmpProject);
  const byName = Object.fromEntries(result.servers.map((s) => [s.name, s.category]));
  assert.equal(byName.postgres, 'data');
  assert.equal(byName.slack, 'comms');
  assert.equal(byName.github, 'dev');
  assert.equal(byName.playwright, 'browser');
  assert.equal(byName['some-totally-unknown-thing'], 'other');
  assert.deepEqual(result.countsByCategory, { data: 1, comms: 1, dev: 1, browser: 1, other: 1 });
});

test('detectMcpServers: malformed JSON in one config does not break detection of the others', () => {
  write(tmpProject, '.mcp.json', '{ not valid json');
  write(tmpHome, '.claude.json', JSON.stringify({ mcpServers: { slack: {} } }));
  const result = detectMcpServers(tmpProject);
  assert.deepEqual(result.servers.map((s) => s.name), ['slack']);
});

test('detectMcpServers: never returns the raw config value (only names + category), even if a value looks sensitive', () => {
  write(tmpProject, '.mcp.json', JSON.stringify({
    mcpServers: { postgres: { command: 'psql', env: { PGPASSWORD: 'super-secret-value' } } },
  }));
  const result = detectMcpServers(tmpProject);
  assert.equal(JSON.stringify(result).includes('super-secret-value'), false);
  assert.equal(JSON.stringify(result).includes('psql'), false);
  assert.deepEqual(Object.keys(result.servers[0]).sort(), ['category', 'name']);
});

test('detectMcpServers: never throws on missing home directory permissions/paths', () => {
  process.env.AI_FOOTPRINT_HOME_DIR = path.join(tmpHome, 'does-not-exist-at-all');
  assert.doesNotThrow(() => detectMcpServers(tmpProject));
});
