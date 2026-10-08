'use strict';

const path = require('path');
const fs = require('fs');
const { getHomeDir, readEnv } = require('./env-paths');

// Single source of truth for the CLI's config directory (ADR-045).

const DIR_NAME = 'shakers';
const LEGACY_DIR_NAME = 'ai-footprint';

// Only config.json holds persisted endpoint URLs that must follow the endpoint
// rename; every other file is copied byte-for-byte.
const CONFIG_FILE = 'config.json';

// One-time marker dropped in the NEW dir once migration has run.
const MIGRATION_MARKER = '.migrated-from-ai-footprint';

function overrideDir(env) {
  return readEnv(env, 'CONFIG_DIR') || null;
}

function defaultConfigDir(env) {
  return path.join(getHomeDir(env), '.config', DIR_NAME);
}

function legacyConfigDir(env) {
  return path.join(getHomeDir(env), '.config', LEGACY_DIR_NAME);
}

function getConfigDir(env = process.env) {
  return overrideDir(env) || defaultConfigDir(env);
}

// Rewrites the endpoint rename inside any persisted string value.
function rewriteConfigEndpoints(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  const walk = (v) => {
    if (typeof v === 'string') return v.includes('ai-footprint') ? v.split('ai-footprint').join('usage') : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return `${JSON.stringify(walk(parsed), null, 2)}\n`;
}

// Atomic write preserving `mode`: temp-in-same-dir + fsync + rename.
function writeFilePreservingMode(dest, buf, mode, overwrite) {
  if (!overwrite && fs.existsSync(dest)) return false;
  const dir = path.dirname(dest);
  const tmp = path.join(dir, `.${path.basename(dest)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'wx', mode);
  try {
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest); // atomic replace within the same directory
  return true;
}

// Migrates the legacy config dir to the new one exactly once (guarded by MIGRATION_MARKER).
function migrateLegacyConfigDir(env = process.env) {
  // Explicit override: the caller chose the location, nothing to migrate.
  if (overrideDir(env)) return { migrated: false, reason: 'override' };

  const to = defaultConfigDir(env);
  const from = legacyConfigDir(env);
  const marker = path.join(to, MIGRATION_MARKER);
  try {
    if (fs.existsSync(marker)) return { migrated: false, reason: 'already-migrated', to };
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
      return { migrated: false, reason: 'no-legacy', from, to };
    }
    fs.mkdirSync(to, { recursive: true });
    const brought = [];
    for (const name of fs.readdirSync(from)) {
      if (name === MIGRATION_MARKER) continue;
      const src = path.join(from, name);
      let st;
      try {
        st = fs.statSync(src);
      } catch {
        continue;
      }
      if (!st.isFile()) continue; // the config dir is flat; skip anything odd
      const dest = path.join(to, name);
      const isConfig = name === CONFIG_FILE;
      const buf = isConfig
        ? Buffer.from(rewriteConfigEndpoints(fs.readFileSync(src, 'utf8')), 'utf8')
        : fs.readFileSync(src);
      // config.json overwrites install's default; everything else is copy-if-missing.
      if (writeFilePreservingMode(dest, buf, st.mode & 0o777, isConfig)) brought.push(name);
    }
    // Strictly once: drop the marker so a later boot never re-runs (and never
    // re-overwrites a config the Talent has since edited in the new dir).
    fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
    return { migrated: true, from, to, brought };
  } catch (err) {
    return { migrated: false, reason: 'error', error: err && err.message, from, to };
  }
}

module.exports = {
  getConfigDir,
  legacyConfigDir,
  defaultConfigDir,
  migrateLegacyConfigDir,
  rewriteConfigEndpoints,
};
