'use strict';

const fs = require('fs');
const path = require('path');

/*
 * Deterministic (no-LLM) extraction of the project's TECHNOLOGIES
 * (talents-ai-score, ADR-012): parses known dependency MANIFEST files only
 * — never application/business source code. Only package/module NAMES are
 * extracted (no versions, no lockfile exact-pin data): enough for Shakers to
 * associate them with its Skill catalog at persistence time (server-side,
 * V1 = only saves the association, per ADR-012 — never touches the
 * Talent's skills profile or matching/ranking).
 *
 * Manifests covered (deliberately scoped, "etc." left for a human to extend
 * later — same ageing-catalog spirit as detectors.js/ADR-001):
 *   - package.json          (dependencies/devDependencies/peerDependencies/
 *                             optionalDependencies keys)
 *   - requirements.txt      (one package per line, version specifiers and
 *                             comments stripped)
 *   - go.mod                (require block + single-line require statements)
 *   - pyproject.toml        (best-effort: Poetry's [tool.poetry.*dependencies]
 *                             tables, and PEP 621's [project] dependencies
 *                             array) — a minimal, regex-based reader, not a
 *                             full TOML parser (no dependency, zero-dep repo
 *                             invariant); good enough for the common shapes.
 */

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function fromPackageJson(root) {
  const raw = readFileSafe(path.join(root, 'package.json'));
  if (!raw) return [];
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return [];
  }
  const groups = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const names = [];
  for (const group of groups) {
    if (pkg[group] && typeof pkg[group] === 'object') {
      names.push(...Object.keys(pkg[group]));
    }
  }
  return names;
}

function fromRequirementsTxt(root) {
  const raw = readFileSafe(path.join(root, 'requirements.txt'));
  if (!raw) return [];
  const names = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)/);
    if (match) names.push(match[1]);
  }
  return names;
}

function fromGoMod(root) {
  const raw = readFileSafe(path.join(root, 'go.mod'));
  if (!raw) return [];
  const names = [];
  const blockMatch = raw.match(/require\s*\(([\s\S]*?)\)/);
  if (blockMatch) {
    for (const rawLine of blockMatch[1].split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//')) continue;
      const match = line.match(/^(\S+)/);
      if (match) names.push(match[1]);
    }
  }
  const singleLineRe = /^require\s+(\S+)\s+\S+/gm;
  let m;
  while ((m = singleLineRe.exec(raw)) !== null) {
    if (m[1] === '(') continue; // the block-opening "require (" line, not a single-line require
    names.push(m[1]);
  }
  return names;
}

// Best-effort, regex-based (no TOML dependency): covers Poetry's
// `[tool.poetry.dependencies]` / `[tool.poetry.dev-dependencies]` /
// `[tool.poetry.group.*.dependencies]` tables (key = value lines, `python`
// excluded as it's the interpreter constraint, not a dependency) and PEP
// 621's `[project] dependencies = [...]` array (extracts the name before
// any version specifier). Degrades to "nothing found" on anything it
// doesn't recognize rather than guessing.
function fromPyprojectToml(root) {
  const raw = readFileSafe(path.join(root, 'pyproject.toml'));
  if (!raw) return [];
  const names = [];

  const sectionRe = /^\[tool\.poetry\.(?:dependencies|dev-dependencies|group\.[^\]]+\.dependencies)\]\s*$/gm;
  const lines = raw.split(/\r?\n/);
  let inDepsSection = false;
  for (const line of lines) {
    if (/^\[.*\]\s*$/.test(line)) {
      inDepsSection = sectionRe.test(line);
      sectionRe.lastIndex = 0;
      continue;
    }
    if (!inDepsSection) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=/);
    if (kv && kv[1].toLowerCase() !== 'python') names.push(kv[1]);
  }

  const depsArrayMatch = raw.match(/\bdependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depsArrayMatch) {
    const itemRe = /["']([A-Za-z0-9_.-]+)/g;
    let m;
    while ((m = itemRe.exec(depsArrayMatch[1])) !== null) {
      names.push(m[1]);
    }
  }

  return names;
}

// Merges every manifest reader's output, dedupes, sorts. Never throws —
// each reader degrades to an empty array on a missing/malformed file.
function detectTechnologies(root) {
  const all = [
    ...fromPackageJson(root),
    ...fromRequirementsTxt(root),
    ...fromGoMod(root),
    ...fromPyprojectToml(root),
  ];
  return [...new Set(all)].sort();
}

module.exports = { detectTechnologies };
