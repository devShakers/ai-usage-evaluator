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
  if (type === 'turn_context' && item.collaboration_mode && item.collaboration_mode.mode === 'plan') {
    out.planMode = true;
    return out;
  }
  const name = str(item.name) || (type === 'function_call' ? 'shell' : null);
  if (name === 'update_plan') {
    out.message = { content: [{ type: 'tool_use', name }] };
    return out;
  }
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
function normalizeGeminiRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.messages)) {
    const out = [];
    for (const m of raw.messages) {
      const o = normalizeGeminiRecord(m);
      if (o) out.push(o);
    }
    return out;
  }
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
  const calls = Array.isArray(raw.toolCalls) ? raw.toolCalls.map((c) => toolUse(c && c.name)).filter(Boolean) : [];
  if (calls.length) {
    out.message = { role: 'assistant', content: calls };
    return out;
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
  const out = str(raw.mode) === 'plan' ? [cwd ? { cwd, planMode: true } : { planMode: true }] : [];
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
function normalizeClineRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (str(raw.role) === 'assistant') return clinePlanningTurn(raw.content);
  if (str(raw.role) !== 'user') return null;
  const text = typeof raw.content === 'string' ? raw.content.trim() : textFromParts(raw.content);
  return text ? oneUser(text, null, null) : null;
}

const CLINE_PLANNING_TAG = /<(plan_mode_respond|update_todo_list)>/g;

function clinePlanningTurn(content) {
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : (Array.isArray(content) ? content : []);
  const calls = [];
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'tool_use') calls.push(toolUse(b.name));
    else if (b.type === 'text' && typeof b.text === 'string') {
      for (const m of b.text.matchAll(CLINE_PLANNING_TAG)) calls.push(toolUse(m[1]));
    }
  }
  const uses = calls.filter(Boolean);
  return uses.length ? { message: { role: 'assistant', content: uses } } : null;
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

function normalizeClineSessionRecord(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) return null;
  const out = [];
  for (const m of raw.messages) {
    if (!m || typeof m !== 'object') continue;
    const ts = Number.isFinite(m.ts) ? new Date(m.ts).toISOString() : null;
    if (str(m.role) === 'user') {
      const text = textFromParts((Array.isArray(m.content) ? m.content : []).filter((b) => b && b.type === 'text'));
      if (text) out.push(oneUser(text, null, ts));
      continue;
    }
    if (str(m.role) !== 'assistant') continue;
    const uses = (Array.isArray(m.content) ? m.content : []).filter((b) => b && b.type === 'tool_use').map((b) => toolUse(b.name)).filter(Boolean);
    const o = ts ? { timestamp: ts } : {};
    if (uses.length) o.message = { role: 'assistant', content: uses };
    if (o.timestamp || o.message) out.push(o);
  }
  return out;
}

const CURSOR_QUERY = /^\s*<user_query>([\s\S]*?)<\/user_query>\s*$/;

function normalizeCursorRecord(raw) {
  if (!raw || typeof raw !== 'object' || !raw.message || !Array.isArray(raw.message.content)) return null;
  const role = str(raw.role);
  if (role === 'user') {
    const text = textFromParts(raw.message.content.filter((b) => b && b.type === 'text').map((b) => {
      const m = CURSOR_QUERY.exec(b.text || '');
      return m ? m[1] : b.text;
    }));
    return text ? oneUser(text, null, null) : null;
  }
  if (role !== 'assistant') return null;
  const uses = raw.message.content.filter((b) => b && b.type === 'tool_use' && str(b.name));
  return uses.length ? { message: { role: 'assistant', content: uses } } : null;
}

function normalizePiRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ts = str(raw.timestamp);
  const type = str(raw.type);
  if (type === 'session') {
    const cwd = str(raw.cwd);
    if (!cwd && !ts) return null;
    const o = {};
    if (cwd) o.cwd = cwd;
    if (ts) o.timestamp = ts;
    return o;
  }
  if (type === 'custom' && raw.customType === 'plan-mode' && raw.data && raw.data.enabled === true) {
    return ts ? { timestamp: ts, planMode: true } : { planMode: true };
  }
  if (type !== 'message' || !raw.message || typeof raw.message !== 'object') return null;
  const role = str(raw.message.role);
  if (role === 'user') {
    const text = textFromParts(raw.message.content);
    return text ? oneUser(text, null, ts) : null;
  }
  if (role !== 'assistant') return ts ? { timestamp: ts } : null;
  const uses = (Array.isArray(raw.message.content) ? raw.message.content : [])
    .filter((b) => b && b.type === 'toolCall')
    .map((b) => toolUse(b.name))
    .filter(Boolean);
  const o = ts ? { timestamp: ts } : {};
  if (uses.length) o.message = { role: 'assistant', content: uses };
  return o.timestamp || o.message ? o : null;
}

function toolUse(name) {
  return typeof name === 'string' && name ? { type: 'tool_use', name } : null;
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
  normalizeClineSessionRecord,
  normalizeCursorRecord,
  normalizePiRecord,
  parseAiderHistory,
};
