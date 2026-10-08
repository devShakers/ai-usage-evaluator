'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestSignUp } = require('../src/signup-client');

// A two-route mock of the Hub's better-auth email register: POST /sign-up/email
// and POST /complete-registration. `onSignUp`/`onComplete` decide each response.
function startServer({ onSignUp, onComplete }) {
  const seen = { signUp: null, complete: null };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (req.url.endsWith('/sign-up/email')) {
          seen.signUp = { ctype: req.headers['content-type'], body: raw };
          onSignUp(req, res, raw);
        } else if (req.url.endsWith('/complete-registration')) {
          seen.complete = { cookie: req.headers.cookie, body: raw };
          onComplete(req, res, raw);
        } else {
          res.writeHead(404).end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, seen }));
  });
}

const BASE_FIELDS = { name: 'Ada', lastName: 'Lovelace', email: 'new@e.com', password: 'password123', preferredLanguage: 'es', newsletterConsent: true, freelanceType: 'FREELANCE' };
const COOKIE = 'better-auth.session_token=abc123';
const eps = (base) => ({ signUpEndpoint: `${base}/api/v1/auth/sign-up/email`, completeRegistrationEndpoint: `${base}/api/v1/works/auth/complete-registration` });

test('requestSignUp: sign-up (JSON) captures the cookie, then complete-registration with it -> accountExists:false', async () => {
  const { server, base, seen } = await startServer({
    onSignUp: (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}; Max-Age=604800; Path=/; HttpOnly` });
      res.end(JSON.stringify({ token: 'session-tok', user: { id: 'u1', email: 'new@e.com' } }));
    },
    onComplete: (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: { data: { userId: 'd1', mongoId: 'm1', userType: 'WORKS_TALENT' } } }));
    },
  });
  const r = await requestSignUp(BASE_FIELDS, eps(base));
  server.close();
  assert.deepEqual(r, { ok: true, accountExists: false });
  assert.match(seen.signUp.ctype, /application\/json/);
  const sent = JSON.parse(seen.signUp.body);
  assert.deepEqual(sent, { email: 'new@e.com', password: 'password123', name: 'Ada', lastName: 'Lovelace' });
  // complete-registration got the captured cookie + the talent userType/context.
  assert.equal(seen.complete.cookie, COOKIE);
  const cbody = JSON.parse(seen.complete.body);
  assert.equal(cbody.userType, 'WORKS_TALENT');
  assert.equal(cbody.context.preferredLanguage, 'ES');
  assert.equal(cbody.context.newsletterConsent, true);
  assert.equal(cbody.context.freelanceType, 'FREELANCE');
});

test('requestSignUp: a duplicate email (422) comes back as accountExists:true, no complete-registration', async () => {
  let completeCalled = false;
  const { server, base } = await startServer({
    onSignUp: (req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' }));
    },
    onComplete: (req, res) => { completeCalled = true; res.writeHead(200).end('{}'); },
  });
  const r = await requestSignUp(BASE_FIELDS, eps(base));
  server.close();
  assert.deepEqual(r, { ok: true, accountExists: true });
  assert.equal(completeCalled, false);
});

test('requestSignUp: a 409 duplicate is also accountExists:true', async () => {
  const { server, base } = await startServer({
    onSignUp: (req, res) => { res.writeHead(409).end('{}'); },
    onComplete: (req, res) => { res.writeHead(200).end('{}'); },
  });
  const r = await requestSignUp(BASE_FIELDS, eps(base));
  server.close();
  assert.deepEqual(r, { ok: true, accountExists: true });
});

test('requestSignUp: a sign-up error carries a named reason + the server message', async () => {
  const { server, base } = await startServer({
    onSignUp: (req, res) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'password too weak' })); },
    onComplete: (req, res) => { res.writeHead(200).end('{}'); },
  });
  const r = await requestSignUp(BASE_FIELDS, eps(base));
  server.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http-400');
  assert.equal(r.message, 'password too weak');
});

test('requestSignUp: a 2xx sign-up with no Set-Cookie is bad-response', async () => {
  const { server, base } = await startServer({
    onSignUp: (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ user: { id: 'u1' } })); },
    onComplete: (req, res) => { res.writeHead(200).end('{}'); },
  });
  const r = await requestSignUp(BASE_FIELDS, eps(base));
  server.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-response');
});

test('requestSignUp: a complete-registration failure is a named reason', async () => {
  const { server, base } = await startServer({
    onSignUp: (req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}; Path=/` }); res.end(JSON.stringify({ user: { id: 'u1' } })); },
    onComplete: (req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: 'no session' })); },
  });
  const r = await requestSignUp(BASE_FIELDS, eps(base));
  server.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'complete-registration-http-401');
});

test('requestSignUp: local guards fire before any request', async () => {
  assert.equal((await requestSignUp(BASE_FIELDS, {})).reason, 'no-endpoint');
  assert.equal((await requestSignUp({ email: 'e@e.com' }, { signUpEndpoint: 'http://x/s', completeRegistrationEndpoint: 'http://x/c' })).reason, 'missing-fields');
  // sign-up endpoint present but complete-registration missing -> no-endpoint (after a real sign-up would be needed; guard is pre-request here via missing-fields when incomplete).
  assert.equal((await requestSignUp({ name: 'A', lastName: 'B', email: 'e@e.com' }, { signUpEndpoint: 'http://x/s' })).reason, 'missing-fields');
});

function signUpOk(req, res) {
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `${COOKIE}; Max-Age=604800; Path=/; HttpOnly` });
  res.end(JSON.stringify({ token: 'session-tok' }));
}

test('requestSignUp with claimCode: complete-registration carries it top-level and reports claimed:true', async () => {
  const bodies = [];
  const { server, base } = await startServer({
    onSignUp: signUpOk,
    onComplete: (req, res, raw) => { bodies.push(JSON.parse(raw)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: {} })); },
  });
  const r = await requestSignUp({ ...BASE_FIELDS, claimCode: 'CODE-1' }, eps(base));
  server.close();
  assert.deepEqual(r, { ok: true, accountExists: false, claimed: true });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].claimCode, 'CODE-1');
  assert.equal(bodies[0].userType, 'WORKS_TALENT');
});

test('requestSignUp with an unclaimable code: hub refused the claim, the account is still registered without it (claimed:false)', async () => {
  for (const [status, code] of [[422, 'auth-engine.claim_code_invalid'], [409, 'users.unregistered_talent_not_claimable']]) {
    const bodies = [];
    const { server, base } = await startServer({
      onSignUp: signUpOk,
      onComplete: (req, res, raw) => {
        const body = JSON.parse(raw);
        bodies.push(body);
        res.writeHead(body.claimCode ? status : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body.claimCode ? { status: 'KO', code, message: 'x', meta: {} } : { status: 'OK', data: {} }));
      },
    });
    const r = await requestSignUp({ ...BASE_FIELDS, claimCode: 'CODE-1' }, eps(base));
    server.close();
    assert.deepEqual(r, { ok: true, accountExists: false, claimed: false }, code);
    assert.equal(bodies.length, 2, `${code}: one retry without the code`);
    assert.equal('claimCode' in bodies[1], false);
  }
});

test('requestSignUp with claimCode: any other complete-registration failure is not retried', async () => {
  let calls = 0;
  const { server, base } = await startServer({
    onSignUp: signUpOk,
    onComplete: (req, res) => { calls += 1; res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'KO', code: 'boom' })); },
  });
  const r = await requestSignUp({ ...BASE_FIELDS, claimCode: 'CODE-1' }, eps(base));
  server.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'complete-registration-http-500');
  assert.equal(calls, 1);
});
