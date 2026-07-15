'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

/*
 * Tool → projects-used mapping (skill-code-certification / ADR-011).
 *
 * For each DETECTED AI tool that keeps a LOCAL, per-project usage history,
 * enumerate the projects where it has been used and attach the list to the
 * report (`report.toolProjectUsage`). Deterministic by construction:
 * filesystem enumeration + a bounded read of session metadata only — no clock,
 * no randomness, no network, no LLM. Same machine state → same list.
 *
 * PRIVACY / SCOPE (ADR-011): what we extract are PROJECT PATHS on the user's
 * OWN machine. Legal approved this extraction (ADR-011); it is the user
 * analysing their own setup. It is STRICTLY LOCAL — it feeds the on-disk report
 * (terminal + the per-project HTML file) and is DELIBERATELY NOT part of the
 * persistence whitelist (`src/share.js#derivePayload`), so no project path ever
 * leaves the machine. We only read the minimum needed (a `cwd` field), never
 * the conversation content of a session.
 *
 * HONESTY: only two tools expose a reverse-mappable local project history
 * without parsing an editor SQLite database (which would need a dependency,
 * breaking the zero-dep invariant):
 *   - Claude Code — `~/.claude/projects/<encoded-cwd>/*.jsonl`; the real path is
 *     recovered from a `cwd` field inside a session file (the directory name is
 *     a lossy slash→dash encoding, used only as a fallback).
 *   - Cursor — `<app-data>/Cursor/User/workspaceStorage/<hash>/workspace.json`
 *     carries the opened folder as a `file://` URI. This is "workspaces opened
 *     in Cursor" (Cursor is an AI-native editor, so ≈ where it was used), NOT a
 *     confirmed per-message AI history — labelled as such.
 * Every other detected tool (Copilot, Windsurf, Gemini CLI, Codex CLI, Aider,
 * Continue, …) is reported `available:false` with a note, rather than
 * over-claiming from an editor-wide workspace store that isn't tool-specific.
 */

const MAX_HEAD_BYTES = 65536; // enough to find an early `cwd` in a session log

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

// Directory entries (names) that are themselves directories, sorted. Never throws.
function readSubdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// Reads at most `maxBytes` from the start of a file. Session logs can be large;
// the `cwd` appears on early lines, so a bounded head read is enough and cheap.
function readHead(file, maxBytes = MAX_HEAD_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

// Recovers the real project path from a Claude Code project directory by reading
// a `cwd` out of the first session file that has one. Returns null if none found.
function claudeCwdFromSessions(projectDir) {
  let files;
  try {
    files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort();
  } catch {
    return null;
  }
  for (const f of files) {
    const head = readHead(path.join(projectDir, f));
    const m = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        return JSON.parse(`"${m[1]}"`); // unescape JSON string content
      } catch {
        return m[1];
      }
    }
  }
  return null;
}

