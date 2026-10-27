'use strict';

// Run by install.sh as its last step: points every MCP client found on this machine at this CLI's
// `mcp` server. Absolute paths, because Claude Desktop launched from the Dock has no
// shell PATH and a bare `"command": "shakers"` never starts.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildServerInstructions } = require('./mcp-instructions');

const { SERVER_NAME, LEGACY_SERVER_NAME } = require('./mcp-server-name');
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

const pathFor = (platform) => (platform === 'win32' ? path.win32 : path.posix);

function realpathOr(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

function insideNpxCache(file, { env, platform, homedir }) {
  const p = pathFor(platform);
  const defaultCache = platform === 'win32'
    ? p.join(env.LOCALAPPDATA || p.join(homedir, 'AppData', 'Local'), 'npm-cache')
    : p.join(homedir, '.npm');
  return [env.npm_config_cache, defaultCache].filter(Boolean).flatMap((dir) => [dir, realpathOr(dir)]).some((dir) => {
    const rel = p.relative(p.join(dir, '_npx'), file);
    return rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel);
  });
}

function withoutNpxBins(value, where) {
  const p = pathFor(where.platform);
  return value.split(p.delimiter).filter((dir) => {
    const parts = p.normalize(dir).split(p.sep);
    const [last, parent] = [parts[parts.length - 1], parts[parts.length - 2]];
    return !(last === 'node-gyp-bin' || (last === '.bin' && parent === 'node_modules') || insideNpxCache(dir, where));
  }).join(p.delimiter);
}

function npxNextTo(nodePath) {
  const candidate = path.join(path.dirname(nodePath), 'npx');
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return 'npx';
  }
}

function serverEntry({ nodePath, cliPath, env, platform = process.platform, homedir = os.homedir(), packageName }) {
  const where = { env, platform, homedir };
  const viaNpx = insideNpxCache(cliPath, where);
  const entryEnv = {};
  const pathValue = env.PATH && viaNpx ? withoutNpxBins(env.PATH, where) : env.PATH;
  if (pathValue) entryEnv.PATH = pathValue;
  for (const key of FORWARDED_ENV) if (env[key]) entryEnv[key] = env[key];
  if (!viaNpx) return { command: nodePath, args: [cliPath, 'mcp'], env: entryEnv };
  const npxArgs = ['-y', packageName, 'mcp'];
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'npx', ...npxArgs], env: entryEnv };
  return { command: npxNextTo(nodePath), args: npxArgs, env: entryEnv };
}

function claudeDesktopConfigPath({ platform, homedir, env }) {
  if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return path.join(homedir, '.config', 'Claude', 'claude_desktop_config.json');
}

function backUpThenWrite(file, text, mode) {
  const bak = `${file}.bak`;
  if (fs.existsSync(file)) {
    fs.writeFileSync(bak, fs.readFileSync(file), { mode: 0o600 });
    fs.chmodSync(bak, 0o600);
  }
  writeFileAtomic(file, text, mode);
  fs.rmSync(bak, { force: true });
}

function writeFileAtomic(file, text, mode) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeSync(fd, text);
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
      return { status: 'invalid-config' };
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return { status: 'invalid-config' };
    mode = fs.statSync(file).mode & 0o777;
  }
  const current = config[key];
  if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) {
    return { status: 'invalid-config' };
  }
  const servers = current || {};
  const legacy = Object.prototype.hasOwnProperty.call(servers, LEGACY_SERVER_NAME);
  if (!legacy && sameEntry(servers[SERVER_NAME], entry)) return { status: 'unchanged' };

  const next = { ...config, [key]: { ...servers, [SERVER_NAME]: entry } };
  delete next[key][LEGACY_SERVER_NAME];
  backUpThenWrite(file, `${JSON.stringify(next, null, 2)}\n`, mode);
  return { status: 'configured', removedLegacy: legacy };
}

const TOML_ESCAPES = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };
const tomlString = (s) => `"${String(s).replace(/["\\\u0000-\u001f\u007f]/g, (ch) => TOML_ESCAPES[ch] || `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k));

function tomlServerBlock(entry, eol = '\n') {
  const env = Object.entries(entry.env || {});
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(', ')}]`,
    ...(env.length ? [`env = { ${env.map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`).join(', ')} }`] : []),
    'startup_timeout_sec = 30',
    '',
  ].join(eol);
}

