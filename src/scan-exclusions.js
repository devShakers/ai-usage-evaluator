'use strict';

const path = require('path');

// Directory names never descended into when walking a project tree (skill-code-certification, issue 008).
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'vendor', 'coverage', '.next', 'out',
  // Python
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.eggs',
  // Ruby
  '.bundle',
  // Java / JVM (Gradle/Maven build output)
  'target', '.gradle',
]);

const MAX_WALK_DEPTH = 8;

const SYSTEM_ROOT_PATHS = new Set([
  '/System', '/Library', '/Volumes', '/private', '/dev', '/proc',
  '/opt', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var',
  '/cores', '/Network',
]);

function normalizeWalkRoot(root) {
  const resolved = path.resolve(root);
  return resolved.length > 1 ? resolved.replace(/\/+$/, '') : resolved;
}

function isRefusedWalkRoot(root) {
  if (typeof root !== 'string' || !root) return true;
  let norm;
  try {
    norm = normalizeWalkRoot(root);
  } catch {
    return true;
  }
  return norm === '/' || SYSTEM_ROOT_PATHS.has(norm);
}

function isExcludedWalkPath(absDir) {
  return SYSTEM_ROOT_PATHS.has(absDir);
}

module.exports = {
  EXCLUDED_DIRS,
  MAX_WALK_DEPTH,
  SYSTEM_ROOT_PATHS,
  isRefusedWalkRoot,
  isExcludedWalkPath,
};
