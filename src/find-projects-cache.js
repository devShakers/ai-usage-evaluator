'use strict';

// Ordinal -> positionId cache for the LAST human `find-projects` listing, so the
// terminal user can reference a project by the `N)` number they saw (the
// positionId is hidden from the human render). Written only on a human list,
// never on --json. Atomic 0600, same dir/style as the session store.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config-dir');

const CACHE_FILE_NAME = 'find-projects-cache.json';
const CACHE_FILE_VERSION = 1;

function cachePath(env = process.env) {
  // Containment guard: the file name is a constant with no separators, so this
  // can never escape — but resolving + checking closes the path-traversal gate
  // cheaply and makes the invariant explicit. Throws on any escape; callers that
  // read swallow it (return null), callers that write propagate (best-effort).
  const base = path.resolve(getConfigDir(env));
  const target = path.resolve(base, CACHE_FILE_NAME);
  const rel = path.relative(base, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('find-projects cache path escapes the config dir');
  }
  return target;
}

// Persists the display-ordered positionIds (index i -> ordinal i+1).
function writePositionCache(ids, env = process.env, { fs: fsImpl = fs } = {}) {
  const clean = (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && id);
  const payload = `${JSON.stringify({ version: CACHE_FILE_VERSION, listedAt: new Date().toISOString(), ids: clean }, null, 2)}\n`;
  const target = cachePath(env);
  const dir = path.dirname(target);
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${CACHE_FILE_NAME}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fsImpl.openSync(tmp, 'wx', 0o600);
    fsImpl.writeFileSync(fd, payload);
    try { fsImpl.fsyncSync(fd); } catch { /* e.g. EINVAL on some filesystems */ }
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, target);
  } catch (e) {
    if (fd !== null) { try { fsImpl.closeSync(fd); } catch { /* already closed */ } }
    try { fsImpl.unlinkSync(tmp); } catch { /* never existed */ }
    throw e;
  }
  return target;
}

// Returns the stored id list, or null when there is no usable cache.
function readPositionCache(env = process.env, { fs: fsImpl = fs } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(cachePath(env), 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== CACHE_FILE_VERSION || !Array.isArray(parsed.ids)) return null;
  const ids = parsed.ids.filter((id) => typeof id === 'string' && id);
  return { ids };
}

// Resolves a raw positional argument to a positionId. A PURE integer is an
// ordinal into the last listing's cache; anything else (UUID / legacy Mongo id)
// is passed through unchanged. Never resolves to the wrong project silently.
function resolvePositionRef(raw, env = process.env, deps = {}) {
  const read = deps.readPositionCache || readPositionCache;
  const arg = typeof raw === 'string' ? raw.trim() : '';
  if (!arg) return { ok: false, reason: 'no-id' };
  if (!/^\d+$/.test(arg)) return { ok: true, id: arg }; // UUID / Mongo id passthrough
  const n = Number.parseInt(arg, 10);
  const cache = read(env);
  if (!cache || cache.ids.length === 0) return { ok: false, reason: 'no-cache' };
  if (n < 1 || n > cache.ids.length) return { ok: false, reason: 'out-of-range', count: cache.ids.length };
  return { ok: true, id: cache.ids[n - 1] };
}

module.exports = {
  CACHE_FILE_NAME,
  CACHE_FILE_VERSION,
  cachePath,
  writePositionCache,
  readPositionCache,
  resolvePositionRef,
};