function parseTomlKeyPath(text) {
  const keys = [];
  let rest = text.trim();
  while (rest) {
    const m = rest.match(/^(?:([A-Za-z0-9_-]+)|"((?:[^"\\]|\\.)*)"|'([^']*)')\s*/);
    if (!m) return null;
    keys.push(m[1] ?? (m[2] !== undefined ? JSON.parse(`"${m[2]}"`) : m[3]));
    rest = rest.slice(m[0].length);
    if (!rest) break;
    if (rest[0] !== '.') return null;
    rest = rest.slice(1).trimStart();
    if (!rest) return null;
  }
  return keys.length ? keys : null;
}

function scanTomlValue(line, state) {
  let i = 0;
  while (i < line.length) {
    if (state.multiline) {
      const end = line.indexOf(state.multiline, i);
      if (end === -1) return;
      i = end + 3;
      state.multiline = null;
      continue;
    }
    const ch = line[i];
    if (ch === '#') return;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      state.multiline = line.slice(i, i + 3);
      i += 3;
    } else if (ch === '"' || ch === "'") {
      i += 1;
      while (i < line.length && line[i] !== ch) i += ch === '"' && line[i] === '\\' ? 2 : 1;
      i += 1;
    } else {
      if (ch === '[' || ch === '{') state.depth += 1;
      if (ch === ']' || ch === '}') state.depth -= 1;
      i += 1;
    }
  }
}

const OUR_TOML_NAMES = [SERVER_NAME, LEGACY_SERVER_NAME];
const isOurs = (keys) => keys.length >= 2 && keys[0] === 'mcp_servers' && OUR_TOML_NAMES.includes(keys[1]);

