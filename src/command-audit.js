'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { scrubSecrets } = require('./agent-synthesis');
const { loadAuthSession, decodeJwtPayload } = require('./auth-session-store');
const { getCertsBase } = require('./config');
const { postJsonWithTimeout } = require('./backend-request');

// Fire-and-forget: short timeout, every error swallowed, so a logging failure never blocks or fails a command.
const AUDIT_TIMEOUT_MS = 1500;

// Capped at 200 chars AFTER scrubbing (mirrors MAX_COMMAND_LEN in session-scan.js) so a secret straddling the cut cannot leak.
const MAX_ARGS_LEN = 200;

const WORKER = path.join(__dirname, '..', 'bin', 'command-audit-worker.js');
const PAYLOAD_VAR = 'SHAKERS_CLI_AUDIT_PAYLOAD';

function auditDisabled(env) {
  return !!env && env.SHAKERS_CLI_NO_AUDIT === '1';
}

function cliVersion() {
  try {
    return require(path.join(__dirname, '..', 'package.json')).version || null;
  } catch {
    return null;
  }
}

// Scrub THEN cap: scrubSecrets can GROW text, so the cap is measured on the scrubbed string that goes on the wire.
function redactArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const scrubbed = scrubSecrets(argv.join(' ')).trim().slice(0, MAX_ARGS_LEN);
  return scrubbed || null;
}

// `apply` takes only the position ref: anything typed after it could be the talent's message, so it never reaches the log.
function withoutFreeText(argv) {
  if (!Array.isArray(argv)) return argv;
  const words = argv.filter((a) => typeof a === 'string' && !a.startsWith('-')).map((w) => w.toLowerCase());
  const at = words[0] === 'apply' ? 0 : words[0] === 'projects' && words[1] === 'apply' ? 1 : -1;
  if (at === -1) return argv;
  const kept = argv.filter((a) => typeof a === 'string' && !a.startsWith('-'));
  return kept.slice(0, at + 2);
}

// Anonymous runs carry only a best-effort machine hint; authenticated runs identify via the Bearer instead.
function machineHint() {
  let osUser = null;
  try {
    const info = os.userInfo();
    osUser = info && typeof info.username === 'string' ? info.username : null;
  } catch {
    osUser = null;
  }
  let hostname = null;
  try {
    hostname = os.hostname() || null;
  } catch {
    hostname = null;
  }
  return { osUser, hostname };
}

function jwtExpired(token, now) {
  const payload = decodeJwtPayload(token);
  return !!payload && typeof payload.exp === 'number' && payload.exp * 1000 <= now;
}

// Builds the record + headers; returns null when there is no endpoint to post to.
function buildAudit(command, argv, env, id = null) {
  let base;
  try {
    base = getCertsBase(env);
  } catch {
    base = null;
  }
  if (!base) return null;

  const session = loadAuthSession(env);
  const stored = (session && (session.accessToken || session.hubAccessToken)) || null;
  const token = stored && !jwtExpired(stored, Date.now()) ? stored : null;

  const body = {
    ...(id ? { id } : {}),
    command: String(command || 'unknown').slice(0, 100),
    args: redactArgs(withoutFreeText(argv)),
    cliVersion: cliVersion(),
    clientTimestamp: new Date().toISOString(),
  };

  // Machine hint only when anonymous; identity comes from the token otherwise.
  if (!token) {
    const { osUser, hostname } = machineHint();
    body.osUser = osUser;
    body.hostname = hostname;
  }

  const headers = token ? { Authorization: `Bearer ${token}` } : null;
  const endpoint = `${base.replace(/\/+$/, '')}/cli/command-log`;
  return { endpoint, body, headers };
}

// Emits ONE fire-and-forget audit record; never throws or rejects. Returns the `.catch`-guarded promise so tests can await it (production does not).
function emitCommandAudit({ command, argv = [], env = process.env, id = null } = {}) {
  try {
    if (auditDisabled(env)) return Promise.resolve();
    const audit = buildAudit(command, argv, env, id);
    if (!audit) return Promise.resolve();
    return postJsonWithTimeout(
      audit.endpoint,
      audit.body,
      AUDIT_TIMEOUT_MS,
      'POST',
      null,
      audit.headers,
    ).then(
      () => {},
      () => {},
    );
  } catch {
    return Promise.resolve();
  }
}

async function logCommandRun({ command, argv = [], env = process.env } = {}) {
  if (auditDisabled(env)) return null;
  const id = crypto.randomUUID();
  await emitCommandAudit({ command, argv, env, id });
  return id;
}

let runId = null;

function startCommandAudit({ command, argv = [], env = process.env } = {}) {
  if (auditDisabled(env)) return null;
  const id = crypto.randomUUID();
  try {
    const child = spawn(process.execPath, [WORKER], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...env, [PAYLOAD_VAR]: JSON.stringify({ id, command, args: redactArgs(withoutFreeText(argv)) }) },
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    return null;
  }
  runId = id;
  return id;
}

function currentRunId() {
  return runId;
}

module.exports = { emitCommandAudit, startCommandAudit, logCommandRun, currentRunId, cliVersion, redactArgs, withoutFreeText, buildAudit, PAYLOAD_VAR };