// Exact project path from `sessions-index.json` (newer Claude Code layout: a
// project dir may hold only the index + a `memory/` dir, no `.jsonl`). The
// index carries a `projectPath` per entry — an EXACT path, so preferred over
// the lossy directory-name decode below.
function claudeProjectPathFromIndex(projectDir) {
  const head = readHead(path.join(projectDir, 'sessions-index.json'));
  if (!head) return null;
  const m = head.match(/"projectPath"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

// Best-effort decode of Claude's `-Users-alex-foo` directory name back to a
// path. LOSSY (real dashes in path segments are indistinguishable from the
// separator), so it is only a LAST-RESORT fallback when neither a session
// `cwd` nor the index's `projectPath` is present; the entry is then flagged
// `approximate:true`.
function decodeClaudeDirName(name) {
  const trimmed = name.replace(/^-+/, '');
  return '/' + trimmed.split('-').join('/');
}

function claudeCodeProjects(home) {
  const base = path.join(home, '.claude', 'projects');
  const projects = [];
  for (const dir of readSubdirs(base)) {
    const full = path.join(base, dir);
    // Exact sources first (session `cwd`, then the index's `projectPath`); the
    // lossy dir-name decode is the last resort and is flagged approximate.
    const exact = claudeCwdFromSessions(full) || claudeProjectPathFromIndex(full);
    if (exact) {
      projects.push({ path: exact, approximate: false });
    } else {
      projects.push({ path: decodeClaudeDirName(dir), approximate: true });
    }
  }
  return { available: true, sourceKey: 'claudeSessions', projects: dedupeSort(projects) };
}

function fileUriToPath(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return null;
  let p = uri.slice('file://'.length);
  // file:///Users/... → strip the extra leading empty authority slash on POSIX.
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  return p || null;
}

function cursorWorkspaceStorageDirs(home) {
  // Platform-agnostic: probe every known app-data base under `home` and use
  // whichever exists. This also keeps the extractor testable on any OS via
  // AI_FOOTPRINT_HOME_DIR (the fixture just mirrors one of these layouts).
  return [
    path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage'), // macOS
    path.join(home, '.config', 'Cursor', 'User', 'workspaceStorage'), // Linux
    path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage'), // Windows
  ];
}

function cursorProjects(home) {
  const projects = [];
  for (const base of cursorWorkspaceStorageDirs(home)) {
    for (const hash of readSubdirs(base)) {
      const wf = path.join(base, hash, 'workspace.json');
      if (!exists(wf)) continue;
      const head = readHead(wf);
      let folder = null;
      try {
        folder = JSON.parse(head).folder;
      } catch {
        /* malformed workspace.json → skip */
      }
      const p = fileUriToPath(folder);
      if (p) projects.push({ path: p, approximate: false });
    }
  }
  return { available: true, sourceKey: 'cursorWorkspaces', projects: dedupeSort(projects) };
}

// Deduplicate by path (an exact entry wins over an approximate one) and sort
// lexicographically → deterministic output.
function dedupeSort(projects) {
  const byPath = new Map();
  for (const p of projects) {
    const prev = byPath.get(p.path);
    if (!prev || (prev.approximate && !p.approximate)) byPath.set(p.path, p);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

const EXTRACTORS = {
  'claude-code': claudeCodeProjects,
  cursor: cursorProjects,
};

/*
 * Builds the per-tool project-usage list for the DETECTED tools. `detectedTools`
 * is `report.tools.filter(t => t.detected)` (each `{ id, name, ... }`). Tools
 * without a local history mechanism come back `available:false, projects:[]`.
 * `options.home` overrides the home dir (test seam, via env-paths.getHomeDir).
 */
function collectToolProjectUsage(detectedTools, options = {}) {
  const home = options.home || getHomeDir(options.env || process.env);
  const tools = Array.isArray(detectedTools) ? detectedTools : [];
  return tools.map((tool) => {
    const extract = EXTRACTORS[tool.id];
    if (!extract) {
      return { toolId: tool.id, toolName: tool.name, available: false, sourceKey: null, projects: [] };
    }
    let res;
    try {
      res = extract(home);
    } catch {
      res = { available: false, sourceKey: null, projects: [] };
    }
    return {
      toolId: tool.id,
      toolName: tool.name,
      available: !!res.available,
      sourceKey: res.sourceKey || null,
      projects: Array.isArray(res.projects) ? res.projects : [],
    };
  });
}

// Flat, deduped, sorted list of every discovered project path across all tools
// — the input for the interactive "analyse these projects" offer (bin/report.js).
function flattenProjectPaths(toolProjectUsage) {
  const set = new Set();
  for (const entry of Array.isArray(toolProjectUsage) ? toolProjectUsage : []) {
    for (const p of entry.projects || []) set.add(p.path);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

module.exports = {
  collectToolProjectUsage,
  flattenProjectPaths,
  // exported for focused unit tests
  decodeClaudeDirName,
  fileUriToPath,
};