function removeTomlServers(text) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const state = { multiline: null, depth: 0 };
  const kept = [];
  let table = [];
  let ours = false;
  let tail = [];
  let removedLegacy = false;
  const flushTail = () => {
    const firstComment = tail.findIndex((l) => l.trim().startsWith('#'));
    if (firstComment !== -1) kept.push(...tail.slice(firstComment));
    tail = [];
  };
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, '');
    const trimmed = bare.trim();
    if (!state.multiline && state.depth === 0 && trimmed.startsWith('[')) {
      const header = trimmed.match(/^(\[\[?)\s*(.*?)\s*(\]\]?)\s*(#.*)?$/);
      const keys = header && header[1].length === header[3].length ? parseTomlKeyPath(header[2]) : null;
      if (!keys) return null;
      if (header[1] === '[[' && keys[0] === 'mcp_servers' && (keys.length === 1 || isOurs(keys))) return null;
      if (isOurs(keys)) {
        if (keys[1] === LEGACY_SERVER_NAME) removedLegacy = true;
        ours = true;
        tail = [];
        continue;
      }
      if (ours) flushTail();
      ours = false;
      table = keys;
      kept.push(line);
      continue;
    }
    if (!state.multiline && state.depth === 0 && trimmed && !trimmed.startsWith('#')) {
      const eq = bare.match(/^\s*((?:[A-Za-z0-9_.\s-]|"(?:[^"\\]|\\.)*"|'[^']*')+?)\s*=/);
      const keys = eq && parseTomlKeyPath(eq[1]);
      if (!keys) return null;
      const full = [...table, ...keys];
      if (!ours && full[0] === 'mcp_servers' && (full.length === 1 || OUR_TOML_NAMES.includes(full[1]))) return null;
      scanTomlValue(bare.slice(eq[0].length), state);
    } else if (state.multiline || state.depth > 0) {
      scanTomlValue(bare, state);
    }
    if (!ours) kept.push(line);
    else if (!trimmed || trimmed.startsWith('#')) tail.push(line);
    else tail = [];
  }
  if (state.multiline || state.depth !== 0) return null;
  if (ours) flushTail();
  return { text: kept.join(''), removedLegacy };
}

function installIntoTomlConfig(file, entry) {
  if (!fs.existsSync(path.dirname(file))) return { status: 'not-found' };
  const exists = fs.existsSync(file);
  const raw = exists ? fs.readFileSync(file, 'utf8') : '';
  const removed = removeTomlServers(raw);
  if (!removed) return { status: 'invalid-config' };
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  let base = removed.text;
  if (base && !base.endsWith('\n')) base += eol;
  if (base && !/\r?\n\r?\n$/.test(base)) base += eol;
  const next = base + tomlServerBlock(entry, eol);
  if (next === raw) return { status: 'unchanged' };
  const mode = exists ? fs.statSync(file).mode & 0o777 : 0o600;
  backUpThenWrite(file, next, mode);
  return { status: 'configured', removedLegacy: removed.removedLegacy };
}

function shellQuote(arg, platform) {
  if (platform === 'win32') return /^[A-Za-z0-9_\-./=@\\:]+$/.test(arg) ? arg : `"${arg}"`;
  return /^[A-Za-z0-9_\-./=@%+,]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

function claudeCodeAddArgs(entry) {
  const envFlags = Object.entries(entry.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  // Name before `-e`: it swallows every value up to `--`.
  return ['mcp', 'add', SERVER_NAME, '--scope', 'user', ...envFlags, '--', entry.command, ...entry.args];
}

function installIntoClaudeCode(entry, { spawn }) {
  spawn('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME], { encoding: 'utf8' });
  const added = spawn('claude', claudeCodeAddArgs(entry), { encoding: 'utf8' });
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
    'Every Shakers action is a tool of the `shakers` MCP server. They are deferred: they are not in your tool list, but `exec` has them as `tools.mcp__shakers__<name>` and lists them in `ALL_TOOLS` (filter by `name.startsWith(\'mcp__shakers__\')`). Never say you have no Shakers tools without checking `ALL_TOOLS`. The tool names below are those `<name>`s: to sign the talent up, call `tools.mcp__shakers__signup` with step "start" first, and every later sign-up step through it.',
    '',
    '## Server instructions',
    '',
    buildServerInstructions({ elicitation: true }),
    '',
  ].join('\n');
}

function installCodexSkill({ env, homedir }) {
  const dir = path.join(codexHomeDir({ env, homedir }), 'skills', SERVER_NAME);
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(path.join(dir, 'SKILL.md'), codexSkill(), 0o600);
}

const codexHomeDir = ({ env, homedir }) => env.CODEX_HOME || path.join(homedir, '.codex');

function chatgptAppInstalled({ platform, homedir }) {
  return platform === 'darwin' && fs.existsSync(path.join(homedir, 'Library', 'Application Support', 'com.openai.chat'));
}

function installIntoCodex(entry, { env, homedir }) {
  const dir = codexHomeDir({ env, homedir });
  fs.mkdirSync(dir, { recursive: true });
  const result = installIntoTomlConfig(path.join(dir, 'config.toml'), entry);
  if (result.status === 'configured' || result.status === 'unchanged') installCodexSkill({ env, homedir });
  return result;
}

function vscodeUserDir({ platform, homedir, env }) {
  if (platform === 'darwin') return path.join(homedir, 'Library', 'Application Support', 'Code', 'User');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'Code', 'User');
  return path.join(homedir, '.config', 'Code', 'User');
}

function cliOnPath(spawn, bin) {
  const probe = spawn(bin, ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

function codexDetected({ env, platform, homedir, spawn }) {
  return fs.existsSync(codexHomeDir({ env, homedir })) || cliOnPath(spawn, 'codex') || chatgptAppInstalled({ platform, homedir });
}

function clientTable({ env, platform, homedir, spawn }) {
  const hasCli = (bin) => cliOnPath(spawn, bin);
  const jsonClient = (client, file, key, shape = (entry) => entry) => ({
    client,
    found: () => fs.existsSync(path.dirname(file)),
    install: (entry) => installIntoJsonConfig(file, shape(entry), key),
  });
  return [
    jsonClient('claudeDesktop', claudeDesktopConfigPath({ platform, homedir, env })),
    {
      client: 'claudeCode',
      found: () => hasCli('claude') || fs.existsSync(path.join(homedir, '.claude.json')),
      install: (entry) => (hasCli('claude')
        ? installIntoClaudeCode(entry, { spawn })
        : { status: 'manual', command: ['claude', ...claudeCodeAddArgs(entry)].map((a) => shellQuote(a, platform)).join(' ') }),
    },
    jsonClient('cursor', path.join(homedir, '.cursor', 'mcp.json')),
    jsonClient('geminiCli', path.join(homedir, '.gemini', 'settings.json')),
    {
      client: 'codex',
      found: () => codexDetected({ env, platform, homedir, spawn }),
      install: (entry) => installIntoCodex(entry, { env, homedir }),
    },
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
  packageName = require('../package.json').name,
  spawn = spawnSync,
} = {}) {
  const entry = serverEntry({ nodePath, cliPath, env, platform, homedir, packageName });
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

const NEEDS_RESTART = new Set(['configured', 'manual']);

function parseInstallArgs(args) {
  const flags = new Set(args);
  return {
    yes: flags.has('--yes') || flags.has('-y'),
    json: flags.has('--json'),
    help: flags.has('--help') || flags.has('-h'),
  };
}

async function connectClients({ c, opts, out, ask, deps }) {
  const env = deps.env || process.env;
  const found = detectMcpClients(deps);
  out(`\n  ${c.title}\n\n`);
  if (found.length === 0) {
    out(`  ${c.noneFound}\n\n`);
    return { ok: true, found, results: [], reason: 'no-apps' };
  }
  out(`  ${c.found(found.map((client) => c.clients[client]).join(', '))}\n`);
  let yes = opts.yes || env.SHAKERS_MCP_INSTALL === '1';
  if (!yes) {
    const answer = await ask(`  ${c.confirm} `);
    if (answer === null) {
      out(`\n  ${c.noTerminal}\n  ${c.yesHint}\n\n`);
      return { ok: true, found, results: [], declined: true, reason: 'no-terminal' };
    }
    yes = !/^\s*(n|no)\s*$/i.test(answer);
  }
  if (!yes) {
    out(`\n  ${c.declined}\n\n`);
    return { ok: true, found, results: [], declined: true, reason: 'declined' };
  }

  const { results } = installMcpClients(deps);
  out('\n');
  for (const r of results.filter((x) => x.status !== 'not-found')) {
    out(`  ${c.clients[r.client]}: ${c.status[r.status]}\n`);
    if (r.command) out(`    ${r.command}\n`);
    if (r.removedLegacy) out(`    ${c.removedLegacy}\n`);
  }
  const touched = results.some((r) => ['configured', 'unchanged', 'manual'].includes(r.status));
  const restart = results.filter((r) => NEEDS_RESTART.has(r.status)).map((r) => c.clients[r.client]);
  const closing = !touched ? c.failedAll : restart.length ? c.restart(restart.join(', ')) : c.alreadyConnected;
  out(`\n  ${closing}\n\n`);
  if (results.some((r) => r.status === 'failed' || r.status === 'invalid-config')) process.exitCode = 1;
  return { ok: true, found, results, reason: null };
}

function jsonReport({ found, results, reason }, c) {
  const rows = reason
    ? found.map((client) => ({ client, status: 'skipped' }))
    : results.filter((r) => r.status !== 'not-found');
  const clients = rows.map((r) => ({
    client: r.client,
    name: c.clients[r.client],
    status: r.status,
    restartRequired: NEEDS_RESTART.has(r.status),
    manualCommand: r.command || null,
  }));
  return { reason, clients, restart: clients.filter((r) => r.restartRequired).map((r) => r.name) };
}

// SHAKERS_MCP_INSTALL=1 answers yes; with no terminal, nothing is touched.
async function runMcpInstall({ args = [], out = (s) => process.stdout.write(s), lang = null, ask = askTerminal, ...deps } = {}) {
  const { getCatalog, detectFlowLang } = require('./i18n');
  const c = getCatalog(lang || detectFlowLang()).mcpInstall;
  const opts = parseInstallArgs(args);
  if (opts.help) {
    out(`\n  ${c.help}\n\n`);
    return { ok: true, results: [] };
  }
  const outcome = await connectClients({ c, opts, out: opts.json ? () => {} : out, ask, deps });
  if (opts.json) out(`${JSON.stringify(jsonReport(outcome, c))}\n`);
  return outcome;
}

module.exports = { askTerminal, cliOnPath, codexDetected, codexHomeDir, writeFileAtomic, installCodexSkill, removeTomlServers, tomlServerBlock, detectMcpClients, installMcpClients, stableNodePath, runMcpInstall, serverEntry, claudeDesktopConfigPath, SERVER_NAME, LEGACY_SERVER_NAME };
