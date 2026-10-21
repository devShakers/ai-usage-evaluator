'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config-dir');

const MARKER_FILE_NAME = 'account-marker.json';
const MARKER_FILE_VERSION = 1;

function accountMarkerPath(env = process.env) {
  return path.join(getConfigDir(env), MARKER_FILE_NAME);
}

function hasAccountMarker(env = process.env, { fs: fsImpl = fs } = {}) {
  return fsImpl.existsSync(accountMarkerPath(env));
}

function recordAccountMarker(kind, env = process.env, { fs: fsImpl = fs } = {}) {
  if (hasAccountMarker(env, { fs: fsImpl })) return;
  const target = accountMarkerPath(env);
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${MARKER_FILE_NAME}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const payload = `${JSON.stringify({ version: MARKER_FILE_VERSION, kind, at: new Date().toISOString() }, null, 2)}\n`;
  try {
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fd = fsImpl.openSync(tmp, 'wx', 0o600);
    try {
      fsImpl.writeFileSync(fd, payload);
      try { fsImpl.fsyncSync(fd); } catch {}
    } finally {
      fsImpl.closeSync(fd);
    }
    fsImpl.renameSync(tmp, target);
  } catch {
    try { fsImpl.unlinkSync(tmp); } catch {}
  }
}

module.exports = { hasAccountMarker, recordAccountMarker };
