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
 * Refined per user clarification: "tecnologías del proyecto" means the
 * FRAMEWORK/LIBRARY the talent actually uses (React, Next.js, Express,
 * Django...), not a raw dump of every dependency declared in a manifest.
 * Manifest parsing stays exactly as before; the raw dependency names are
 * then filtered through a curated, deterministic dependency -> canonical
 * framework/library name map (EXACT_FRAMEWORK_MAP / GO_FRAMEWORK_PREFIXES
 * below). Unrecognized dependencies (linters, test runners, small utility
 * libs) are excluded from the output — never a raw dump, never invented.
 *
 * Honest limitation: ecosystems this detector doesn't parse a manifest for
 * yet (Ruby/Gemfile for Rails, Java/pom.xml for Spring, PHP/composer.json
 * for Laravel) cannot be recognized. Documented, not faked — extending the
 * manifest readers is future work (same ageing-catalog spirit as
 * detectors.js/ADR-001), not something this detector should guess at.
 *
 * Manifests covered (deliberately scoped, "etc." left for a human to extend
 * later):
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

// Exact dependency-name -> canonical framework/library name (npm + pip).
// Lookups are case-insensitive against the lowercased raw dependency name
// (manifest readers below lowercase before matching, except package.json's
// npm names which are already canonically lowercase/scoped on the registry).
const EXACT_FRAMEWORK_MAP = {
  // JS/TS — frontend
  react: 'React',
  'react-dom': 'React',
  next: 'Next.js',
  vue: 'Vue',
  nuxt: 'Nuxt',
  '@angular/core': 'Angular',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  'solid-js': 'SolidJS',
  // JS/TS — backend
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  '@nestjs/core': 'NestJS',
  hapi: 'Hapi',
  '@hapi/hapi': 'Hapi',
  // Python
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  pyramid: 'Pyramid',
  tornado: 'Tornado',
};

// Go module paths recognized by prefix (module paths carry version suffixes
// like "/v4" and full import sub-paths, so exact match isn't reliable).
const GO_FRAMEWORK_PREFIXES = [
  { prefix: 'github.com/gin-gonic/gin', name: 'Gin' },
  { prefix: 'github.com/labstack/echo', name: 'Echo' },
  { prefix: 'github.com/gofiber/fiber', name: 'Fiber' },
  { prefix: 'github.com/gorilla/mux', name: 'Gorilla Mux' },
  { prefix: 'github.com/beego/beego', name: 'Beego' },
];

// Maps a raw dependency/module name to its canonical framework/library
// display name, or null if unrecognized. Never guesses — an unmatched name
// simply isn't a framework/library this detector knows about yet.
function canonicalFrameworkName(rawName) {
  if (typeof rawName !== 'string' || !rawName) return null;
  if (Object.prototype.hasOwnProperty.call(EXACT_FRAMEWORK_MAP, rawName)) {
    return EXACT_FRAMEWORK_MAP[rawName];
  }
  for (const { prefix, name } of GO_FRAMEWORK_PREFIXES) {
    if (rawName === prefix || rawName.startsWith(`${prefix}/`)) {
      return name;
    }
  }
  return null;
}

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
    if (match) names.push(match[1].toLowerCase());
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
    if (kv && kv[1].toLowerCase() !== 'python') names.push(kv[1].toLowerCase());
  }

  const depsArrayMatch = raw.match(/\bdependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depsArrayMatch) {
    const itemRe = /["']([A-Za-z0-9_.-]+)/g;
    let m;
    while ((m = itemRe.exec(depsArrayMatch[1])) !== null) {
      names.push(m[1].toLowerCase());
    }
  }

  return names;
}

// Merges every manifest reader's output, deduped, sorted, WITHOUT filtering
// through the canonical framework map. Internal building block for
// detectTechnologies() below; also exported as detectRawDependencyNames()
// because browser-tools-detector.js (issue 018) needs the raw dependency
// names (e.g. 'playwright', 'puppeteer') to recognize browser-automation
// tooling that isn't a "framework/library" in the tech-stack sense and so
// is deliberately excluded from the canonical, human-facing technologies
// list. Never exposed as `report.technologies` — internal wiring only.
function detectRawDependencyNames(root) {
  const rawNames = [
    ...fromPackageJson(root),
    ...fromRequirementsTxt(root),
    ...fromGoMod(root),
    ...fromPyprojectToml(root),
  ];
  return [...new Set(rawNames)].sort();
}

// Maps the merged raw dependency names through canonicalFrameworkName,
// keeps only recognized names, dedupes, sorts. Never throws — each reader
// degrades to an empty array on a missing/malformed file, and unrecognized
// dependencies are simply dropped (never shown as a raw dependency dump).
function detectTechnologies(root) {
  const rawNames = detectRawDependencyNames(root);
  const canonical = new Set();
  for (const rawName of rawNames) {
    const name = canonicalFrameworkName(rawName);
    if (name) canonical.add(name);
  }
  return [...canonical].sort();
}

module.exports = { detectTechnologies, detectRawDependencyNames, canonicalFrameworkName };
