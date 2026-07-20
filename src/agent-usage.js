'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

/*
 * Local Claude Code agent-usage signal (ADR-016, agent evaluation feature).
 *
 * PRIVACY — read this before touching anything here. This module reads the
 * LOCAL Claude Code session history ONLY to count how often each agent was
 * invoked on THIS machine. It extracts a SINGLE signal per line — the
 * `subagent_type` of an `Agent` tool call — and NEVER reads, stores, or
 * transmits prompt text, tool inputs, file contents, results, or any other
 * session content. The usage counts stay strictly LOCAL: they are attached to
 * the report for terminal/HTML display and are NOT part of the persistence
 * payload (src/share.js#derivePayload is a strict whitelist), so nothing here
 * egresses.
 *
 * Signal shape (verified against real sessions on disk): each session file is
 * `~/.claude/projects/<enc>/<uuid>.jsonl`; every line is a JSON object. An agent
 * invocation appears as
 *   { message: { content: [ { type:'tool_use', name:'Agent',
 *                             input:{ subagent_type:'<agent-name>' } } ] } }
 * We tally `subagent_type` occurrences. `Task` is also accepted as the tool
 * name for forward/backward compatibility with other Claude SDK builds.
 *
 * Degrades gracefully: a missing/unreadable `~/.claude/projects`, a malformed
 * line, or a huge log never throws — bounded by MAX_FILES and a bounded HEAD
 * read per file so a multi-GB session can't blow up memory.
 */

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

// Parse ONE jsonl line, tallying any Agent/Task tool_use subagent_type into
// `counts`. The cheap `includes` pre-check avoids JSON.parse on the vast
// majority of lines (user/assistant text, snapshots) that carry no signal.
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

// Read a bounded head of a session file and tally invocations. Reading only the
// head keeps memory bounded on huge logs; if the file was truncated at the cap,
// the (possibly partial) last line is dropped so we never attempt to parse half
// a JSON object.
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

// Scan the whole local history. Returns
//   { available, byAgent:{ subagentType: count }, totalInvocations, sessionsScanned }
// `available:false` when there is no history dir / no session files at all
// (graceful degrade — the caller shows no usage signal, never an error).
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

// Annotate the DETECTED local agents with their usage count (exact match of the
// agent `name` against the recorded `subagent_type`). An agent never invoked
// locally gets 0; when history is unavailable each agent gets `null` (unknown,
// distinct from "used zero times"). Built-in/foreign subagent types (e.g.
// `general-purpose`, `Explore`) are intentionally ignored — we only annotate
// the agents this project actually declares.
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
