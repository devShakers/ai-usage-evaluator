'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestLogin, requestAuthToken, normalizeResponse } = require('../src/auth-client');

// Owner decision (supersedes ADR-031 for email): login is now better-auth email sign-in (cookie) + GET /auth/token (JWT).

const COOKIE = 'better-auth.session_token=sess-xyz';

// A short-lived JWT with the given exp (seconds) so `expiresAtFromJwt` decodes it.
function fakeJwt(expSeconds) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'ES256' })}.${b({ sub: 'u1', exp: expSeconds })}.sig`;
}

// Two-route better-auth mock. `signIn` decides the POST /sign-in/email response;
// `token` decides the GET /auth/token response. Records the sign-in body.
function startAuthServer({ signIn, token } = {}) {
  const seen = { signInBody: null, tokenCookie: null };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.method === 'POST' && req.url.endsWith('/sign-in/email')) {
          try { seen.signInBody = JSON.parse(raw); } catch { seen.signInBody = null; }
          signIn(req, res);
        } else if (req.method === 'GET' && req.url.endsWith('/auth/token')) {
          seen.tokenCookie = req.headers.cookie || null;
          token(req, res);
        } else {
          res.writeHead(404).end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}/api/v1`;
      resolve({ server, seen, signInEndpoint: `${base}/auth/sign-in/email`, tokenEndpoint: `${base}/auth/token` });
    });
  });
}

const okSignIn = (email) => (req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}; Max-Age=604800; Path=/; HttpOnly` });
  res.end(JSON.stringify({ redirect: false, token: 'session-tok', user: { id: 'u1', email } }));
};
const status = (code, body = {}) => (req, res) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

test('sign-in captures the cookie, GET /auth/token mints the JWT -> ok, carrying token+cookie', async () => {
  const exp = Math.floor(Date.now() / 1000) + 900;
  const jwt = fakeJwt(exp);
  const { server, seen, signInEndpoint, tokenEndpoint } = await startAuthServer({
    signIn: okSignIn('talent@example.com'),
    token: (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ token: jwt })); },
  });
  try {
    const res = await requestLogin({ email: 'Talent@Example.com', password: 'pw' }, { signInEndpoint, tokenEndpoint, timeoutMs: 2000 });
    assert.equal(res.ok, true);
    assert.equal(res.accessToken, jwt);
    assert.equal(res.hubAccessToken, jwt);
    assert.equal(res.cookie, COOKIE);
    assert.equal(res.email, 'talent@example.com');
    assert.equal(res.expiresAt, new Date(exp * 1000).toISOString());
    assert.ok(res.cookieExpiresAt); // ~7 days from the Max-Age
    // The GET carried the captured cookie; the password never appears in the result.
    assert.equal(seen.tokenCookie, COOKIE);
    assert.deepEqual(seen.signInBody, { email: 'Talent@Example.com', password: 'pw' });
    assert.equal(JSON.stringify(res).includes('pw'), false);
  } finally {
    server.close();
  }
});

test('sign-in over HTTPS sets __Secure--prefixed cookie -> captured, and the GET forwards the prefixed name verbatim', async () => {
  const jwt = fakeJwt(Math.floor(Date.now() / 1000) + 900);
  const secureCookie = `__Secure-better-auth.session_token=sess-https`;
  const { server, seen, signInEndpoint, tokenEndpoint } = await startAuthServer({
    signIn: (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${secureCookie}; Max-Age=604800; Path=/; Secure; HttpOnly; SameSite=Lax` });
      res.end(JSON.stringify({ redirect: false, user: { id: 'u1', email: 'talent@example.com' } }));
    },
    token: (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ token: jwt })); },
  });
  try {
    const res = await requestLogin({ email: 'talent@example.com', password: 'pw' }, { signInEndpoint, tokenEndpoint, timeoutMs: 2000 });
    assert.equal(res.ok, true);
    assert.equal(res.cookie, secureCookie, 'the exact server-set (prefixed) name is preserved');
    assert.equal(seen.tokenCookie, secureCookie, 'GET /auth/token forwards the prefixed cookie name, not the bare one');
    assert.ok(res.cookieExpiresAt); // Max-Age still read off the prefixed entry
  } finally {
    server.close();
  }
});

