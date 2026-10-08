'use strict';

// Input normalizers: map a RAW session record into the Claude-shaped internal object model
// that session-scan harvest + transcript-turns already consume
// ({ cwd, timestamp, type, message:{ role, content:[{type:'text'|'tool_use', ...}] } }).
// They ONLY translate input shape — downstream redaction/upload (share.js#derivePayload
// -> POST usage/reports) is unchanged; no field is read that the Claude path didn't expose.
// FAIL-CLOSED: every normalizer returns null / [] when a record does not match the expected
// shape — it never fabricates or guesses fields. A documented format that differs from the
// real one yields "no data for that tool", never wrong data.

function str(v) {
  return typeof v === 'string' && v ? v : null;
}

function textFromParts(parts) {
  if (typeof parts === 'string') return parts.trim() || null;
  if (!Array.isArray(parts)) return null;
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') out.push(p);
    else if (p && typeof p === 'object' && typeof p.text === 'string') out.push(p.text);
  }
  const joined = out.join('').trim();
  return joined || null;
}

// --- Codex (~/.codex/sessions/**/rollout-*.jsonl) ---
// Reads timestamp, cwd (session_meta), user text, and shell commands; a record matching none
// of those passes through only its own real timestamp/cwd, else is dropped.
function codexCommand(args) {
  let a = args;
  if (typeof a === 'string') {
    try { a = JSON.parse(a); } catch { return a.trim() || null; }
  }
  if (!a || typeof a !== 'object') return null;
  const cmd = a.command ?? a.cmd ?? a.commandLine;
  if (Array.isArray(cmd)) return cmd.map(String).join(' ').trim() || null;
  return str(cmd);
}

function normalizeCodexRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : null;
  const item = payload || raw;
  const out = {};
  const ts = str(raw.timestamp) || str(item.timestamp);
  if (ts) out.timestamp = ts;
  const cwd = str(raw.cwd) || str(item.cwd);
  if (cwd) out.cwd = cwd;

  const role = str(item.role);
  if (role === 'user') {
    const text = textFromParts(item.content);
    if (text) {
      out.type = 'user';
      out.message = { role: 'user', content: [{ type: 'text', text }] };
      return out;
    }
  }

  const type = str(raw.type) || str(item.type);
  const name = str(item.name) || (type === 'function_call' ? 'shell' : null);
  if (name && /shell|exec|bash|terminal|command/i.test(name)) {
    const command = codexCommand(item.arguments ?? item.input ?? item.args);
    if (command) {
      out.message = { content: [{ type: 'tool_use', name: 'Shell', input: { command } }] };
      return out;
    }
  }

  return out.timestamp || out.cwd ? out : null;
}

// --- Gemini CLI (~/.gemini/tmp/<project-hash>/chats/logs.json | session-*.jsonl) ---
// logs.json = JSON array of { type:'user'|'model', message, timestamp }; session-*.jsonl =
// per-line { role, parts }. No cwd is recorded (the dir is a one-way SHA-256 hash), so cwd
// stays null — global session/time metrics still count; per-repo scoping can't.
function normalizeGeminiRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  const ts = str(raw.timestamp) || str(raw.time);
  if (ts) out.timestamp = ts;

  const isUser = str(raw.type) === 'user' || str(raw.role) === 'user';
  if (isUser) {
    const text = str(raw.message) || textFromParts(raw.parts) || textFromParts(raw.content);
    if (text) {
      out.type = 'user';
      out.message = { role: 'user', content: [{ type: 'text', text }] };
      return out;
    }
  }
  return out.timestamp ? out : null;
}

// --- Continue (continue.dev) ~/.continue/sessions/*.json ---
// Each file is one session object; expand its history into per-turn objects, carrying
// workspaceDirectory as cwd (good repo attribution).
function normalizeContinueRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cwd = str(raw.workspaceDirectory) || str(raw.workspace) || str(raw.cwd);
  const history = Array.isArray(raw.history) ? raw.history
    : (Array.isArray(raw.messages) ? raw.messages : (Array.isArray(raw.conversation) ? raw.conversation : null));
  // A single message object (not a session) — handle defensively too.
  if (!history) {
    const msg = raw.message && typeof raw.message === 'object' ? raw.message : raw;
    if (str(msg.role) === 'user') {
      const text = typeof msg.content === 'string' ? msg.content.trim() : textFromParts(msg.content);
      if (text) return oneUser(text, cwd, str(raw.timestamp) || str(raw.createdAt));
    }
    return null;
  }
  const out = [];
  for (const entry of history) {
    const msg = entry && entry.message && typeof entry.message === 'object' ? entry.message : entry;
    if (!msg || typeof msg !== 'object') continue;
    const ts = str(entry.timestamp) || str(entry.createdAt) || str(msg.timestamp);
    // Only emit on a real user turn (with text) or a record carrying a real timestamp.
    if (str(msg.role) === 'user') {
      const text = typeof msg.content === 'string' ? msg.content.trim() : textFromParts(msg.content);
      if (text) { out.push(oneUser(text, cwd, ts)); continue; }
    }
    if (ts) out.push(cwd ? { cwd, timestamp: ts } : { timestamp: ts });
  }
  return out.length ? out : null;
}

// --- Cline / Roo Code: VS Code globalStorage .../tasks/<id>/api_conversation_history.json ---
// One JSON array of Anthropic messages (role/content); no cwd and no timestamp in this file
// (ui_messages.json has ts) → cwd/time attribution absent. Emits only real user turns.
function normalizeClineRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (str(raw.role) !== 'user') return null;
  const text = typeof raw.content === 'string' ? raw.content.trim() : textFromParts(raw.content);
  return text ? oneUser(text, null, null) : null;
}

// --- Aider: per-repo .aider.chat.history.md (markdown) ---
// Repo-level source → cwd is the repo toplevel (good attribution). Markdown parse:
// '# aider chat started at <ts>' sets the session time; '#### <text>' lines are user
// instructions. A file matching neither pattern yields 0 records.
function parseAiderHistory(text, cwd) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  let ts = null;
  for (const line of text.split('\n')) {
    const started = /^#\s*aider chat started at\s+(.+?)\s*$/i.exec(line);
    if (started) {
      const t = Date.parse(started[1].replace(' ', 'T'));
      ts = Number.isFinite(t) ? new Date(t).toISOString() : null;
      if (ts) out.push(cwd ? { cwd, timestamp: ts } : { timestamp: ts });
      continue;
    }
    const user = /^####\s+(.*)$/.exec(line);
    if (user && user[1].trim()) out.push(oneUser(user[1].trim(), cwd, ts));
  }
  return out;
}

function oneUser(text, cwd, ts) {
  const o = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } };
  if (cwd) o.cwd = cwd;
  if (ts) o.timestamp = ts;
  return o;
}

module.exports = {
  normalizeCodexRecord,
  normalizeGeminiRecord,
  normalizeContinueRecord,
  normalizeClineRecord,
  parseAiderHistory,
};
