'use strict';

// Run by install.sh as its last step: points every MCP client found on this machine at this CLI's
// `mcp` server. Absolute paths, because Claude Desktop launched from the Dock has no
// shell PATH and a bare `"command": "shakers"` never starts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildServerInstructions } = require('./mcp-instructions');

const SERVER_NAME = 'shakers';
// The name the first published setup guide used.
const LEGACY_SERVER_NAME = 'shakers-ai-usage';
const FORWARDED_ENV = [
  'SHAKERS_PROFILE',
  'SHAKERS_CLI_CERTS_BASE',
  'SHAKERS_CLI_HUB_BASE',
  'SHAKERS_CLI_PROFILE_URL',
  'SHAKERS_CLI_INGEST_ENDPOINT',
];

// The `node` the shell finds on PATH, unresolved: Homebrew's /opt/homebrew/bin/node survives
// `brew upgrade node`, the versioned Cellar path process.execPath points at does not.
function stableNodePath(env, execPath) {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, exe);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.realpathSync(candidate) === fs.realpathSync(execPath)) return candidate;
    } catch {
      // not this one
    }
  }
  return execPath;
}

function serverEntry({ nodePath, cliPath, env }) {
  const entryEnv = {};
  if (env.PATH) entryEnv.PATH = env.PATH;
  for (const key of FORWARDED_ENV) if (env[key]) entryEnv[key] = env[key];
  return { command: nodePath, args: [cliPath, 'mcp'], env: entryEnv };
}

function claudeDesktopConfigPath({ platform, homedir, env }) {
  if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return path.join(homedir, '.config', 'Claude', 'claude_desktop_config.json');
}

function writeJsonAtomic(file, value, mode) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, file);
}

const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Merges our entry into a client's JSON config, leaving every other key as it was.
function installIntoJsonConfig(file, entry, key = 'mcpServers') {
  if (!fs.existsSync(path.dirname(file))) return { status: 'not-found' };
  let config = {};
  let mode = 0o600;
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    try {
      config = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      return { status: 'invalid-json' };
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return { status: 'invalid-json' };
    mode = fs.statSync(file).mode & 0o777;
  }
  const current = config[key];
  if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) {
    return { status: 'invalid-json' };
  }
  const servers = current || {};
  const legacy = Object.prototype.hasOwnProperty.call(servers, LEGACY_SERVER_NAME);
  if (!legacy && sameEntry(servers[SERVER_NAME], entry)) return { status: 'unchanged' };

  const next = { ...config, [key]: { ...servers, [SERVER_NAME]: entry } };
  delete next[key][LEGACY_SERVER_NAME];
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  writeJsonAtomic(file, next, mode);
  return { status: 'configured', removedLegacy: legacy };
}

