'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');
const { scrubSecrets } = require('./agent-synthesis');
const {
  normalizeCodexRecord,
  normalizeGeminiRecord,
  normalizeContinueRecord,
  normalizeClineRecord,
  parseAiderHistory,
} = require('./session-normalizers');

// GLOBAL, machine-wide inventory of AI coding-tool SESSIONS (hybrid evaluation, Slice 1).

const MAX_FILES_PER_TOOL = 2000;
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024;
const MAX_COMMAND_SAMPLE = 20;
const MAX_COMMAND_LEN = 200;
const IDLE_GAP_CAP_MS = 25 * 60 * 1000;
// Recency window for sessions90d / activeDaysPerWeek only; all-time metrics untouched.
const TRACTION_WINDOW_DAYS = 90;
const TRACTION_WINDOW_MS = TRACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function activeMsForObjects(objects) {
  const stamps = [];
  for (const o of objects) {
    if (o && typeof o.timestamp === 'string') {
      const t = Date.parse(o.timestamp);
      if (Number.isFinite(t)) stamps.push(t);
    }
  }
  stamps.sort((a, b) => a - b);
  let ms = 0;
  for (let i = 1; i < stamps.length; i++) {
    ms += Math.min(stamps[i] - stamps[i - 1], IDLE_GAP_CAP_MS);
  }
  return ms;
}

// Most-recent parseable timestamp = when the session was last active; null if none.
function latestTimestampOf(objects) {
  let latest = null;
  for (const o of objects) {
    if (o && typeof o.timestamp === 'string') {
      const t = Date.parse(o.timestamp);
      if (Number.isFinite(t) && (latest === null || t > latest)) latest = t;
    }
  }
  return latest;
}

// distinct active days ÷ weeks of the observed active span (clamped ≥1 week), capped at 7.
function activeDaysPerWeekFrom(activeDayStrings) {
  const dayEpochs = [...activeDayStrings].map((d) => Date.parse(`${d}T00:00:00Z`));
  if (dayEpochs.length === 0) return 0;
  const spanDays =
    Math.floor((Math.max(...dayEpochs) - Math.min(...dayEpochs)) / DAY_MS) + 1;
  const weeks = Math.max(1, spanDays / 7);
  return Math.min(7, Math.round((dayEpochs.length / weeks) * 10) / 10);
}

function isTranscriptFile(name) {
  if (name.endsWith('.meta.json')) return false;
  if (name === 'sessions-index.json') return false;
  return name.endsWith('.jsonl') || name.endsWith('.json');
}

function isSubagentFile(filePath) {
  return filePath.split(path.sep).includes('subagents');
}
const FILE_TOOL_NAMES = new Set([
  'Read',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
]);
const PLANNING_TOOL_NAMES = new Set(['ExitPlanMode', 'TodoWrite']);

// Only logs.json + session-*.jsonl under ~/.gemini/tmp are transcripts (skip checkpoints/config).
function isGeminiTranscriptFile(name) {
  return name === 'logs.json' || (name.startsWith('session-') && name.endsWith('.jsonl'));
}

// Cline / Roo Code conversation file (both forks use this filename under tasks/<id>/).
function isClineHistoryFile(name) {
  return name === 'api_conversation_history.json';
}

// VS Code globalStorage root per OS (Cline/Roo live under <ext-id>/tasks/<id>/ here).
function vscodeGlobalStorageDir(home) {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage');
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage');
  return path.join(home, '.config', 'Code', 'User', 'globalStorage');
}

