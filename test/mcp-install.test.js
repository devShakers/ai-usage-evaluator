'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { installMcpClients, runMcpInstall, claudeDesktopConfigPath, stableNodePath } = require('../src/mcp-install');
const { buildServerInstructions } = require('../src/mcp-instructions');

const NODE = '/opt/homebrew/bin/node';
const CLI = '/Users/talent/.shakers/bin/shakers.js';

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-install-'));
  const desktop = claudeDesktopConfigPath({ platform: 'darwin', homedir: home, env: {} });
  return { home, desktop, cursor: path.join(home, '.cursor', 'mcp.json') };
}

const noClaudeCli = () => ({ error: new Error('ENOENT'), status: null });

function run(home, extra = {}) {
  return installMcpClients({
    platform: 'darwin',
    homedir: home,
    nodePath: NODE,
    cliPath: CLI,
    env: { PATH: '/opt/homebrew/bin:/usr/bin', SHAKERS_PROFILE: 'talent', SHAKERS_CLI_CERTS_BASE: 'https://certs.example/api/v1', UNRELATED: 'x' },
    spawn: noClaudeCli,
    ...extra,
  });
}

const statusOf = (res, client) => res.results.find((r) => r.client === client).status;

test('install connects the MCP: the Claude Desktop entry starts the CLI by absolute path, not a bare `shakers` a Dock-launched app cannot find', () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  const res = run(home);
  assert.equal(statusOf(res, 'claudeDesktop'), 'configured');
  const written = JSON.parse(fs.readFileSync(desktop, 'utf8'));
  assert.deepEqual(written.mcpServers.shakers, {
    command: NODE,
    args: [CLI, 'mcp'],
    env: { PATH: '/opt/homebrew/bin:/usr/bin', SHAKERS_PROFILE: 'talent', SHAKERS_CLI_CERTS_BASE: 'https://certs.example/api/v1' },
  });
});

