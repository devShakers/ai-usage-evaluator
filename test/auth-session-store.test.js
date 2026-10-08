'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  saveAuthSession,
  loadAuthSession,
  clearAuthSession,
  sessionStatus,
  isLoggedIn,
  isPlatformTalent,
  authSessionPath,
  SESSION_FILE_VERSION,
  decodeJwtPayload,
  firstNameFromSession,
} = require('../src/auth-session-store');

// talents-ai-score, issue 122 / ADR-044.

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-auth-'));
}

test('save -> load round-trips accessToken + expiresAt, defaults hubAccessToken to the one token, and drops everything else', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  saveAuthSession({ accessToken: 'jwt-abc', expiresAt: '2026-08-12T00:00:00.000Z', extra: 'ignored' }, env);
  const loaded = loadAuthSession(env);
  // ADR-031 single Hub token: with no distinct `hubAccessToken` given, it defaults to `accessToken` (one token serves Bearer-against-certs AND the X-Hub-Token relays).
  assert.deepEqual(loaded, { accessToken: 'jwt-abc', expiresAt: '2026-08-12T00:00:00.000Z', accessTokenExpiresAt: '2026-08-12T00:00:00.000Z', cookie: null, email: null, hubAccessToken: 'jwt-abc', userType: null });
  // The `extra` field never survives — only the shape's own fields do.
  assert.equal('extra' in loaded, false);
});

test('save -> load: an email session persists the cookie and keeps cookie vs JWT expiry distinct', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  const cookieExp = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const jwtExp = new Date(Date.now() + 900 * 1000).toISOString();
  saveAuthSession({
    accessToken: 'jwt-abc',
    cookie: 'better-auth.session_token=sess-xyz',
    cookieExpiresAt: cookieExp,
    accessTokenExpiresAt: jwtExp,
    email: 'talent@example.com',
  }, env);
  const loaded = loadAuthSession(env);
  assert.equal(loaded.cookie, 'better-auth.session_token=sess-xyz');
  assert.equal(loaded.expiresAt, cookieExp);            // durable validity = cookie
  assert.equal(loaded.accessTokenExpiresAt, jwtExp);    // ephemeral JWT horizon
  // The session stays "active" for the cookie's lifetime even though the JWT is short.
  assert.equal(sessionStatus(loaded), 'active');
});

// A cookie-only session (JWT not yet minted) is still a valid, active session.
test('sessionStatus: a cookie with a future expiry is active even with no accessToken', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(sessionStatus({ cookie: 'better-auth.session_token=x', expiresAt: future }), 'active');
});

test('save -> load round-trips email when present', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  saveAuthSession({ accessToken: 'jwt-abc', expiresAt: '2026-08-12T00:00:00.000Z', email: 'talent@example.com' }, env);
  const loaded = loadAuthSession(env);
  assert.equal(loaded.email, 'talent@example.com');
});

test('save -> load round-trips hubAccessToken when present', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  saveAuthSession({ accessToken: 'jwt-abc', expiresAt: '2026-08-12T00:00:00.000Z', hubAccessToken: 'hub-jwt-xyz' }, env);
  const loaded = loadAuthSession(env);
  assert.equal(loaded.hubAccessToken, 'hub-jwt-xyz');
});

// A non-string/empty hubAccessToken is never persisted verbatim.
test('save -> load: a non-string hubAccessToken falls back to the one token, never persisted verbatim', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  saveAuthSession({ accessToken: 'jwt-abc', expiresAt: '2026-08-12T00:00:00.000Z', hubAccessToken: 42 }, env);
  const loaded = loadAuthSession(env);
  assert.equal(loaded.hubAccessToken, 'jwt-abc');
});

test('save -> load: an absent/null email (the Google-login case) round-trips as null, not a missing key', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  saveAuthSession({ accessToken: 'jwt-abc', expiresAt: null, email: null }, env);
  const loaded = loadAuthSession(env);
  assert.equal(loaded.email, null);
  assert.equal('email' in loaded, true);
});