test('sign-in 200 with NO Set-Cookie -> bad-response', async () => {
  const { server, signInEndpoint, tokenEndpoint } = await startAuthServer({
    signIn: (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ user: { id: 'u1' } })); },
    token: status(200, { token: fakeJwt(1) }),
  });
  try {
    const res = await requestLogin({ email: 'a@b.com', password: 'pw' }, { signInEndpoint, tokenEndpoint, timeoutMs: 2000 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'bad-response');
  } finally {
    server.close();
  }
});

test('sign-in 401 -> invalid-credentials (no token call)', async () => {
  const { server, signInEndpoint, tokenEndpoint } = await startAuthServer({ signIn: status(401, { code: 'INVALID_EMAIL_OR_PASSWORD' }), token: status(200, { token: fakeJwt(1) }) });
  try {
    const res = await requestLogin({ email: 'a@b.com', password: 'bad' }, { signInEndpoint, tokenEndpoint, timeoutMs: 2000 });
    assert.deepEqual(res, { ok: false, reason: 'invalid-credentials', status: 401 });
  } finally {
    server.close();
  }
});

for (const code of [409, 422]) {
  test(`sign-in ${code} -> no-email-password`, async () => {
    const { server, signInEndpoint, tokenEndpoint } = await startAuthServer({ signIn: status(code, {}), token: status(200, {}) });
    try {
      const res = await requestLogin({ email: 'g@b.com', password: 'pw' }, { signInEndpoint, tokenEndpoint, timeoutMs: 2000 });
      assert.equal(res.reason, 'no-email-password');
    } finally {
      server.close();
    }
  });
}

for (const code of [502, 503]) {
  test(`sign-in ${code} -> upstream`, async () => {
    const { server, signInEndpoint, tokenEndpoint } = await startAuthServer({ signIn: status(code, {}), token: status(200, {}) });
    try {
      const res = await requestLogin({ email: 'a@b.com', password: 'pw' }, { signInEndpoint, tokenEndpoint, timeoutMs: 2000 });
      assert.equal(res.reason, 'upstream');
    } finally {
      server.close();
    }
  });
}

test('sign-in any other status -> http-error, carrying the code', async () => {
  const { server, signInEndpoint, tokenEndpoint } = await startAuthServer({ signIn: status(418, {}), token: status(200, {}) });
  try {
    const res = await requestLogin({ email: 'a@b.com', password: 'pw' }, { signInEndpoint, tokenEndpoint, timeoutMs: 2000 });
    assert.deepEqual(res, { ok: false, reason: 'http-error', status: 418 });
  } finally {
    server.close();
  }
});

test('good sign-in but GET /auth/token fails -> token-fetch-failed', async () => {
  const { server, signInEndpoint, tokenEndpoint } = await startAuthServer({ signIn: okSignIn('a@b.com'), token: status(500, {}) });
  try {
    const res = await requestLogin({ email: 'a@b.com', password: 'pw' }, { signInEndpoint, tokenEndpoint, timeoutMs: 2000 });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'token-fetch-failed');
  } finally {
    server.close();
  }
});

test('no sign-in endpoint -> no-endpoint, nothing sent', async () => {
  const res = await requestLogin({ email: 'a@b.com', password: 'pw' }, { signInEndpoint: null });
  assert.deepEqual(res, { ok: false, reason: 'no-endpoint' });
});

test('connection refused on sign-in -> network-error, never a throw', async () => {
  const res = await requestLogin({ email: 'a@b.com', password: 'pw' }, { signInEndpoint: 'http://127.0.0.1:1/api/v1/auth/sign-in/email', tokenEndpoint: 'http://127.0.0.1:1/api/v1/auth/token', timeoutMs: 2000 });
  assert.equal(res.reason, 'network-error');
});

test('requestAuthToken: GET with cookie -> {ok, accessToken, expiresAt}; guards on missing inputs', async () => {
  const exp = Math.floor(Date.now() / 1000) + 900;
  const jwt = fakeJwt(exp);
  const { server, seen, tokenEndpoint } = await startAuthServer({ signIn: status(200, {}), token: (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ token: jwt })); } });
  try {
    const ok = await requestAuthToken({ cookie: COOKIE }, { endpoint: tokenEndpoint, timeoutMs: 2000 });
    assert.equal(ok.ok, true);
    assert.equal(ok.accessToken, jwt);
    assert.equal(ok.expiresAt, new Date(exp * 1000).toISOString());
    assert.equal(seen.tokenCookie, COOKIE);
    assert.equal((await requestAuthToken({ cookie: COOKIE }, { endpoint: null })).reason, 'no-endpoint');
    assert.equal((await requestAuthToken({}, { endpoint: tokenEndpoint })).reason, 'no-cookie');
  } finally {
    server.close();
  }
});

