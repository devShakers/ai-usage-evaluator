'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// `update` is explicit and user-invoked (never a hot path), so these timeouts can be generous.
const VIEW_TIMEOUT_MS = 20000;
const INSTALL_TIMEOUT_MS = 180000;

// Documented installer one-liner (README `curl | bash`, `release` branch); overridable for a non-default deployment.
const DEFAULT_INSTALL_URL =
  'https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/release/install.sh';

// Name/version/registry come from THIS package.json, so a renamed flavor adapts with no code change here.
function readPackageInfo() {
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    const registry =
      pkg.publishConfig && typeof pkg.publishConfig.registry === 'string'
        ? pkg.publishConfig.registry
        : null;
    return {
      name: typeof pkg.name === 'string' ? pkg.name : null,
      version: typeof pkg.version === 'string' ? pkg.version : null,
      registry,
    };
  } catch {
    return { name: null, version: null, registry: null };
  }
}

function realPathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// Root of the installed package = the parent of this src/ directory.
function packageRoot() {
  return realPathOrSelf(path.resolve(__dirname, '..'));
}

function npmGlobalRoot() {
  try {
    const out = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      timeout: VIEW_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out ? realPathOrSelf(out.trim()) : null;
  } catch {
    return null;
  }
}

// Detects how this CLI was installed (prefix | npm-global | npm-local | source | unknown) so the update lands where the CLI lives.
function detectInstall(env = process.env) {
  const root = packageRoot();
  const nodeModulesSeg = `${path.sep}node_modules${path.sep}`;

  if (!root.includes(nodeModulesSeg)) {
    const home = realPathOrSelf(
      env.SHAKERS_CLI_HOME ||
        env.AI_FOOTPRINT_HOME ||
        path.join(os.homedir(), '.shakers'),
    );
    if (root === home) return { kind: 'prefix', root };
    if (fs.existsSync(path.join(root, '.git'))) return { kind: 'source', root };
    return { kind: 'unknown', root };
  }

  const info = readPackageInfo();
  const gRoot = npmGlobalRoot();
  const globalPkgPath =
    gRoot && info.name
      ? realPathOrSelf(path.join(gRoot, ...info.name.split('/')))
      : null;
  if (globalPkgPath && root === globalPkgPath) {
    return { kind: 'npm-global', root, global: true, projectDir: null };
  }
  // `.../project/node_modules/<@scope/name>` → the project dir owning the local node_modules is `up` segments up.
  const up = info.name && info.name.includes('/') ? 3 : 2;
  const projectDir = path.resolve(root, ...Array(up).fill('..'));
  return { kind: 'npm-local', root, global: false, projectDir };
}

function classifyError(error) {
  const code = error && error.code;
  const stderr =
    (error && error.stderr && error.stderr.toString()) ||
    (error && error.message) ||
    '';
  if (code === 'ENOENT') return 'npm-not-found';
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timed out/i.test(stderr))
    return 'timeout';
  if (/EACCES|permission denied|EPERM/i.test(stderr)) return 'permission';
  if (/ENOTFOUND|ECONNREFUSED|network|ECONNRESET|getaddrinfo/i.test(stderr))
    return 'network';
  if (/\b401\b|\b403\b|unauthorized|forbidden|authentication/i.test(stderr))
    return 'auth';
  if (/E404|not found/i.test(stderr)) return 'not-found';
  return 'unknown';
}

// `npm view <name>@latest version` prints only the version string (last line).
function fetchLatestVersion({ name, registry } = {}) {
  if (!name) return { ok: false, reason: 'no-package-name' };
  const args = ['view', `${name}@latest`, 'version'];
  if (registry) args.push('--registry', registry);
  try {
    const out = execFileSync('npm', args, {
      encoding: 'utf8',
      timeout: VIEW_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const version = (out || '')
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();
    return version ? { ok: true, version } : { ok: false, reason: 'empty-response' };
  } catch (error) {
    return { ok: false, reason: classifyError(error) };
  }
}

function parseSemver(v) {
  const core = String(v).trim().replace(/^v/, '').split('-')[0].split('+')[0];
  return core.split('.').map((n) => parseInt(n, 10) || 0);
}

// -1/0/1 on the semver core; prerelease suffixes ignored (fine for an "is a newer release available" check).
function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function manualCommand({ name, registry } = {}) {
  if (!name) return 'npm install -g <package>@latest';
  const reg = registry ? ` --registry ${registry}` : '';
  return `npm install -g ${name}@latest${reg}`;
}

// Resolves the exact command this install model needs to pull `@latest`.
function buildUpdatePlan(install, info, env = process.env) {
  const { name, registry } = info;
  if (!name) return null;
  if (install.kind === 'npm-global') {
    const args = ['install', '-g', `${name}@latest`];
    if (registry) args.push('--registry', registry);
    return { type: 'npm', cmd: 'npm', args, cwd: undefined, label: 'npm (global)' };
  }
  if (install.kind === 'npm-local') {
    const args = ['install', `${name}@latest`];
    if (registry) args.push('--registry', registry);
    return {
      type: 'npm',
      cmd: 'npm',
      args,
      cwd: install.projectDir || undefined,
      label: 'npm (local project)',
    };
  }
  if (install.kind === 'prefix') {
    const url = env.SHAKERS_CLI_INSTALL_URL || DEFAULT_INSTALL_URL;
    return {
      type: 'installer',
      url,
      label: 'installer (~/.shakers)',
      command: `curl -fsSL "${url}" | bash`,
    };
  }
  return null;
}

// Inherited stdio so the user sees npm's progress; the installer path keeps SHAKERS_CLI_HOME/BIN so a re-run lands in the same prefix.
function runInstall(plan, env = process.env) {
  if (!plan) return { ok: false, reason: 'no-plan' };
  try {
    if (plan.type === 'npm') {
      execFileSync(plan.cmd, plan.args, {
        stdio: 'inherit',
        timeout: INSTALL_TIMEOUT_MS,
        cwd: plan.cwd,
        env,
      });
      return { ok: true };
    }
    if (plan.type === 'installer') {
      execFileSync('bash', ['-c', plan.command], {
        stdio: 'inherit',
        timeout: INSTALL_TIMEOUT_MS,
        env,
      });
      return { ok: true };
    }
    return { ok: false, reason: 'no-plan' };
  } catch (error) {
    return { ok: false, reason: classifyError(error) };
  }
}

module.exports = {
  readPackageInfo,
  detectInstall,
  fetchLatestVersion,
  compareVersions,
  buildUpdatePlan,
  runInstall,
  manualCommand,
  DEFAULT_INSTALL_URL,
};