// A malformed/non-string `email` in an on-disk file degrades to `null`, same resilience contract the rest of this store holds (never throw on a corrupt/foreign field).
test('load: a non-string email on disk degrades to null rather than throwing', () => {
  const dir = freshDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    authSessionPath(env),
    JSON.stringify({ accessToken: 'x', expiresAt: null, email: 12345, version: SESSION_FILE_VERSION }),
  );
  assert.equal(loadAuthSession(env).email, null);
});

test('the file is written 0600 (a bearer token must not be group/world readable)', () => {
  if (process.platform === 'win32') return; // chmod is a no-op on Windows
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  saveAuthSession({ accessToken: 'jwt-abc', expiresAt: null }, env);
  const mode = fs.statSync(authSessionPath(env)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('the write is ATOMIC: no temp file is left behind on success', () => {
  const dir = freshDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  saveAuthSession({ accessToken: 'jwt-abc', expiresAt: null }, env);
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, [], `a temp file survived: ${leftovers.join(', ')}`);
});

test('a write that dies half way through leaves the PREVIOUS file intact and no temp behind', () => {
  const dir = freshDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  saveAuthSession({ accessToken: 'first', expiresAt: '2026-08-12T00:00:00.000Z' }, env);

  // A fs double whose rename throws AFTER the temp exists — the crash window.
  const realFs = fs;
  const brokenFs = {
    ...realFs,
    renameSync: () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); },
  };
  assert.throws(() => saveAuthSession({ accessToken: 'second', expiresAt: null }, env, { fs: brokenFs }));

  // The old file is untouched...
  assert.equal(loadAuthSession(env).accessToken, 'first');
  // ...and the failed temp was cleaned up, not left holding a token.
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('load is resilient: missing / malformed / wrong-version / tokenless all read as null', () => {
  const dir = freshDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  // Missing file.
  assert.equal(loadAuthSession(env), null);
  fs.mkdirSync(dir, { recursive: true });
  const file = authSessionPath(env);
  // Malformed JSON.
  fs.writeFileSync(file, '{not json');
  assert.equal(loadAuthSession(env), null);
  // Unrecognized version.
  fs.writeFileSync(file, JSON.stringify({ accessToken: 'x', version: 999 }));
  assert.equal(loadAuthSession(env), null);
  // No token.
  fs.writeFileSync(file, JSON.stringify({ expiresAt: '2026-08-12T00:00:00.000Z', version: SESSION_FILE_VERSION }));
  assert.equal(loadAuthSession(env), null);
});

test('clear is idempotent and never throws (logout with no session is a no-op)', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  assert.equal(clearAuthSession(env), false); // nothing to remove
  saveAuthSession({ accessToken: 'x', expiresAt: null }, env);
  assert.equal(clearAuthSession(env), true);
  assert.equal(clearAuthSession(env), false); // already gone
  assert.equal(loadAuthSession(env), null);
});

test('sessionStatus: active while the expiry is in the future', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(sessionStatus({ accessToken: 'x', expiresAt: future }), 'active');
});

test('sessionStatus: expired once the expiry is past — told, not swallowed (ADR-044)', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(sessionStatus({ accessToken: 'x', expiresAt: past }), 'expired');
});

test('sessionStatus: an UNPARSEABLE expiry is expired, NOT active (a token we cannot date is not trusted)', () => {
  // Deliberately the OPPOSITE of the interview store, which treats an unparseable clock as live because the server is the authority there.
  assert.equal(sessionStatus({ accessToken: 'x', expiresAt: 'whenever' }), 'expired');
  assert.equal(sessionStatus({ accessToken: 'x', expiresAt: null }), 'expired');
});

test('sessionStatus: none with no session or no token', () => {
  assert.equal(sessionStatus(null), 'none');
  assert.equal(sessionStatus({ expiresAt: '2026-08-12T00:00:00.000Z' }), 'none');
});