function toolSources(env = process.env) {
  const home = getHomeDir(env);
  return [
    { tool: 'claude', dir: path.join(home, '.claude', 'projects') },
    { tool: 'codex', dir: path.join(home, '.codex', 'sessions'), normalize: normalizeCodexRecord },
    { tool: 'gemini', dir: path.join(home, '.gemini', 'tmp'), fileFilter: isGeminiTranscriptFile, normalize: normalizeGeminiRecord },
    // Kept by decision: ~/.cursor/chats is OBSOLETE (real Cursor chat is SQLite in App Support); awaiting a future SQLite extractor, no tool removed.
    { tool: 'cursor', dir: path.join(home, '.cursor', 'chats') },
    { tool: 'continue', dir: path.join(home, '.continue', 'sessions'), normalize: normalizeContinueRecord },
    { tool: 'cline', dir: vscodeGlobalStorageDir(home), fileFilter: isClineHistoryFile, normalize: normalizeClineRecord },
    // Repo-level: .aider.chat.history.md lives INSIDE each git repo, so cwd = the repo toplevel.
    { tool: 'aider', repoLevel: true, file: '.aider.chat.history.md', parseText: parseAiderHistory },
  ];
}

function listSessionFiles(root, fileFilter = isTranscriptFile) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && fileFilter(entry.name)) {
        out.push(full);
        if (out.length >= MAX_FILES_PER_TOOL) return out;
      }
    }
  }
  return out;
}

// Whole-file JSON reader (bounded) for `.json` transcripts (e.g. Gemini logs.json = array).
function readJsonArrayFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    const { size } = fs.fstatSync(fd);
    const readLen = Math.min(size, MAX_BYTES_PER_FILE);
    const buf = Buffer.allocUnsafe(readLen);
    fs.readSync(fd, buf, 0, readLen, 0);
    const parsed = JSON.parse(buf.toString('utf8'));
    if (Array.isArray(parsed)) return parsed;
    return parsed && typeof parsed === 'object' ? [parsed] : [];
  } catch {
    return [];
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

// Parse a file to raw records by extension (.jsonl = per line, .json = whole array).
function parseRawRecords(file) {
  return file.endsWith('.jsonl') ? readSessionObjects(file) : readJsonArrayFile(file);
}

// Read a source's file and normalize its records into the Claude-shaped internal model.
// A normalizer may return an object, an array (expanded), or null/[] (fail-closed skip).
function readSourceObjects(source, file) {
  const raw = parseRawRecords(file);
  if (typeof source.normalize !== 'function') return raw;
  const out = [];
  for (const r of raw) {
    const o = source.normalize(r);
    if (Array.isArray(o)) out.push(...o);
    else if (o) out.push(o);
  }
  return out;
}

// Bounded whole-file text read (for repo-level markdown sources, e.g. Aider).
function readTextFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = fs.fstatSync(fd);
    const readLen = Math.min(size, MAX_BYTES_PER_FILE);
    const buf = Buffer.allocUnsafe(readLen);
    fs.readSync(fd, buf, 0, readLen, 0);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

// Repo-level source: read <toplevel>/<source.file> and parse it with cwd = the toplevel.
function readRepoLevelObjects(source, toplevel) {
  const text = readTextFile(path.join(toplevel, source.file));
  if (text === null) return [];
  const objects = source.parseText(text, toplevel);
  return Array.isArray(objects) ? objects : [];
}

function pushCommand(acc, command) {
  if (typeof command !== 'string') return;
  acc.bashCommandsCount += 1;
  if (acc.commandSample.length >= MAX_COMMAND_SAMPLE) return;
  const scrubbed = scrubSecrets(command).trim().slice(0, MAX_COMMAND_LEN);
  if (scrubbed && !acc.commandSample.includes(scrubbed)) {
    acc.commandSample.push(scrubbed);
  }
}

function harvestToolUse(node, acc) {
  if (!node || typeof node !== 'object') return;
  const name = node.name;
  const input = node.input && typeof node.input === 'object' ? node.input : null;
  if (name === 'Bash' && input) {
    pushCommand(acc, input.command);
  } else if (name === 'Shell' && input) {
    pushCommand(acc, input.command);
  } else if (FILE_TOOL_NAMES.has(name) && input) {
    const p = input.file_path || input.notebook_path;
    if (typeof p === 'string' && p) acc.filesTouched.add(p);
  } else if (PLANNING_TOOL_NAMES.has(name)) {
    acc.planningSignalCount = (acc.planningSignalCount || 0) + 1;
  }
}

function harvestObject(o, acc) {
  const msg = o && o.message ? o.message : o;
  const content = msg && Array.isArray(msg.content) ? msg.content : null;
  if (content) {
    for (const c of content) {
      if (c && c.type === 'tool_use') harvestToolUse(c, acc);
    }
  }
  if (o && typeof o.cwd === 'string' && o.cwd) acc.projectKeys.add(o.cwd);
}

function readSessionObjects(file) {
  const out = [];
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return out;
  }
  try {
    const { size } = fs.fstatSync(fd);
    const readLen = Math.min(size, MAX_BYTES_PER_FILE);
    const buf = Buffer.allocUnsafe(readLen);
    fs.readSync(fd, buf, 0, readLen, 0);
    const lines = buf.toString('utf8').split('\n');
    const complete = size > MAX_BYTES_PER_FILE ? lines.slice(0, -1) : lines;
    for (const ln of complete) {
      if (!ln) continue;
      let o;
      try {
        o = JSON.parse(ln);
      } catch {
        continue;
      }
      out.push(o);
    }
  } catch {
    /* unreadable mid-stream — return what parsed */
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
  }
  return out;
}

