'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config-dir');

// `~/.config/shakers/auth-session.json` — the logged-in Talent's session (talents-ai-score, issue 122 / ADR-044).

// Hub's `UserSubtypeEnum` (shared/domain/enum/user-subtype.enum.ts), copied VERBATIM — this repo never invents a value the wire does not send.
const PLATFORM_TALENT_USER_TYPES = new Set(['WORKS_TALENT', 'WORKS_PARTNER']);
const KNOWN_USER_TYPES = new Set(['HUB', 'WORKS_CLIENT', 'WORKS_TALENT', 'WORKS_PARTNER']);

// Decodes (NEVER verifies — this module has no secret to verify with, and the claim only ever picks which COPY prints) a JWT's payload segment.
function decodeJwtPayload(token) {
  if (typeof token !== 'string' || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The one place `hubAccessToken` -> `userType` happens.
function userTypeFromHubToken(hubAccessToken) {
  const payload = decodeJwtPayload(hubAccessToken);
  const userType = payload && typeof payload.userType === 'string' ? payload.userType : null;
  return userType && KNOWN_USER_TYPES.has(userType) ? userType : null;
}

function emailFromHubToken(hubAccessToken) {
  const payload = decodeJwtPayload(hubAccessToken);
  const email = payload && typeof payload.email === 'string' ? payload.email : null;
  return email || null;
}

function firstNameFromSession(session) {
  if (!session || typeof session !== 'object') return null;
  const token = (typeof session.hubAccessToken === 'string' && session.hubAccessToken)
    ? session.hubAccessToken
    : (typeof session.accessToken === 'string' ? session.accessToken : null);
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const raw = [payload.name, payload.given_name, payload.firstName, payload.first_name]
    .find((v) => typeof v === 'string' && v.trim());
  if (!raw) return null;
  const first = raw.trim().split(/\s+/)[0];
  return first || null;
}

// `exp` (JWT seconds-since-epoch) -> ISO string, or null.
function expiresAtFromToken(token) {
  const payload = decodeJwtPayload(token);
  const exp = payload && typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null;
  if (exp === null) return null;
  try {
    return new Date(exp * 1000).toISOString();
  } catch {
    return null;
  }
}

// The ONE predicate every gate reads (src/report-gating.js), so two call
// sites can never disagree about which `userType` values count as a Talent.
function isPlatformTalent(session) {
  return !!(session && PLATFORM_TALENT_USER_TYPES.has(session.userType));
}

const SESSION_FILE_NAME = 'auth-session.json';

// Bumped when the shape changes in a way an older/newer CLI cannot read.
const SESSION_FILE_VERSION = 2;

function configDir(env = process.env) {
  return getConfigDir(env);
}

function authSessionPath(env = process.env) {
  return path.join(configDir(env), SESSION_FILE_NAME);
}

// ATOMIC 0600 write.
function saveAuthSession(session, env = process.env, { fs: fsImpl = fs } = {}) {
  const explicitHubToken = typeof session.hubAccessToken === 'string' && session.hubAccessToken ? session.hubAccessToken : null;
  const hubAccessToken = explicitHubToken || (typeof session.accessToken === 'string' && session.accessToken ? session.accessToken : null);

  const cookie = typeof session.cookie === 'string' && session.cookie ? session.cookie : null;
  let expiresAt;
  let accessTokenExpiresAt;
  if (cookie) {
    expiresAt = (typeof session.cookieExpiresAt === 'string' && session.cookieExpiresAt)
      ? session.cookieExpiresAt
      : (typeof session.expiresAt === 'string' && session.expiresAt ? session.expiresAt : null);
    accessTokenExpiresAt = (typeof session.accessTokenExpiresAt === 'string' && session.accessTokenExpiresAt)
      ? session.accessTokenExpiresAt
      : expiresAtFromToken(session.accessToken);
  } else {
    expiresAt = (typeof session.expiresAt === 'string' && session.expiresAt) ? session.expiresAt : expiresAtFromToken(session.accessToken);
    accessTokenExpiresAt = expiresAt;
  }

  const payload = `${JSON.stringify(
    {
      accessToken: typeof session.accessToken === 'string' && session.accessToken ? session.accessToken : null,
      expiresAt: expiresAt ?? null,
      accessTokenExpiresAt: accessTokenExpiresAt ?? null,
      cookie,
      email: (typeof session.email === 'string' && session.email ? session.email : null)
        || emailFromHubToken(hubAccessToken),
      hubAccessToken,
      // Decoded once from the SAME `hubAccessToken` this session carries (see the
      // module docblock) — never a second round-trip or source of truth.
      userType: userTypeFromHubToken(hubAccessToken),
      version: SESSION_FILE_VERSION,
    },
    null,
    2,
  )}\n`;

  const target = authSessionPath(env);
  const dir = path.dirname(target);
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const tmp = path.join(dir, `.${SESSION_FILE_NAME}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
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
    // A stale temp would accumulate one bearer-token-holding file per failure.
    try { fsImpl.unlinkSync(tmp); } catch { /* never existed */ }
    throw e;
  }
  return target;
}

// Reads the file, or `null` for "no session": missing, unreadable, malformed JSON, unrecognized `version`, or missing the one field without which there is no session (`accessToken`).
function loadAuthSession(env = process.env, { fs: fsImpl = fs } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(fsImpl.readFileSync(authSessionPath(env), 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.version !== SESSION_FILE_VERSION) return null;
  // A usable session needs at least ONE credential: the durable cookie (email/
  // better-auth) or a JWT (Google/legacy, or an email session whose JWT is cached).
  const hasCookie = typeof parsed.cookie === 'string' && parsed.cookie;
  const hasToken = typeof parsed.accessToken === 'string' && parsed.accessToken;
  if (!hasCookie && !hasToken) return null;
  const hubAccessToken = typeof parsed.hubAccessToken === 'string' && parsed.hubAccessToken ? parsed.hubAccessToken : null;
  const email = (typeof parsed.email === 'string' && parsed.email ? parsed.email : null) || emailFromHubToken(hubAccessToken);
  return {
    accessToken: hasToken ? parsed.accessToken : null,
    expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    accessTokenExpiresAt: typeof parsed.accessTokenExpiresAt === 'string' ? parsed.accessTokenExpiresAt : null,
    cookie: hasCookie ? parsed.cookie : null,
    email,
    hubAccessToken,
    userType: typeof parsed.userType === 'string' && KNOWN_USER_TYPES.has(parsed.userType) ? parsed.userType : null,
  };
}

// Removes the file. Idempotent and never throws — `logout` on no session is a
// no-op, not a failure.
function clearAuthSession(env = process.env, { fs: fsImpl = fs } = {}) {
  try {
    fsImpl.unlinkSync(authSessionPath(env));
    return true;
  } catch {
    return false;
  }
}

// `none | active | expired`, the three states the caller needs to give the Talent a true message.
function sessionStatus(session, now = Date.now()) {
  // A credential is either the durable cookie (email) or a JWT (Google/legacy).
  const hasCred = !!(session && ((typeof session.accessToken === 'string' && session.accessToken) || (typeof session.cookie === 'string' && session.cookie)));
  if (!hasCred) return 'none';
  const expiry = Date.parse(String(session.expiresAt || ''));
  if (!Number.isFinite(expiry)) return 'expired';
  return expiry > now ? 'active' : 'expired';
}

// The single predicate the rest of the CLI asks: is there a usable session right
// now? Everything gating reads reduces to this.
function isLoggedIn(env = process.env, now = Date.now(), deps = {}) {
  return sessionStatus(loadAuthSession(env, deps), now) === 'active';
}

module.exports = {
  SESSION_FILE_NAME,
  SESSION_FILE_VERSION,
  authSessionPath,
  saveAuthSession,
  loadAuthSession,
  clearAuthSession,
  sessionStatus,
  isLoggedIn,
  isPlatformTalent,
  PLATFORM_TALENT_USER_TYPES,
  decodeJwtPayload,
  emailFromHubToken,
  firstNameFromSession,
};