test('isLoggedIn is exactly "an active session on disk"', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  assert.equal(isLoggedIn(env), false);
  saveAuthSession({ accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString() }, env);
  assert.equal(isLoggedIn(env), true);
  // Expired on disk -> not logged in.
  saveAuthSession({ accessToken: 'x', expiresAt: new Date(Date.now() - 1000).toISOString() }, env);
  assert.equal(isLoggedIn(env), false);
});

function fakeJwt(payload) {
  const seg = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${seg({ alg: 'none' })}.${seg(payload)}.sig`;
}

test('decodeJwtPayload: reads the middle segment, never throws on garbage', () => {
  assert.deepEqual(decodeJwtPayload(fakeJwt({ userType: 'WORKS_TALENT' })), { userType: 'WORKS_TALENT' });
  assert.equal(decodeJwtPayload(null), null);
  assert.equal(decodeJwtPayload(''), null);
  assert.equal(decodeJwtPayload('not-a-jwt'), null); // only one segment
  assert.equal(decodeJwtPayload('a.b'), null); // only two segments
  assert.equal(decodeJwtPayload('a.!!!not-base64json!!!.c'), null); // unparseable payload
  // A payload that decodes to something other than a plain object (array,
  // primitive) must not be handed back as if it were one.
  assert.equal(decodeJwtPayload(`${Buffer.from('h').toString('base64url')}.${Buffer.from('[1,2]').toString('base64url')}.s`), null);
});

test('firstNameFromSession: takes the FIRST name token off the hub JWT name claim', () => {
  const session = { hubAccessToken: fakeJwt({ sub: 'u1', name: 'Alex Delgado' }) };
  assert.equal(firstNameFromSession(session), 'Alex');
});

test('firstNameFromSession: accepts given_name / firstName / first_name and falls back through the hub token', () => {
  assert.equal(firstNameFromSession({ hubAccessToken: fakeJwt({ given_name: 'Marta Lopez' }) }), 'Marta');
  assert.equal(firstNameFromSession({ hubAccessToken: fakeJwt({ firstName: 'Carlos' }) }), 'Carlos');
  assert.equal(firstNameFromSession({ hubAccessToken: fakeJwt({ first_name: 'Ana Ruiz' }) }), 'Ana');
  // No hubAccessToken → decode the plain accessToken instead.
  assert.equal(firstNameFromSession({ accessToken: fakeJwt({ name: 'Sam Smith' }) }), 'Sam');
});

test('firstNameFromSession: defensive → null when there is no name, no session, or a bad token', () => {
  assert.equal(firstNameFromSession(null), null);
  assert.equal(firstNameFromSession({}), null);
  assert.equal(firstNameFromSession({ hubAccessToken: 'not-a-jwt' }), null);
  assert.equal(firstNameFromSession({ hubAccessToken: fakeJwt({ sub: 'u1' }) }), null); // no name claim
  assert.equal(firstNameFromSession({ hubAccessToken: fakeJwt({ name: '   ' }) }), null); // blank name
});

test('save -> load: WORKS_TALENT decodes off hubAccessToken and round-trips as userType', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  const hubAccessToken = fakeJwt({ sub: 'u1', email: 'talent@example.com', userType: 'WORKS_TALENT' });
  saveAuthSession({ accessToken: 'jwt-abc', expiresAt: null, hubAccessToken }, env);
  const loaded = loadAuthSession(env);
  assert.equal(loaded.userType, 'WORKS_TALENT');
  assert.equal(isPlatformTalent(loaded), true);
});

test('save -> load: harvests email from the hub JWT when no explicit session.email (Google device flow)', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  const hubAccessToken = fakeJwt({ sub: 'u1', email: 'google-user@example.com', userType: 'WORKS_TALENT' });
  saveAuthSession({ accessToken: hubAccessToken, hubAccessToken, expiresAt: null }, env);
  assert.equal(loadAuthSession(env).email, 'google-user@example.com');
});

test('save -> load: an explicit session.email wins over the token claim (email+password path unchanged)', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  const hubAccessToken = fakeJwt({ email: 'token@example.com', userType: 'WORKS_TALENT' });
  saveAuthSession({ accessToken: 'jwt-abc', hubAccessToken, email: 'typed@example.com', expiresAt: null }, env);
  assert.equal(loadAuthSession(env).email, 'typed@example.com');
});

test('load: self-heals a pre-fix session persisted with a null email, from the stored token', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  const hubAccessToken = fakeJwt({ email: 'stored@example.com', userType: 'WORKS_TALENT' });
  fs.writeFileSync(authSessionPath(env), JSON.stringify({
    accessToken: 'jwt-abc', expiresAt: null, accessTokenExpiresAt: null,
    cookie: null, email: null, hubAccessToken, userType: 'WORKS_TALENT', version: SESSION_FILE_VERSION,
  }));
  assert.equal(loadAuthSession(env).email, 'stored@example.com');
});

test('load: a garbage hubAccessToken leaves email null (defensive, never throws)', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  fs.writeFileSync(authSessionPath(env), JSON.stringify({
    accessToken: 'jwt-abc', expiresAt: null, accessTokenExpiresAt: null,
    cookie: null, email: null, hubAccessToken: 'not-a-jwt', userType: null, version: SESSION_FILE_VERSION,
  }));
  assert.equal(loadAuthSession(env).email, null);
});

test('save -> load: WORKS_PARTNER is ALSO a platform Talent (has orgs, still a Talent)', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  const hubAccessToken = fakeJwt({ userType: 'WORKS_PARTNER' });
  saveAuthSession({ accessToken: 'x', expiresAt: null, hubAccessToken }, env);
  assert.equal(isPlatformTalent(loadAuthSession(env)), true);
});

test('save -> load: HUB (staff) and WORKS_CLIENT (a hiring company) are NOT platform Talents', () => {
  for (const userType of ['HUB', 'WORKS_CLIENT']) {
    const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
    saveAuthSession({ accessToken: 'x', expiresAt: null, hubAccessToken: fakeJwt({ userType }) }, env);
    const loaded = loadAuthSession(env);
    assert.equal(loaded.userType, userType, `${userType} must still be recorded, just not as a Talent`);
    assert.equal(isPlatformTalent(loaded), false, `${userType} must not gate the framework copy on`);
  }
});

test('save -> load: no hubAccessToken at all -> userType is null, never guessed', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  saveAuthSession({ accessToken: 'x', expiresAt: null }, env);
  const loaded = loadAuthSession(env);
  assert.equal(loaded.userType, null);
  assert.equal(isPlatformTalent(loaded), false);
});

test('save -> load: a garbage hubAccessToken (not a real JWT) degrades userType to null, never throws', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  assert.doesNotThrow(() => saveAuthSession({ accessToken: 'x', expiresAt: null, hubAccessToken: 'not-a-real-jwt' }, env));
  assert.equal(loadAuthSession(env).userType, null);
});

test('save -> load: an OUT-OF-VOCABULARY userType is coerced to null, not trusted verbatim', () => {
  const env = { AI_FOOTPRINT_CONFIG_DIR: freshDir() };
  saveAuthSession({ accessToken: 'x', expiresAt: null, hubAccessToken: fakeJwt({ userType: 'SUPER_ADMIN_ROOT' }) }, env);
  const loaded = loadAuthSession(env);
  assert.equal(loaded.userType, null);
  assert.equal(isPlatformTalent(loaded), false);
});

test('load: a session file with no userType key at all degrades to null, not a crash', () => {
  const dir = freshDir();
  const env = { AI_FOOTPRINT_CONFIG_DIR: dir };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    authSessionPath(env),
    JSON.stringify({ accessToken: 'x', expiresAt: null, version: SESSION_FILE_VERSION }),
  );
  const loaded = loadAuthSession(env);
  assert.equal(loaded.userType, null);
  assert.equal(isPlatformTalent(loaded), false);
});

test('isPlatformTalent: null/undefined session is not a Talent, never throws', () => {
  assert.equal(isPlatformTalent(null), false);
  assert.equal(isPlatformTalent(undefined), false);
  assert.equal(isPlatformTalent({}), false);
});
