'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getConfigDir } = require('./config-dir');
const { getCatalog } = require('./i18n');
const { compareVersions } = require('./update-flow');

// Non-blocking update notifier: the hot path only reads the cache synchronously; a detached unref'd worker does the network check.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function cacheFilePath(env = process.env) {
  return path.join(getConfigDir(env), 'update-check.json');
}

// `{ lastCheck, latest }` or null. Never throws — a missing/corrupt cache is "no data".
function readCache(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFilePath(env), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

// Written by the background worker (and nowhere else on the hot path). Best-effort, atomic + 0600 like every other home-dir write (temp-in-same-dir + fsync + rename).
function writeCache(data, env = process.env) {
  const target = cacheFilePath(env);
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.update-check.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd = null;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({ lastCheck: data.lastCheck, latest: data.latest });
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, payload);
    try { fs.fsyncSync(fd); } catch { /* e.g. EINVAL on some filesystems */ }
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, target);
    return true;
  } catch {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } }
    try { fs.unlinkSync(tmp); } catch { /* never existed */ }
    return false;
  }
}

// `stdoutIsTTY` is injectable for tests; defaults to the real tty bit so piped/redirected/mcp-stdio stdout stays quiet.
function isSuppressed({
  argv = [],
  command = null,
  env = process.env,
  stdoutIsTTY = process.stdout.isTTY,
} = {}) {
  if (env.SHAKERS_CLI_NO_UPDATE_NOTIFIER === '1') return true;
  if (env.CI && env.CI !== 'false' && env.CI !== '0') return true;
  if (!stdoutIsTTY) return true;
  if (Array.isArray(argv) && argv.includes('--json')) return true;
  if (command === 'update') return true;
  return false;
}

// Synchronous: prints to stderr when the cached latest beats the installed version, never polluting stdout. Returns the notice (or null).
function maybeNotify({ currentVersion, lang, env = process.env, out = null } = {}) {
  if (!currentVersion) return null;
  const cache = readCache(env);
  if (!cache || typeof cache.latest !== 'string' || !cache.latest) return null;
  if (compareVersions(currentVersion, cache.latest) >= 0) return null;
  const t = getCatalog(lang).cli.updateNotifier;
  const write = out || ((s) => process.stderr.write(s));
  write(`\n  ${t.available(currentVersion, cache.latest)}\n  ${t.howTo}\n\n`);
  return t.available(currentVersion, cache.latest);
}

// Spawns the detached, unref'd worker to refresh the cache, but only when it is missing or older than CHECK_INTERVAL_MS. Failures swallowed.
function triggerBackgroundCheck({ name, env = process.env } = {}) {
  if (!name) return false;
  const cache = readCache(env);
  const now = Date.now();
  if (
    cache &&
    typeof cache.lastCheck === 'number' &&
    now - cache.lastCheck < CHECK_INTERVAL_MS
  ) {
    return false;
  }
  try {
    const worker = path.join(__dirname, '..', 'bin', 'update-check-worker.js');
    const child = spawn(process.execPath, [worker, name], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  cacheFilePath,
  readCache,
  writeCache,
  isSuppressed,
  maybeNotify,
  triggerBackgroundCheck,
  CHECK_INTERVAL_MS,
};