function scanFile(file, acc) {
  for (const o of readSessionObjects(file)) harvestObject(o, acc);
}

function resolveFileCwd(objects) {
  for (const o of objects) {
    if (o && typeof o.cwd === 'string' && o.cwd) return o.cwd;
  }
  return null;
}

function fileInScope(cwd, selectedCwds) {
  if (selectedCwds === null) return true;
  return cwd !== null && selectedCwds.has(cwd);
}

// Yields every parsed session object across every known AI-tool session directory on this machine, tagged with the tool it came from.
function* iterateSessionObjects(env = process.env) {
  const sources = toolSources(env);
  // Phase 1: home-dir sources; collect the repo toplevels (cwds) they reveal.
  const seenCwds = new Set();
  for (const source of sources) {
    if (source.repoLevel) continue;
    const files = listSessionFiles(source.dir, source.fileFilter || isTranscriptFile);
    for (const file of files) {
      const objects = readSourceObjects(source, file);
      const cwd = resolveFileCwd(objects);
      if (cwd) seenCwds.add(cwd);
      for (const obj of objects) {
        yield { tool: source.tool, obj, cwd, filePath: file };
      }
    }
  }
  // Phase 2: repo-level sources (e.g. Aider) over the repos just discovered — cwd is known.
  for (const source of sources) {
    if (!source.repoLevel) continue;
    for (const top of seenCwds) {
      const objects = readRepoLevelObjects(source, top);
      for (const obj of objects) {
        yield { tool: source.tool, obj, cwd: top, filePath: path.join(top, source.file) };
      }
    }
  }
}