test('install connects the MCP: keeps every other key and server of an existing config, and backs the old file up', () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  const before = { preferences: { sidebarMode: 'chat' }, mcpServers: { other: { command: 'x' } } };
  fs.writeFileSync(desktop, JSON.stringify(before));
  run(home);
  const written = JSON.parse(fs.readFileSync(desktop, 'utf8'));
  assert.deepEqual(written.preferences, before.preferences);
  assert.deepEqual(written.mcpServers.other, before.mcpServers.other);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${desktop}.bak`, 'utf8')), before);
});

test('install connects the MCP: replaces the old "shakers-ai-usage" entry the first setup guide published', () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  fs.writeFileSync(desktop, JSON.stringify({ mcpServers: { 'shakers-ai-usage': { command: 'shakers', args: ['mcp'] } } }));
  const res = run(home);
  const desktopResult = res.results.find((r) => r.client === 'claudeDesktop');
  assert.equal(desktopResult.removedLegacy, true);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(desktop, 'utf8')).mcpServers), ['shakers']);
});

test('install connects the MCP: running it twice leaves the config as it was', () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  run(home);
  const first = fs.readFileSync(desktop, 'utf8');
  assert.equal(statusOf(run(home), 'claudeDesktop'), 'unchanged');
  assert.equal(fs.readFileSync(desktop, 'utf8'), first);
});

test('install connects the MCP: a config that is not valid JSON is left untouched', () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  fs.writeFileSync(desktop, '{ "mcpServers": ');
  assert.equal(statusOf(run(home), 'claudeDesktop'), 'invalid-json');
  assert.equal(fs.readFileSync(desktop, 'utf8'), '{ "mcpServers": ');
});

test('install connects the MCP: an `mcpServers` that is not an object is left untouched, not rewritten with numeric keys', () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  fs.writeFileSync(desktop, JSON.stringify({ mcpServers: [{ command: 'x' }] }));
  assert.equal(statusOf(run(home), 'claudeDesktop'), 'invalid-json');
  assert.deepEqual(JSON.parse(fs.readFileSync(desktop, 'utf8')), { mcpServers: [{ command: 'x' }] });
});

test('install connects the MCP: an app that is not installed is reported, not created', () => {
  const { home, desktop, cursor } = sandbox();
  const res = run(home);
  assert.equal(statusOf(res, 'claudeDesktop'), 'not-found');
  assert.equal(statusOf(res, 'cursor'), 'not-found');
  assert.equal(statusOf(res, 'claudeCode'), 'not-found');
  assert.equal(fs.existsSync(desktop), false);
  assert.equal(fs.existsSync(cursor), false);
});

test('install connects the MCP: Cursor gets the same entry in ~/.cursor/mcp.json', () => {
  const { home, cursor } = sandbox();
  fs.mkdirSync(path.dirname(cursor), { recursive: true });
  assert.equal(statusOf(run(home), 'cursor'), 'configured');
  assert.deepEqual(JSON.parse(fs.readFileSync(cursor, 'utf8')).mcpServers.shakers.args, [CLI, 'mcp']);
});

test('install connects the MCP: Claude Code is registered at user scope through its own CLI, replacing a previous entry', () => {
  const { home } = sandbox();
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { status: 0, stdout: '' };
  };
  assert.equal(statusOf(run(home, { spawn }), 'claudeCode'), 'configured');
  assert.ok(calls.some((c) => c.join(' ') === 'claude mcp remove --scope user shakers'));
  const add = calls.find((c) => c[0] === 'claude' && c[2] === 'add');
  // `-e` is variadic in `claude mcp add`: the name must come before it or it is read as a variable.
  assert.deepEqual(add.slice(0, 6), ['claude', 'mcp', 'add', 'shakers', '--scope', 'user']);
  assert.ok(add.includes('SHAKERS_PROFILE=talent'));
  assert.deepEqual(add.slice(add.indexOf('--')), ['--', NODE, CLI, 'mcp']);
});

test('install connects the MCP: asks first, then connects and tells the Talent to restart, in their language', async () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  let printed = '';
  let asked = '';
  await runMcpInstall({ lang: 'en', out: (s) => { printed += s; }, ask: async (q) => { asked = q; return ''; }, platform: 'darwin', homedir: home, nodePath: NODE, cliPath: CLI, env: {}, spawn: noClaudeCli });
  assert.match(printed, /Found: Claude Desktop\./);
  assert.match(asked, /Connect Shakers to them/);
  assert.match(printed, /Claude Desktop: connected/);
  assert.match(printed, /Restart any of these apps/);
  assert.doesNotMatch(printed, /not installed/);
});

test('install connects the MCP: node is referenced through the PATH link, not the versioned path a node upgrade deletes', () => {
  const { home } = sandbox();
  const cellar = path.join(home, 'Cellar', 'node', '25.6.1', 'bin');
  const linkDir = path.join(home, 'homebrew-bin');
  fs.mkdirSync(cellar, { recursive: true });
  fs.mkdirSync(linkDir, { recursive: true });
  fs.writeFileSync(path.join(cellar, 'node'), '#!/bin/sh\n');
  fs.chmodSync(path.join(cellar, 'node'), 0o755);
  fs.symlinkSync(path.join(cellar, 'node'), path.join(linkDir, 'node'));
  assert.equal(stableNodePath({ PATH: `/nonexistent:${linkDir}` }, path.join(cellar, 'node')), path.join(linkDir, 'node'));
  assert.equal(stableNodePath({ PATH: '/nonexistent' }, path.join(cellar, 'node')), path.join(cellar, 'node'));
});

test('install connects the MCP: Gemini CLI and Windsurf get the entry under mcpServers', () => {
  const { home } = sandbox();
  fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ ide: { enabled: true } }));
  fs.mkdirSync(path.join(home, '.codeium', 'windsurf'), { recursive: true });
  const res = run(home);
  assert.equal(statusOf(res, 'geminiCli'), 'configured');
  assert.equal(statusOf(res, 'windsurf'), 'configured');
  const gemini = JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'settings.json'), 'utf8'));
  assert.deepEqual(gemini.ide, { enabled: true });
  assert.deepEqual(gemini.mcpServers.shakers.args, [CLI, 'mcp']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), 'utf8')).mcpServers.shakers.command, NODE);
});

test('install connects the MCP: VS Code gets it under "servers" with the stdio transport, in an empty mcp.json too', () => {
  const { home } = sandbox();
  const dir = path.join(home, 'Library', 'Application Support', 'Code', 'User');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mcp.json'), '');
  assert.equal(statusOf(run(home), 'vscode'), 'configured');
  const vscode = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
  assert.equal(vscode.servers.shakers.type, 'stdio');
  assert.deepEqual(vscode.servers.shakers.args, [CLI, 'mcp']);
  assert.equal(vscode.mcpServers, undefined);
});

test('install connects the MCP: Codex (and ChatGPT in Codex mode) is registered through its own CLI', () => {
  const { home } = sandbox();
  const calls = [];
  const spawn = (cmd, args) => {
    calls.push([cmd, ...args]);
    return cmd === 'codex' ? { status: 0 } : { error: new Error('ENOENT'), status: null };
  };
  assert.equal(statusOf(run(home, { spawn }), 'codex'), 'configured');
  const add = calls.find((c) => c[0] === 'codex' && c[2] === 'add');
  assert.deepEqual(add.slice(0, 4), ['codex', 'mcp', 'add', 'shakers']);
  assert.ok(add.includes('SHAKERS_PROFILE=talent'));
  assert.deepEqual(add.slice(add.indexOf('--')), ['--', NODE, CLI, 'mcp']);
});

test('install connects the MCP: Codex gets a shakers skill, since it hides deferred MCP tools and drops server instructions', () => {
  const { home } = sandbox();
  const spawn = (cmd) => (cmd === 'codex' ? { status: 0 } : { error: new Error('ENOENT'), status: null });
  assert.equal(statusOf(run(home, { spawn }), 'codex'), 'configured');
  const skill = fs.readFileSync(path.join(home, '.codex', 'skills', 'shakers', 'SKILL.md'), 'utf8');
  const [, frontmatter, body] = skill.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.match(frontmatter, /^name: "shakers"$/m);
  const description = JSON.parse(frontmatter.match(/^description: (".*")$/m)[1]);
  assert.ok(description.length <= 1024);
  for (const word of ['Shakers', 'sign up', 'registro', 'alta']) assert.ok(description.includes(word), word);
  assert.ok(body.includes("ALL_TOOLS"));
  assert.ok(body.includes('tools.mcp__shakers__signup_start'));
  assert.ok(body.includes(buildServerInstructions({ elicitation: true })));
});

test('install connects the MCP: the Codex skill follows CODEX_HOME', () => {
  const { home } = sandbox();
  const codexHome = path.join(home, 'custom-codex');
  const spawn = (cmd) => (cmd === 'codex' ? { status: 0 } : { error: new Error('ENOENT'), status: null });
  run(home, { spawn, env: { PATH: '/usr/bin', CODEX_HOME: codexHome } });
  assert.ok(fs.existsSync(path.join(codexHome, 'skills', 'shakers', 'SKILL.md')));
});

test('install connects the MCP: a "no" leaves every app untouched', async () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  let printed = '';
  const res = await runMcpInstall({ lang: 'es', out: (s) => { printed += s; }, ask: async () => 'n', platform: 'darwin', homedir: home, nodePath: NODE, cliPath: CLI, env: {}, spawn: noClaudeCli });
  assert.equal(res.declined, true);
  assert.equal(fs.existsSync(desktop), false);
  assert.match(printed, /No he tocado nada/);
});

test('install connects the MCP: with no terminal to ask on, nothing is touched', async () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  const res = await runMcpInstall({ lang: 'en', out: () => {}, ask: async () => null, platform: 'darwin', homedir: home, nodePath: NODE, cliPath: CLI, env: {}, spawn: noClaudeCli });
  assert.equal(res.declined, true);
  assert.equal(fs.existsSync(desktop), false);
});

test('install connects the MCP: SHAKERS_MCP_INSTALL=1 connects without asking', async () => {
  const { home, desktop } = sandbox();
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  const ask = async () => { throw new Error('must not ask'); };
  await runMcpInstall({ lang: 'en', out: () => {}, ask, platform: 'darwin', homedir: home, nodePath: NODE, cliPath: CLI, env: { SHAKERS_MCP_INSTALL: '1' }, spawn: noClaudeCli });
  assert.ok(fs.existsSync(desktop));
});