test('requestAuthToken: a non-2xx -> http-error; a 2xx with no token -> bad-response', async () => {
  const err = await startAuthServer({ signIn: status(200, {}), token: status(401, {}) });
  try {
    assert.equal((await requestAuthToken({ cookie: COOKIE }, { endpoint: err.tokenEndpoint })).reason, 'http-error');
  } finally { err.server.close(); }
  const noTok = await startAuthServer({ signIn: status(200, {}), token: status(200, {}) });
  try {
    assert.equal((await requestAuthToken({ cookie: COOKIE }, { endpoint: noTok.tokenEndpoint })).reason, 'bad-response');
  } finally { noTok.server.close(); }
});

test('normalizeResponse: the pure mapping, exhaustively, including a 2xx with garbage body', () => {
  // THE REAL SHAPE: token under `data`.
  assert.deepEqual(
    normalizeResponse(200, JSON.stringify({ status: 'OK', data: { accessToken: 't', expiresAt: 'x' } })),
    { ok: true, accessToken: 't', expiresAt: 'x', email: null, hubAccessToken: null },
  );
  // A data envelope with an empty token is still unusable.
  assert.equal(normalizeResponse(200, JSON.stringify({ status: 'OK', data: { accessToken: '' } })).reason, 'bad-response');
  // The token under `data` but no expiry is ok — expiry is nullable.
  assert.deepEqual(
    normalizeResponse(200, JSON.stringify({ status: 'OK', data: { accessToken: 't' } })),
    { ok: true, accessToken: 't', expiresAt: null, email: null, hubAccessToken: null },
  );
  // RESILIENCE: a FLAT body (no `data` wrapper) still works via the fallback, so
  // an unwrapped deployment or a future contract change does not silently break.
  assert.deepEqual(
    normalizeResponse(200, JSON.stringify({ accessToken: 't', expiresAt: 'x' })),
    { ok: true, accessToken: 't', expiresAt: 'x', email: null, hubAccessToken: null },
  );
  // talents-ai-score, ADR-055: certs' own hub token for the Talent, carried
  // through the SAME envelope, same nullable contract as `email`.
  assert.deepEqual(
    normalizeResponse(200, JSON.stringify({ status: 'OK', data: { accessToken: 't', expiresAt: 'x', hubAccessToken: 'hub-jwt' } })),
    { ok: true, accessToken: 't', expiresAt: 'x', email: null, hubAccessToken: 'hub-jwt' },
  );
  // A non-string hubAccessToken degrades to null, never a thrown error.
  assert.deepEqual(
    normalizeResponse(200, JSON.stringify({ status: 'OK', data: { accessToken: 't', expiresAt: 'x', hubAccessToken: 42 } })),
    { ok: true, accessToken: 't', expiresAt: 'x', email: null, hubAccessToken: null },
  );
  assert.equal(normalizeResponse(200, 'not json').reason, 'bad-response');
  assert.equal(normalizeResponse(200, JSON.stringify({ status: 'OK' })).reason, 'bad-response'); // data present? no -> falls back to top level, no token
  assert.equal(normalizeResponse(401, '').reason, 'invalid-credentials');
  assert.equal(normalizeResponse(409, '').reason, 'no-email-password');
  assert.equal(normalizeResponse(422, '').reason, 'no-email-password');
  assert.equal(normalizeResponse(502, '').reason, 'upstream');
  assert.equal(normalizeResponse(503, '').reason, 'upstream');
  assert.equal(normalizeResponse(500, '').reason, 'http-error');

  // issue 130 follow-up: `data.email` is read when present, and stays `null`
  // when it isn't a non-empty string — same resilience contract as expiresAt.
  assert.deepEqual(
    normalizeResponse(200, JSON.stringify({ status: 'OK', data: { accessToken: 't', email: 'talent@example.com' } })),
    { ok: true, accessToken: 't', expiresAt: null, email: 'talent@example.com', hubAccessToken: null },
  );
  assert.equal(
    normalizeResponse(200, JSON.stringify({ status: 'OK', data: { accessToken: 't', email: '' } })).email,
    null,
  );
  assert.equal(
    normalizeResponse(200, JSON.stringify({ status: 'OK', data: { accessToken: 't', email: 42 } })).email,
    null,
  );
});
