'use strict';

const fs = require('fs');
const path = require('path');

const {
  EXCLUDED_DIRS,
  MAX_WALK_DEPTH,
  isRefusedWalkRoot,
  isExcludedWalkPath,
} = require('./scan-exclusions');

// Monorepo support (skill-code-certification, issue 008): manifests are discovered RECURSIVELY under `root`, not just at the top level.

// Exact dependency-name -> canonical framework/library name (npm + pip).
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
  // JS/TS — meta-frameworks
  astro: 'Astro',
  remix: 'Remix',
  '@remix-run/react': 'Remix',
  '@remix-run/node': 'Remix',
  '@remix-run/server-runtime': 'Remix',
  // JS/TS — state management
  zustand: 'Zustand',
  redux: 'Redux',
  'react-redux': 'Redux',
  '@reduxjs/toolkit': 'Redux Toolkit',
  // JS/TS — TanStack family (each product is its own Skill)
  '@tanstack/react-query': 'TanStack Query',
  '@tanstack/vue-query': 'TanStack Query',
  '@tanstack/solid-query': 'TanStack Query',
  '@tanstack/svelte-query': 'TanStack Query',
  'react-query': 'TanStack Query', // pre-rename package, same Skill
  '@tanstack/react-router': 'TanStack Router',
  '@tanstack/router': 'TanStack Router',
  '@tanstack/react-table': 'TanStack Table',
  '@tanstack/vue-table': 'TanStack Table',
  '@tanstack/table-core': 'TanStack Table',
  '@tanstack/react-form': 'TanStack Form',
  '@tanstack/form-core': 'TanStack Form',
  // JS/TS — data / API layer
  prisma: 'Prisma',
  '@prisma/client': 'Prisma',
  graphql: 'GraphQL',
  '@apollo/client': 'Apollo',
  '@apollo/server': 'Apollo',
  'apollo-server': 'Apollo',
  '@trpc/server': 'tRPC',
  '@trpc/client': 'tRPC',
  zod: 'Zod',
  // JS/TS — styling. Code-certified via its CONFIG file surface
  // (tailwind.config.*) — see tech-extensions.js.
  tailwindcss: 'Tailwind CSS',
  // JS/TS — build tools & test runners.
  vite: 'Vite',
  webpack: 'Webpack',
  jest: 'Jest',
  vitest: 'Vitest',
  // Python
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  pyramid: 'Pyramid',
  tornado: 'Tornado',
  sqlalchemy: 'SQLAlchemy',
  pydantic: 'Pydantic',
};

// Go module paths recognized by prefix (module paths carry version suffixes
// like "/v4" and full import sub-paths, so exact match isn't reliable).
const GO_FRAMEWORK_PREFIXES = [
  { prefix: 'github.com/gin-gonic/gin', name: 'Gin' },
  { prefix: 'github.com/labstack/echo', name: 'Echo' },
  { prefix: 'github.com/gofiber/fiber', name: 'Fiber' },
  { prefix: 'github.com/gorilla/mux', name: 'Gorilla Mux' },
  { prefix: 'github.com/beego/beego', name: 'Beego' },
  { prefix: 'gorm.io/gorm', name: 'GORM' },
  { prefix: 'github.com/jinzhu/gorm', name: 'GORM' }, // pre-move import path, same Skill
];

// Maps a raw dependency/module name to its canonical framework/library display name, or null if unrecognized.
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

function fromPackageJsonFile(filePath) {
  const raw = readFileSafe(filePath);
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

function fromRequirementsTxtFile(filePath) {
  const raw = readFileSafe(filePath);
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

function fromGoModFile(filePath) {
  const raw = readFileSafe(filePath);
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

function fromPyprojectTomlFile(filePath) {
  const raw = readFileSafe(filePath);
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

// Manifest filename -> reader (skill-code-certification, issue 008).
const MANIFEST_READERS = {
  'package.json': fromPackageJsonFile,
  'requirements.txt': fromRequirementsTxtFile,
  'go.mod': fromGoModFile,
  'pyproject.toml': fromPyprojectTomlFile,
};

function findManifestFiles(root) {
  const found = [];
  if (isRefusedWalkRoot(root)) return found;

  function walk(dir, depth) {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        if (isExcludedWalkPath(abs)) continue;
        walk(abs, depth + 1);
      } else if (entry.isFile() && Object.prototype.hasOwnProperty.call(MANIFEST_READERS, entry.name)) {
        found.push(abs);
      }
    }
  }

  walk(root, 0);
  return found.sort();
}

// Merges every discovered manifest's output, deduped, sorted, WITHOUT filtering through the canonical framework map.
function detectRawDependencyNames(root) {
  const rawNames = [];
  for (const filePath of findManifestFiles(root)) {
    const reader = MANIFEST_READERS[path.basename(filePath)];
    if (reader) rawNames.push(...reader(filePath));
  }
  return [...new Set(rawNames)].sort();
}

// Maps the merged raw dependency names through canonicalFrameworkName, keeps only recognized names, dedupes, sorts.
function detectTechnologies(root) {
  const rawNames = detectRawDependencyNames(root);
  const canonical = new Set();
  for (const rawName of rawNames) {
    const name = canonicalFrameworkName(rawName);
    if (name) canonical.add(name);
  }
  return [...canonical].sort();
}

function detectTechnologyManifests(root) {
  const byTech = new Map();
  for (const filePath of findManifestFiles(root)) {
    const reader = MANIFEST_READERS[path.basename(filePath)];
    if (!reader) continue;
    const rel = path.relative(root, filePath).split(path.sep).join('/');
    const seenInFile = new Set();
    for (const rawName of reader(filePath)) {
      const tech = canonicalFrameworkName(rawName);
      if (!tech || seenInFile.has(tech)) continue;
      seenInFile.add(tech);
      let set = byTech.get(tech);
      if (!set) {
        set = new Set();
        byTech.set(tech, set);
      }
      set.add(rel);
    }
  }
  return [...byTech.entries()]
    .map(([tech, set]) => ({ tech, manifestPaths: [...set].sort() }))
    .sort((a, b) => a.tech.localeCompare(b.tech));
}

module.exports = {
  detectTechnologies,
  detectTechnologyManifests,
  detectRawDependencyNames,
  canonicalFrameworkName,
  findManifestFiles,
  // Exported as the SOURCE OF TRUTH for the complete set of canonical technologies the detector can ever emit.
  EXACT_FRAMEWORK_MAP,
  GO_FRAMEWORK_PREFIXES,
};
