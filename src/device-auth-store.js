'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config-dir');

// `~/.config/shakers/device-auth.json` — bridges the MCP start/poll tools; the secret device_code lives here (0600), never in a tool result.

const DEVICE_FILE_NAME = 'device-auth.json';
const DEVICE_FILE_VERSION = 1;

function devicePath(env = process.env) {
  return path.join(getConfigDir(env), DEVICE_FILE_NAME);
}

// Atomic 0600 write (temp + fsync + rename), same recipe as auth-session-store.
function savePendingDevice(pending, env = process.env, { fs: fsImpl = fs } = {}) {
  const payload = `${JSON.stringify(
    {
      deviceCode: typeof pending.deviceCode === 'string' && pending.deviceCode ? pending.deviceCode : null,
      verificationUrl: typeof pending.verificationUrl === 'string' && pending.verificationUrl ? pending.verificationUrl : null,
      userCode: typeof pending.userCode === 'string' && pending.userCode ? pending.userCode : null,
      tokenEndpoint: typeof pending.tokenEndpoint === 'string' && pending.tokenEndpoint ? pending.tokenEndpoint : null,
      authTokenEndpoint: typeof pending.authTokenEndpoint === 'string' && pending.authTokenEndpoint ? pending.authTokenEndpoint : null,
      interval: typeof pending.interval === 'number' && pending.interval > 0 ? Math.floor(pending.interval) : 5,
      expiresAt: typeof pending.expiresAt === 'string' && pending.expiresAt ? pending.expiresAt : null,
      mode: pending.mode === 'register' ? 'register' : 'login',
      provider: pending.provider === 'linkedin' ? 'linkedin' : 'google',
      registerContext: pending.registerContext && typeof pending.registerContext === 'object' ? pending.registerContext : null,
      email: typeof pending.email === 'string' && pending.email ? pending.email : null,
      version: DEVICE_FILE_VERSION,
    },
    null,
    2,
  )}\n`;

  const target = devicePath(env);
  const dir = path.dirname(target);
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const tmp = path.join(dir, `.${DEVICE_FILE_NAME}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fsImpl.openSync(tmp, 'wx', 0o600);
    fsImpl.writeFileSync(fd, payload);
    try { fsImpl.fsyncSync(fd); } catch { /* e.g. EINVAL on some filesystems */ }
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, target);
  } catch (e) {
    if (fd !== null) { try { fsImpl.closeSync(fd); } catch { /* already closed */ } }
    try { fsImpl.unlinkSync(tmp); } catch { /* never existed */ }
    throw e;
  }
  return target;
}

function loadPendingDevice(env = process.env, { fs: fsImpl = fs } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(devicePath(env), 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.version !== DEVICE_FILE_VERSION) return null;
  if (typeof parsed.deviceCode !== 'string' || !parsed.deviceCode) return null;
  return {
    deviceCode: parsed.deviceCode,
    verificationUrl: typeof parsed.verificationUrl === 'string' && parsed.verificationUrl ? parsed.verificationUrl : null,
    userCode: typeof parsed.userCode === 'string' && parsed.userCode ? parsed.userCode : null,
    tokenEndpoint: typeof parsed.tokenEndpoint === 'string' && parsed.tokenEndpoint ? parsed.tokenEndpoint : null,
    authTokenEndpoint: typeof parsed.authTokenEndpoint === 'string' && parsed.authTokenEndpoint ? parsed.authTokenEndpoint : null,
    interval: typeof parsed.interval === 'number' && parsed.interval > 0 ? Math.floor(parsed.interval) : 5,
    expiresAt: typeof parsed.expiresAt === 'string' && parsed.expiresAt ? parsed.expiresAt : null,
    mode: parsed.mode === 'register' ? 'register' : 'login',
    provider: parsed.provider === 'linkedin' ? 'linkedin' : 'google',
    registerContext: parsed.registerContext && typeof parsed.registerContext === 'object' ? parsed.registerContext : null,
    email: typeof parsed.email === 'string' && parsed.email ? parsed.email : null,
  };
}

function clearPendingDevice(env = process.env, { fs: fsImpl = fs } = {}) {
  try {
    fsImpl.unlinkSync(devicePath(env));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DEVICE_FILE_NAME,
  DEVICE_FILE_VERSION,
  devicePath,
  savePendingDevice,
  loadPendingDevice,
  clearPendingDevice,
};
