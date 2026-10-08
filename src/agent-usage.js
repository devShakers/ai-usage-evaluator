'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

// Local Claude Code agent-usage signal (ADR-016, agent evaluation feature).

const MAX_FILES = 500; // cap total session files scanned (bounded work)
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024; // read at most an 8MB head per file
const AGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

function historyRoot(env = process.env) {
  return path.join(getHomeDir(env), '.claude', 'projects');
}

function listSessionFiles(root) {
  const out = [];
  let dirs;
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return out; // no history dir on this machine — graceful
  }
  for (const d of dirs) {
    const dirPath = path.join(root, d);
    let files;
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith('.jsonl')) {
        out.push(path.join(dirPath, f));
        if (out.length >= MAX_FILES) return out;
      }
    }
  }
  return out;
}

// Parse ONE jsonl line, tallying any Agent/Task tool_use subagent_type into `counts`.
function countInvocation(line, counts) {
  if (!line || !line.includes('subagent_type')) return;
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return; // truncated / malformed line — skip, never throw
  }
  const msg = o && o.message;
  const content = msg && Array.isArray(msg.content) ? msg.content : null;
  if (!content) return;
  for (const c of content) {
    if (c && c.type === 'tool_use' && AGENT_TOOL_NAMES.has(c.name)) {
      const t = c.input && typeof c.input.subagent_type === 'string' ? c.input.subagent_type.trim() : '';
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
  }
}

// Read a bounded head of a session file and tally invocations.
function scanFile(file, counts) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return;
  }
  try {
    const { size } = fs.fstatSync(fd);
    const readLen = Math.min(size, MAX_BYTES_PER_FILE);
    const buf = Buffer.allocUnsafe(readLen);
    fs.readSync(fd, buf, 0, readLen, 0);
    const lines = buf.toString('utf8').split('\n');
    const complete = size > MAX_BYTES_PER_FILE ? lines.slice(0, -1) : lines;
    for (const ln of complete) countInvocation(ln, counts);
  } catch {
    /* unreadable mid-stream — skip this file */
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* already closed */
    }
  }
}

// Scan the whole local history.
function collectClaudeAgentUsage(env = process.env) {
  const files = listSessionFiles(historyRoot(env));
  if (!files.length) {
    return { available: false, byAgent: {}, totalInvocations: 0, sessionsScanned: 0 };
  }
  const counts = {};
  for (const f of files) scanFile(f, counts);
  const totalInvocations = Object.values(counts).reduce((a, b) => a + b, 0);
  return { available: true, byAgent: counts, totalInvocations, sessionsScanned: files.length };
}

// Annotate the DETECTED local agents with their usage count (exact match of the agent `name` against the recorded `subagent_type`).
function collectAgentUsage(agents, env = process.env) {
  const usage = collectClaudeAgentUsage(env);
  const byAgent = {};
  for (const a of agents || []) {
    if (!a || !a.name) continue;
    byAgent[a.name] = usage.available ? usage.byAgent[a.name] || 0 : null;
  }
  return {
    available: usage.available,
    byAgent,
    totalInvocations: usage.totalInvocations,
    sessionsScanned: usage.sessionsScanned,
  };
}

module.exports = { collectClaudeAgentUsage, collectAgentUsage, historyRoot };
