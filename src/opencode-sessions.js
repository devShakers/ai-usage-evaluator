'use strict';

const fs = require('fs');
const path = require('path');
const { getHomeDir } = require('./env-paths');

function loadSqlite() {
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0] && rest[0].type;
    if (type === 'ExperimentalWarning' && /sqlite/i.test(String(warning))) return;
    emitWarning.call(process, warning, ...rest);
  };
  try {
    return require('node:sqlite');
  } catch {
    return null;
  } finally {
    process.emitWarning = emitWarning;
  }
}

function opencodeDbPath(env = process.env) {
  const dataDir = env.XDG_DATA_HOME
    ? path.join(env.XDG_DATA_HOME, 'opencode')
    : path.join(getHomeDir(env), '.local', 'share', 'opencode');
  if (env.OPENCODE_DB) return path.isAbsolute(env.OPENCODE_DB) ? env.OPENCODE_DB : path.join(dataDir, env.OPENCODE_DB);
  return path.join(dataDir, 'opencode.db');
}

const SESSIONS_SQL = 'SELECT id, directory, parent_id AS parentId, agent FROM session ORDER BY time_created DESC LIMIT ?';
const MESSAGES_SQL = `SELECT id, time_created AS createdAt, json_extract(data, '$.role') AS role, json_extract(data, '$.agent') AS agent
  FROM message WHERE session_id = ? ORDER BY time_created, id`;
const PARTS_SQL = `SELECT p.message_id AS messageId, json_extract(p.data, '$.type') AS type, json_extract(p.data, '$.text') AS text,
  json_extract(p.data, '$.tool') AS tool, json_extract(p.data, '$.synthetic') AS synthetic
  FROM part p JOIN message m ON m.id = p.message_id WHERE m.session_id = ? ORDER BY p.id`;

function isoOf(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function sessionObjects(db, session) {
  const parts = new Map();
  for (const p of db.prepare(PARTS_SQL).all(session.id)) {
    if (!parts.has(p.messageId)) parts.set(p.messageId, []);
    parts.get(p.messageId).push(p);
  }
  const head = {};
  if (typeof session.directory === 'string' && session.directory) head.cwd = session.directory;
  if (session.agent === 'plan') head.planMode = true;
  const objects = [head];
  for (const m of db.prepare(MESSAGES_SQL).all(session.id)) {
    const timestamp = isoOf(Number(m.createdAt));
    const own = parts.get(m.id) || [];
    if (m.agent === 'plan') head.planMode = true;
    if (m.role === 'user') {
      const text = own.filter((p) => p.type === 'text' && !p.synthetic && typeof p.text === 'string').map((p) => p.text).join('').trim();
      if (text) {
        objects.push({ type: 'user', timestamp, message: { role: 'user', content: [{ type: 'text', text }] } });
        continue;
      }
    }
    const uses = own.filter((p) => p.type === 'tool' && typeof p.tool === 'string' && p.tool).map((p) => ({ type: 'tool_use', name: p.tool }));
    const o = timestamp ? { timestamp } : {};
    if (uses.length) o.message = { role: 'assistant', content: uses };
    if (o.timestamp || o.message) objects.push(o);
  }
  return objects;
}

function readOpencodeSessions(env, limit) {
  const file = opencodeDbPath(env);
  if (!fs.existsSync(file)) return [];
  const sqlite = loadSqlite();
  const Database = sqlite && (sqlite.DatabaseSync || sqlite.Database);
  if (!Database) return [];
  let db;
  try {
    db = new Database(file, { readOnly: true });
    return db.prepare(SESSIONS_SQL).all(limit).map((session) => ({
      file: `${file}#${session.id}`,
      objects: sessionObjects(db, session),
      subagent: Boolean(session.parentId),
    }));
  } catch {
    return [];
  } finally {
    if (db) db.close();
  }
}

module.exports = { readOpencodeSessions, opencodeDbPath };
