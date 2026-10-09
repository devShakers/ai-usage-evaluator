'use strict';

const os = require('os');
const path = require('path');
const { scrubSecrets } = require('./agent-synthesis');
const { loadAuthSession } = require('./auth-session-store');
const { getCertsBase } = require('./config');
const { postJsonWithTimeout } = require('./backend-request');

// Fire-and-forget: short timeout, every error swallowed, so a logging failure never blocks or fails a command.
const AUDIT_TIMEOUT_MS = 1500;

// Capped at 200 chars AFTER scrubbing (mirrors MAX_COMMAND_LEN in session-scan.js) so a secret straddling the cut cannot leak.
const MAX_ARGS_LEN = 200;

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

// Builds the record + headers; returns null when there is no endpoint to post to.
function buildAudit(command, argv, env) {
  let base;
  try {
    base = getCertsBase(env);
  } catch {
    base = null;
  }
  if (!base) return null;

  const session = loadAuthSession(env);
  const token =
    session && (session.accessToken || session.hubAccessToken)
      ? session.accessToken || session.hubAccessToken
      : null;

  const body = {
    command: String(command || 'unknown').slice(0, 100),
    args: redactArgs(argv),
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
function emitCommandAudit({ command, argv = [], env = process.env } = {}) {
  try {
    const audit = buildAudit(command, argv, env);
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

module.exports = { emitCommandAudit, redactArgs, buildAudit };