function installIntoClaudeCode(entry, { spawn }) {
  spawn('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME], { encoding: 'utf8' });
  const envFlags = Object.entries(entry.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const added = spawn(
    'claude',
    // Name first: `-e` takes every value up to `--`, so a name after it is read as one more variable.
    ['mcp', 'add', SERVER_NAME, '--scope', 'user', ...envFlags, '--', entry.command, ...entry.args],
    { encoding: 'utf8' },
  );
  if (added.error || added.status !== 0) return { status: 'failed' };
  return { status: 'configured' };
}

const CODEX_SKILL_DESCRIPTION = 'The tools of the `shakers` MCP server (deferred: find them in ALL_TOOLS). Shakers, the freelance talent marketplace: sign up or register (registro, alta, darse de alta, crear cuenta, inscription, cadastro), sign in, onboarding interview, profile, roles, rates, availability, open projects and positions, applications, certifications and the AI-usage report. Use whenever the talent mentions Shakers or the shakers MCP server, or wants to join it.';

// Codex hides deferred MCP tools from the prompt and never forwards server instructions, so this skill is how its model learns Shakers exists.
function codexSkill() {
  return [
    '---',
    `name: "${SERVER_NAME}"`,
    `description: ${JSON.stringify(CODEX_SKILL_DESCRIPTION)}`,
    '---',
    '',
    '# Shakers',
    '',
    'Every Shakers action is a tool of the `shakers` MCP server. They are deferred: they are not in your tool list, but `exec` has them as `tools.mcp__shakers__<name>` and lists them in `ALL_TOOLS` (filter by `name.startsWith(\'mcp__shakers__\')`). Never say you have no Shakers tools without checking `ALL_TOOLS`. The tool names below are those `<name>`s: to sign the talent up, call `tools.mcp__shakers__signup_start` first.',
    '',
    '## Server instructions',
    '',
    buildServerInstructions({ elicitation: true }),
    '',
  ].join('\n');
}

function installCodexSkill({ env, homedir }) {
  const dir = path.join(env.CODEX_HOME || path.join(homedir, '.codex'), 'skills', SERVER_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), codexSkill());
}

function installIntoCodex(entry, { spawn, env, homedir }) {
  spawn('codex', ['mcp', 'remove', SERVER_NAME], { encoding: 'utf8' });
  const envFlags = Object.entries(entry.env).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
  const added = spawn('codex', ['mcp', 'add', SERVER_NAME, ...envFlags, '--', entry.command, ...entry.args], { encoding: 'utf8' });
  if (added.error || added.status !== 0) return { status: 'failed' };
  installCodexSkill({ env, homedir });
  return { status: 'configured' };
}

function vscodeUserDir({ platform, homedir, env }) {
  if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support', 'Code', 'User');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'Code', 'User');
  return path.join(homedir, '.config', 'Code', 'User');
}

function clientTable({ env, platform, homedir, spawn }) {
  const hasCli = (bin) => {
    const probe = spawn(bin, ['--version'], { encoding: 'utf8' });
    return !probe.error && probe.status === 0;
  };
  const jsonClient = (client, file, key, shape = (entry) => entry) => ({
    client,
    found: () => fs.existsSync(path.dirname(file)),
    install: (entry) => installIntoJsonConfig(file, shape(entry), key),
  });
  return [
    jsonClient('claudeDesktop', claudeDesktopConfigPath({ platform, homedir, env })),
    { client: 'claudeCode', found: () => hasCli('claude'), install: (entry) => installIntoClaudeCode(entry, { spawn }) },
    jsonClient('cursor', path.join(homedir, '.cursor', 'mcp.json')),
    jsonClient('geminiCli', path.join(homedir, '.gemini', 'settings.json')),
    { client: 'codex', found: () => hasCli('codex'), install: (entry) => installIntoCodex(entry, { spawn, env, homedir }) },
    // VS Code keys servers under "servers" and wants the transport spelled out.
    jsonClient('vscode', path.join(vscodeUserDir({ platform, homedir, env }), 'mcp.json'), 'servers', (entry) => ({ type: 'stdio', ...entry })),
    jsonClient('windsurf', path.join(homedir, '.codeium', 'windsurf', 'mcp_config.json')),
  ];
}

const guard = (task) => {
  try {
    return task();
  } catch {
    return { status: 'failed' };
  }
};

/** The AI apps on this machine that can take the MCP. */
function detectMcpClients({ env = process.env, platform = process.platform, homedir = os.homedir(), spawn = spawnSync } = {}) {
  return clientTable({ env, platform, homedir, spawn })
    .filter((c) => guard(() => c.found()) === true)
    .map((c) => c.client);
}

function installMcpClients({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  nodePath = stableNodePath(env, process.execPath),
  cliPath = fs.realpathSync(path.join(__dirname, '..', 'bin', 'shakers.js')),
  spawn = spawnSync,
} = {}) {
  const entry = serverEntry({ nodePath, cliPath, env });
  return {
    entry,
    results: clientTable({ env, platform, homedir, spawn }).map((c) => ({
      client: c.client,
      ...(guard(() => c.found()) === true ? guard(() => c.install(entry)) : { status: 'not-found' }),
    })),
  };
}

// The Talent's answer, read from the terminal: under `curl | bash` stdin is the script.
function askTerminal(question) {
  let fd;
  try {
    fd = fs.openSync('/dev/tty', 'r+');
  } catch {
    return Promise.resolve(null);
  }
  const tty = require('tty');
  const readline = require('readline');
  const input = new tty.ReadStream(fd);
  const output = new tty.WriteStream(fd);
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      input.destroy();
      output.destroy();
      resolve(answer);
    });
  });
}

/**
 * Asks before touching the Talent's AI apps. SHAKERS_MCP_INSTALL=1 answers yes
 * without asking; with no terminal to ask on, nothing is touched.
 */
async function runMcpInstall({ out = (s) => process.stdout.write(s), lang = null, ask = askTerminal, ...deps } = {}) {
  const { getCatalog, detectFlowLang } = require('./i18n');
  const c = getCatalog(lang || detectFlowLang()).mcpInstall;
  const env = deps.env || process.env;
  const found = detectMcpClients(deps);
  out(`\n  ${c.title}\n\n`);
  if (found.length === 0) {
    out(`  ${c.noneFound}\n\n`);
    return { ok: true, results: [] };
  }
  out(`  ${c.found(found.map((client) => c.clients[client]).join(', '))}\n`);
  let yes = env.SHAKERS_MCP_INSTALL === '1';
  if (!yes) {
    const answer = await ask(`  ${c.confirm} `);
    if (answer === null) {
      out(`\n  ${c.noTerminal}\n\n`);
      return { ok: true, results: [], declined: true };
    }
    yes = !/^\s*(n|no)\s*$/i.test(answer);
  }
  if (!yes) {
    out(`\n  ${c.declined}\n\n`);
    return { ok: true, results: [], declined: true };
  }

  const { results } = installMcpClients(deps);
  out('\n');
  for (const r of results.filter((x) => x.status !== 'not-found')) {
    out(`  ${c.clients[r.client]}: ${c.status[r.status]}\n`);
    if (r.removedLegacy) out(`    ${c.removedLegacy}\n`);
  }
  out(`\n  ${c.restart}\n\n`);
  if (results.some((r) => r.status === 'failed' || r.status === 'invalid-json')) process.exitCode = 1;
  return { ok: true, results };
}

module.exports = { installCodexSkill, detectMcpClients, installMcpClients, stableNodePath, runMcpInstall, serverEntry, claudeDesktopConfigPath, SERVER_NAME, LEGACY_SERVER_NAME };