// Scan every known AI-tool session directory on this machine.
function makeSessionsAccumulator() {
  const toolsSeen = [];
  let sessionCount = 0;
  let subagentRunCount = 0;
  let activeMs = 0;
  const filesTouched = new Set();
  let bashCommandsCount = 0;
  let planningSignalCount = 0;
  const commandSample = [];
  const projectKeysByTool = new Map();
  // Recency-windowed session signals, from the same objects already read.
  const windowCutoff = Date.now() - TRACTION_WINDOW_MS;
  let sessions90d = 0;
  const activeDaysInWindow = new Set();
  let cur = null;

  return {
    startTool(tool) {
      const projectKeys = new Set();
      cur = {
        tool,
        projectKeys,
        rootSessions: 0,
        subagentRuns: 0,
        acc: {
          filesTouched,
          commandSample,
          projectKeys,
          bashCommandsCount: 0,
          planningSignalCount: 0,
        },
      };
    },
    addFile(file, objects) {
      for (const o of objects) harvestObject(o, cur.acc);
      if (isSubagentFile(file)) {
        cur.subagentRuns += 1;
      } else {
        cur.rootSessions += 1;
        activeMs += activeMsForObjects(objects);
        // Root session in the 90d window → count it + record its (UTC) active day.
        const lastTs = latestTimestampOf(objects);
        if (lastTs !== null && lastTs >= windowCutoff) {
          sessions90d += 1;
          activeDaysInWindow.add(new Date(lastTs).toISOString().slice(0, 10));
        }
      }
    },
    endTool() {
      if (cur.rootSessions === 0 && cur.subagentRuns === 0) {
        cur = null;
        return;
      }
      toolsSeen.push(cur.tool);
      sessionCount += cur.rootSessions;
      subagentRunCount += cur.subagentRuns;
      bashCommandsCount += cur.acc.bashCommandsCount;
      planningSignalCount += cur.acc.planningSignalCount;
      projectKeysByTool.set(cur.tool, cur.projectKeys);
      cur = null;
    },
    result() {
      if (toolsSeen.length === 0) return null;
      const keyToolCount = new Map();
      for (const keys of projectKeysByTool.values()) {
        for (const key of keys) {
          keyToolCount.set(key, (keyToolCount.get(key) || 0) + 1);
        }
      }
      let crossToolLinks = 0;
      for (const count of keyToolCount.values()) {
        if (count > 1) crossToolLinks += 1;
      }
      return {
        toolsSeen,
        sessionCount,
        subagentRunCount,
        activeHours: Math.round((activeMs / 3600000) * 10) / 10,
        crossToolLinks,
        filesTouchedCount: filesTouched.size,
        bashCommandsCount,
        planningSignalCount,
        sessions90d,
        activeDaysPerWeek: activeDaysPerWeekFrom(activeDaysInWindow),
        redactedCommandSample: commandSample,
      };
    },
  };
}

function walkSessionSignals(env = process.env, selectedCwds = null, onHumanObject = null) {
  const sessions = makeSessionsAccumulator();
  const sources = toolSources(env);
  const seenCwds = new Set();
  // Phase 1: home-dir sources; remember the repo toplevels (cwds) they reveal.
  for (const source of sources) {
    if (source.repoLevel) continue;
    const files = listSessionFiles(source.dir, source.fileFilter || isTranscriptFile);
    if (files.length === 0) continue;
    sessions.startTool(source.tool);
    for (const f of files) {
      const objects = readSourceObjects(source, f);
      const cwd = resolveFileCwd(objects);
      if (cwd) seenCwds.add(cwd);
      if (!fileInScope(cwd, selectedCwds)) continue;
      sessions.addFile(f, objects);
      if (onHumanObject) {
        for (const o of objects) onHumanObject(o);
      }
    }
    sessions.endTool();
  }
  // Phase 2: repo-level sources (e.g. Aider) — candidate repos = the selected scope, else
  // the repos seen in phase 1. cwd is the repo toplevel, so attribution is exact.
  const toplevels = selectedCwds instanceof Set ? selectedCwds : seenCwds;
  for (const source of sources) {
    if (!source.repoLevel) continue;
    sessions.startTool(source.tool);
    for (const top of toplevels) {
      if (!fileInScope(top, selectedCwds)) continue;
      const objects = readRepoLevelObjects(source, top);
      if (objects.length === 0) continue;
      sessions.addFile(path.join(top, source.file), objects);
      if (onHumanObject) {
        for (const o of objects) onHumanObject(o);
      }
    }
    sessions.endTool();
  }
  return sessions.result();
}

function collectSessions(env = process.env, selectedCwds = null) {
  return walkSessionSignals(env, selectedCwds, null);
}

module.exports = {
  collectSessions,
  makeSessionsAccumulator,
  walkSessionSignals,
  toolSources,
  listSessionFiles,
  readSessionObjects,
  resolveFileCwd,
  iterateSessionObjects,
};
