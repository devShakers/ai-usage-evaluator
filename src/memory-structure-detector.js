'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

/*
 * Deterministic (no-LLM) memory STRUCTURE detector (talents-ai-score, issue
 * 016 / ADR-013-014). Extends the existing "does a context file exist"
 * signal (T2's `instructions`/`config` probes, scanner.js) with HOW that
 * memory is structured: how many `@file` imports it references (Claude
 * Code's own documented import syntax), whether those imports are
 * NESTED/layered (an import that itself imports further files), section
 * count, and byte size.
 *
 * Source: KNOWN context files only — CLAUDE.md (project AND home, per
 * ADR-014's "proyecto ∪ home" scope) plus AGENTS.md/GEMINI.md (project).
 * `@file` imports found inside them are followed (bounded depth/file-count,
 * cycle-safe) because they are themselves the SAME kind of AI memory file,
 * not business/application code — same spirit as reading `.claude/agents/`
 * frontmatter (ADR-009).
 *
 * What's extracted (STRUCTURE ONLY): import count, nesting depth, section
 * (markdown header) count, byte size. The file's TEXT is read only to
 * compute these counts via regex — it is NEVER stored or returned anywhere.
 *
 * Heuristic caveat: `@word` import syntax is Claude Code's documented
 * convention; other tools' instruction files (AGENTS.md/GEMINI.md) rarely
 * use it, so they typically report `imports: 0` — that's a correct
 * reflection of their format, not a detection gap.
 */

const MAX_FILE_BYTES = 2_000_000; // safety cap: never read a pathologically huge file
const MAX_IMPORT_DEPTH = 5; // mirrors Claude Code's own documented import-hop limit
const MAX_FILES_VISITED = 100; // safety cap against import fan-out/cycles

// Claude Code's `@path/to/file` import syntax: an `@` at the start of a
// line or preceded by whitespace, followed by a non-space path. Emails
// (`user@example.com`) don't match — the character right before `@` there
// is never whitespace/line-start.
const IMPORT_RE = /(?:^|\s)@(\S+)/gm;
const HEADER_RE = /^#{1,6}\s+\S/gm;

function safeReadText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function countMatches(re, text) {
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

function extractImportPaths(text) {
  const paths = [];
  const re = new RegExp(IMPORT_RE);
  let m;
  while ((m = re.exec(text)) !== null) paths.push(m[1]);
  return paths;
}

function resolveImportPath(importPath, fromDir, home) {
  if (importPath.startsWith('~/')) return path.join(home, importPath.slice(2));
  return path.resolve(fromDir, importPath);
}

// Recursively walks `@imports` starting at `file`. Returns the deepest
// import chain reached (1 = the file itself, no further imports found; 2 =
// it imports one file with no imports of its own; 3+ = nested/layered) and
// the total import reference count across the whole chain. Bounded by
// MAX_IMPORT_DEPTH/MAX_FILES_VISITED and a `visited` set (cycle-safe) —
// defensive, never a product requirement.
function walkImports(file, home, depth, visited, budget) {
  if (depth > MAX_IMPORT_DEPTH || visited.has(file) || budget.files >= MAX_FILES_VISITED) {
    return { maxDepth: depth - 1, importCount: 0 };
  }
  visited.add(file);
  budget.files += 1;

  const text = safeReadText(file);
  if (text === null) return { maxDepth: depth - 1, importCount: 0 };

  const importPaths = extractImportPaths(text);
  if (importPaths.length === 0) return { maxDepth: depth, importCount: 0 };

  let maxDepth = depth;
  let importCount = importPaths.length;
  const fromDir = path.dirname(file);
  for (const p of importPaths) {
    const resolved = resolveImportPath(p, fromDir, home);
    const sub = walkImports(resolved, home, depth + 1, visited, budget);
    maxDepth = Math.max(maxDepth, sub.maxDepth);
    importCount += sub.importCount;
  }
  return { maxDepth, importCount };
}

function analyzeFile(file, home) {
  const text = safeReadText(file);
  if (text === null) return null;
  const sections = countMatches(HEADER_RE, text);
  const sizeBytes = Buffer.byteLength(text, 'utf8');
  const { maxDepth, importCount } = walkImports(file, home, 1, new Set(), { files: 0 });
  return { sizeBytes, sections, imports: importCount, depth: maxDepth };
}

function knownContextFiles(root, home) {
  return [
    { id: 'CLAUDE.md', file: path.join(root, 'CLAUDE.md') },
    { id: 'CLAUDE.md (home)', file: path.join(home, '.claude', 'CLAUDE.md') },
    { id: 'AGENTS.md', file: path.join(root, 'AGENTS.md') },
    { id: 'GEMINI.md', file: path.join(root, 'GEMINI.md') },
  ];
}

// Deterministic (no-LLM) memory structure analysis, scoped to known context
// files (project ∪ home). Never throws — a missing file, an unreadable
// home directory, or a broken/cyclical import chain all degrade gracefully.
function analyzeMemoryStructure(root) {
  const home = getHomeDir();
  const files = [];
  let totalImports = 0;
  let maxDepth = 0;

  for (const { id, file } of knownContextFiles(root, home)) {
    const analysis = analyzeFile(file, home);
    if (!analysis) continue;
    files.push({ id, ...analysis });
    totalImports += analysis.imports;
    maxDepth = Math.max(maxDepth, analysis.depth);
  }

  // "layered" (anidada/por capas) means a REAL import chain — an import
  // that itself imports further files — not just a single flat `@import`.
  // depth=1: no imports. depth=2: one flat import, no nesting of its own.
  // depth>=3: at least one import-of-an-import -> genuinely layered.
  return { files, totalImports, maxDepth, layered: maxDepth > 2 };
}

module.exports = { analyzeMemoryStructure };
