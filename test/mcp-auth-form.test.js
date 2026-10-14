'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { runLoopbackAuth } = require('../src/mcp-auth-form');
const { LOGIN_SCHEMA } = require('../src/mcp-onboarding-tools');
const SIGNUP_SCHEMAS = require('../src/mcp-signup-tools');

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, body: d })); }).on('error', reject);
  });
}
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: `${u.pathname}submit`, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
    req.on('error', reject); req.write(body); req.end();
  });
}
const tick = () => new Promise((r) => setTimeout(r, 25));

function loginDeps(overrides = {}) {
  return {
    getLoginEndpoint: () => 'https://certs/api/v1/auth/login/email',
    requestLogin: async () => ({ ok: true, accessToken: 'certs-tok', hubAccessToken: 'hub-jwt', email: 't@t.com', expiresAt: Date.now() + 3600000 }),
    saveAuthSession: () => {},
    getSignUpEndpoint: () => 'https://hub/api/v1/auth/register/talent/email',
    requestSignUp: async () => ({ ok: true, accountExists: false, accessToken: 'hub-jwt' }),
    ...overrides,
  };
}

test('the login/sign-up tool schemas carry NO password (or any secret) field', () => {
  assert.equal(LOGIN_SCHEMA.properties.password, undefined);
  assert.equal(LOGIN_SCHEMA.properties.email, undefined);
  for (const name of ['WELCOME_SCHEMA', 'EMAIL_SCHEMA', 'DRAFT_SCHEMA', 'CREATE_SCHEMA', 'STATUS_SCHEMA', 'IMPORT_SCHEMA']) {
    assert.deepEqual(Object.keys(SIGNUP_SCHEMAS[name].properties).filter((k) => /pass|secret|token|code/i.test(k)), [], `${name}: the claim code and passwords never go through the chat`);
  }
});

test('login loopback: first screen is the method choice; /email reaches the form; a submit establishes the session and closes the server', async () => {
  let saved = null;
  let formUrl = null;
  const deps = loginDeps({ saveAuthSession: (s) => { saved = s; } });
  const p = runLoopbackAuth({ mode: 'login', deps }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();

  // GET / is the branded method-choice screen (email + Google + LinkedIn), NOT the email form.
  const choose = await httpGet(formUrl);
  assert.match(choose.body, /href="google"/, 'Continue-with-Google option present');
  assert.match(choose.body, /href="linkedin"/, 'Continue-with-LinkedIn option present');
  assert.match(choose.body, /Continue with LinkedIn/, 'LinkedIn has its own button, not a second email button');
  assert.match(choose.body, /href="email"/, 'Email option present');
  assert.match(choose.body, /Email and password/, 'login still offers email+password (its form collects both)');
  assert.match(choose.body, /#05342c/, 'brand teal present');
  assert.doesNotMatch(choose.body, /name="password"/, 'no password field on the choice screen');

  // The email option leads to the actual email form.
  const form = await httpGet(`${formUrl}email`);
  assert.match(form.body, /name="email"/);
  assert.match(form.body, /name="password"/);

  const submit = await httpPost(formUrl, 'email=t%40t.com&password=TalentSeed123');
  assert.match(submit.body, /signed in/i);
  const result = await p;
  assert.deepEqual(result, { ok: true, email: 't@t.com' });
  assert.equal(saved.hubAccessToken, 'hub-jwt', 'dual-token session persisted');

  await assert.rejects(httpGet(formUrl), 'the ephemeral server is closed after success');
});

test('login loopback: method:email skips the choice screen and serves the email form at /', async () => {
  let formUrl = null;
  const deps = loginDeps();
  const p = runLoopbackAuth({ mode: 'login', deps, method: 'email' }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const form = await httpGet(formUrl);
  assert.match(form.body, /name="email"/, 'straight to the email form, no choice screen');
  assert.match(form.body, /name="password"/);
  assert.doesNotMatch(form.body, /href="google"/);
  await httpPost(formUrl, 'email=t%40t.com&password=TalentSeed123');
  await p;
});

test('login loopback: choosing Google (GET /google) resolves { viaSocial, provider:google } without running OAuth', async () => {
  let formUrl = null;
  const deps = loginDeps();
  const p = runLoopbackAuth({ mode: 'login', deps }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const handoff = await httpGet(`${formUrl}google`);
  assert.match(handoff.body, /Google/i, 'branded handoff page shown');
  const result = await p;
  assert.deepEqual(result, { ok: true, viaSocial: true, provider: 'google' });
});

test('login loopback: choosing LinkedIn (GET /linkedin) resolves { viaSocial, provider:linkedin } via the same device handoff', async () => {
  let formUrl = null;
  const deps = loginDeps();
  const p = runLoopbackAuth({ mode: 'login', deps }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const handoff = await httpGet(`${formUrl}linkedin`);
  assert.match(handoff.body, /LinkedIn/i, 'branded LinkedIn handoff page shown');
  const result = await p;
  assert.deepEqual(result, { ok: true, viaSocial: true, provider: 'linkedin' });
});

const REGISTER_FIELDS = { name: 'Ada', lastName: 'Lovelace', email: 'new@e.com', preferredLanguage: 'EN', freelanceType: 'FREELANCE' };

test('register loopback: / is the method-choice screen (email + Google); /email is the password-only form', async () => {
  let formUrl = null;
  const deps = loginDeps();
  const p = runLoopbackAuth({ mode: 'register', deps, lang: 'en', registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const choose = await httpGet(formUrl);
  assert.match(choose.body, /href="google\?legal=1"/, 'Google is now a register method');
  assert.match(choose.body, /href="email"/, 'Email option present');
  assert.match(choose.body, /Continue with email/, 'register email method does not imply typing email in the form');
  assert.doesNotMatch(choose.body, /Email and password/, 'register no longer claims the form collects email+password');
  assert.doesNotMatch(choose.body, /name="passwordConfirm"/, 'the sign-up form is not the first screen');

  const form = await httpGet(`${formUrl}email`);
  assert.match(form.body, /name="passwordConfirm"/, 'the password sign-up form');
  await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
  await p;
});

test('register loopback via /email: the form has ONLY password + repeat (no account fields); submit signs up with the chat-collected fields', async () => {
  let signedUp = null;
  let formUrl = null;
  const deps = loginDeps({ requestSignUp: async (fields) => { signedUp = fields; return { ok: true, accountExists: false }; } });
  const p = runLoopbackAuth({ mode: 'register', deps, lang: 'en', registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const form = await httpGet(`${formUrl}email`);
  assert.match(form.body, /name="password"/);
  assert.match(form.body, /name="passwordConfirm"/);
  assert.doesNotMatch(form.body, /name="freelanceType"/, 'freelanceType is a tool arg, not a form field');
  assert.doesNotMatch(form.body, /name="email"/, 'account fields are collected in chat, not the form');
  assert.doesNotMatch(form.body, /name="name"/, 'no name field on the form');

  await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
  const result = await p;
  assert.equal(result.ok, true);
  assert.equal(result.email, 'new@e.com', 'the session email comes from the chat-collected field');
  assert.equal(signedUp.email, 'new@e.com', 'signUp received the chat-collected email');
  assert.equal(signedUp.freelanceType, 'FREELANCE', 'signUp received the chat-collected freelanceType');
  assert.equal(signedUp.password, 'password123', 'signUp received the form password');
});

test('register loopback: choosing Google (GET /google) hands off viaSocial with no sub-form', async () => {
  let formUrl = null;
  const deps = loginDeps();
  const p = runLoopbackAuth({ mode: 'register', deps, lang: 'en', registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const handoff = await httpGet(`${formUrl}google?legal=1`);
  assert.match(handoff.body, /Google/i, 'branded handoff page shown');
  assert.doesNotMatch(handoff.body, /name="freelanceType"/, 'no freelanceType sub-form — it is a tool arg now');
  const result = await p;
  assert.deepEqual(result, { ok: true, viaSocial: true, provider: 'google' });
});

test('register loopback: a password mismatch re-renders the form and does NOT resolve', async () => {
  let formUrl = null;
  let resolved = false;
  const deps = loginDeps();
  const p = runLoopbackAuth({ mode: 'register', deps, registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  p.then(() => { resolved = true; });
  await tick();
  const submit = await httpPost(formUrl, 'password=password123&passwordConfirm=nope&legal=1');
  assert.match(submit.body, /name="password"/, 'form re-rendered on mismatch');
  await tick();
  assert.equal(resolved, false, 'a mismatch keeps the server open, does not resolve');
  // finish it cleanly so the server closes
  await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
  await p;
});

test('MCP sign-up window: asks only for the identity the AI did not know, and claims with the code current at submit time', async () => {
  let signedUp = null;
  let formUrl = null;
  let code = 'CODE-OLD';
  const deps = loginDeps({ requestSignUp: async (fields) => { signedUp = fields; return { ok: true, accountExists: false, claimed: true }; } });
  const p = runLoopbackAuth(
    { mode: 'register', deps, lang: 'en', registerFields: { name: 'Ada', lastName: 'Lovelace', claimCode: () => code } },
    { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } },
  );
  await tick();
  const form = await httpGet(`${formUrl}email`);
  assert.match(form.body, /name="email"[^>]*required autofocus/, 'the unknown email is asked, first');
  assert.doesNotMatch(form.body, /name="name"/, 'a known first name is not asked again');
  assert.doesNotMatch(form.body, /name="lastName"/, 'a known last name is not asked again');
  assert.doesNotMatch(form.body, /CODE-/, 'the claim code never reaches the page');

  code = 'CODE-NEW';
  await httpPost(formUrl, 'email=ada%40example.com&password=password123&passwordConfirm=password123&legal=1');
  const result = await p;
  assert.deepEqual(result, { ok: true, email: 'ada@example.com', accountExists: false, claimed: true });
  assert.equal(signedUp.email, 'ada@example.com');
  assert.equal(signedUp.name, 'Ada');
  assert.equal(signedUp.claimCode, 'CODE-NEW', 'the swapped code is the one claimed');
});

test('MCP sign-up window: with onGoogle the Google button redirects to the provider and hands back viaSocial', async () => {
  let formUrl = null;
  const p = runLoopbackAuth(
    { mode: 'register', deps: loginDeps(), lang: 'en', registerFields: { email: 'a@b.c', name: 'A', lastName: 'B', claimCode: 'C' } },
    { openBrowser: () => {}, onUrl: (u) => { formUrl = u; }, onGoogle: async () => ({ ok: true, url: 'https://works.test/cli-login?user_code=ABCD&provider=google' }) },
  );
  await tick();
  const res = await new Promise((resolve, reject) => {
    http.get(`${formUrl}google?legal=1`, (r) => { r.resume(); r.on('end', () => resolve(r)); }).on('error', reject);
  });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, 'https://works.test/cli-login?user_code=ABCD&provider=google');
  assert.deepEqual(await p, { ok: true, viaSocial: true, provider: 'google' });
});

test('MCP sign-up window: a Google start failure keeps the window open with the reason', async () => {
  let formUrl = null;
  let resolved = false;
  const p = runLoopbackAuth(
    { mode: 'register', deps: loginDeps(), lang: 'en', registerFields: { email: 'a@b.c', name: 'A', lastName: 'B' } },
    { openBrowser: () => {}, onUrl: (u) => { formUrl = u; }, onGoogle: async () => ({ ok: false, reason: 'authorize-failed' }) },
  );
  p.then(() => { resolved = true; });
  await tick();
  const page = await httpGet(`${formUrl}google?legal=1`);
  assert.match(page.body, /Something went wrong/);
  assert.doesNotMatch(page.body, /authorize-failed/, 'internal reasons never reach the talent');
  await tick();
  assert.equal(resolved, false);
  await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
  await p;
});

test('MCP sign-up window: the web sign-up\'s legal text and links sit under every way to create the account', async () => {
  for (const [lang, text, terms, privacy] of [
    ['es', 'Al continuar, aceptas los', 'https://www.shakersworks.com/condiciones-generales', 'https://www.shakersworks.com/politica-de-privacidad'],
    ['en', 'By continuing, you accept the', 'https://www.shakersworks.com/en/condiciones-generales', 'https://www.shakersworks.com/en/politica-de-privacidad'],
    ['it', 'Continuando, accetti i', 'https://www.shakersworks.com/it/condiciones-generales', 'https://www.shakersworks.com/it/politica-de-privacidad'],
    ['pt', 'Ao continuar, aceita os', 'https://www.shakersworks.com/pt/condiciones-generales', 'https://www.shakersworks.com/pt/politica-de-privacidad'],
  ]) {
    let formUrl = null;
    const p = runLoopbackAuth({ mode: 'register', deps: loginDeps(), lang, registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
    await tick();
    for (const page of [await httpGet(formUrl), await httpGet(`${formUrl}email`)]) {
      assert.ok(page.body.includes(text), `${lang}: legal text`);
      assert.ok(page.body.includes(`href="${terms}"`) && page.body.includes(`href="${privacy}"`), `${lang}: both links`);
    }
    assert.match((await httpGet(formUrl)).body, /href="google\?legal=1"/);
    await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
    await p;
  }
});

test('MCP sign-up window: no account is created from a submit or a Google start that did not come with the legal text', async () => {
  let signUps = 0;
  let googleStarts = 0;
  let formUrl = null;
  let resolved = false;
  const p = runLoopbackAuth(
    { mode: 'register', deps: loginDeps({ requestSignUp: async () => { signUps += 1; return { ok: true, accountExists: false }; } }), lang: 'es', registerFields: REGISTER_FIELDS },
    { openBrowser: () => {}, onUrl: (u) => { formUrl = u; }, onGoogle: async () => { googleStarts += 1; return { ok: true, url: 'https://works.test/x' }; } },
  );
  p.then(() => { resolved = true; });
  await tick();
  const bare = await httpPost(formUrl, 'password=password123&passwordConfirm=password123');
  assert.match(bare.body, /name="passwordConfirm"/, 'the form comes back');
  const google = await httpGet(`${formUrl}google`);
  assert.match(google.body, /Al continuar, aceptas/);
  await tick();
  assert.equal(signUps, 0);
  assert.equal(googleStarts, 0);
  assert.equal(resolved, false);
  await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
  await p;
  assert.equal(signUps, 1);
});

test('MCP sign-up window: the web\'s optional newsletter checkbox, unchecked by default, reaches the sign-up', async () => {
  const seen = [];
  for (const body of ['password=password123&passwordConfirm=password123&legal=1', 'password=password123&passwordConfirm=password123&legal=1&newsletterConsent=on']) {
    let formUrl = null;
    const p = runLoopbackAuth({ mode: 'register', deps: loginDeps({ requestSignUp: async (f) => { seen.push(f.newsletterConsent); return { ok: true, accountExists: false }; } }), lang: 'es', registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
    await tick();
    const form = await httpGet(`${formUrl}email`);
    assert.match(form.body, /<input type="checkbox" name="newsletterConsent">\s*Quiero recibir contenido sobre el futuro del trabajo/);
    await httpPost(formUrl, body);
    await p;
  }
  assert.deepEqual(seen, [false, true]);
});

test('MCP sign-up window: Google then email, once each, LinkedIn not offered, and no MCP label anywhere', async () => {
  let formUrl = null;
  const p = runLoopbackAuth({ mode: 'register', deps: loginDeps(), lang: 'es', registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const choose = (await httpGet(formUrl)).body;
  assert.equal(choose.match(/Continuar con email/g).length, 1, 'one email button');
  assert.equal(choose.match(/Continuar con Google/g).length, 1);
  assert.ok(choose.indexOf('Continuar con Google') < choose.indexOf('Continuar con email'), 'Google first');
  assert.doesNotMatch(choose, /linkedin/i);
  for (const page of [choose, (await httpGet(`${formUrl}email`)).body]) assert.doesNotMatch(page, />MCP</);
  assert.match((await httpGet(`${formUrl}email`)).body, /Tu contraseña se queda en este equipo. Nunca se envía al chat./);
  await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
  await p;
});

test('MCP sign-up window: errors are sentences in the talent\'s language, never internal reasons', async () => {
  let formUrl = null;
  const p = runLoopbackAuth({ mode: 'register', deps: loginDeps(), lang: 'it', registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const weak = await httpPost(formUrl, 'password=short&passwordConfirm=short&legal=1');
  assert.match(weak.body, /La password deve avere almeno 8 caratteri/);
  assert.doesNotMatch(weak.body, /weak-password/);
  await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
  await p;
});

test('MCP sign-up window: an email that already has an account asks the talent to sign in instead, and signing in finishes as an existing account', async () => {
  let formUrl = null;
  let signedUp = 0;
  const logins = [];
  const deps = loginDeps({
    requestSignUp: async () => { signedUp += 1; return { ok: true, accountExists: true }; },
    requestLogin: async ({ email, password }) => { logins.push(password); return password === 'right-pass' ? { ok: true, accessToken: 't', hubAccessToken: 'h', email } : { ok: false, reason: 'invalid-credentials', status: 401 }; },
  });
  const p = runLoopbackAuth({ mode: 'register', deps, lang: 'es', registerFields: { ...REGISTER_FIELDS, email: 'ada@gmail.com' } }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; } });
  await tick();
  const exists = await httpPost(formUrl, 'password=password123&passwordConfirm=password123&legal=1');
  assert.match(exists.body, /Ya tienes una cuenta en Shakers con este email. Entra con tu contraseña o con Google./);
  assert.match(exists.body, /name="intent" value="login"/);
  assert.match(exists.body, /value="ada@gmail.com"/);
  assert.match(exists.body, /href="google\?legal=1"/);
  const wrong = await httpPost(formUrl, 'intent=login&email=ada%40gmail.com&password=nope');
  assert.match(wrong.body, /Email o contraseña incorrectos/);
  await httpPost(formUrl, 'intent=login&email=ada%40gmail.com&password=right-pass');
  assert.deepEqual(await p, { ok: true, email: 'ada@gmail.com', accountExists: true });
  assert.equal(signedUp, 1, 'no second account attempt');
  assert.deepEqual(logins, ['password123', 'nope', 'right-pass']);
});

// Security: a web page in the talent's browser, or a DNS-rebound host, must not drive the window.
function rawRequest(port, { method = 'GET', path = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body !== null) { h['Content-Type'] = 'application/x-www-form-urlencoded'; h['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: h }, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => resolve({ status: r.statusCode, body: d, headers: r.headers })); });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function openRegisterWindow() {
  const calls = [];
  let formUrl = null;
  const deps = loginDeps({ requestSignUp: async (f) => { calls.push(f); return { ok: true, accountExists: false }; } });
  const done = runLoopbackAuth({ mode: 'register', deps, lang: 'en', registerFields: REGISTER_FIELDS }, { openBrowser: () => {}, onUrl: (u) => { formUrl = u; }, timeoutMs: 5000 });
  await tick();
  const u = new URL(formUrl);
  return { calls, done, formUrl, port: Number(u.port), base: u.pathname, own: `http://127.0.0.1:${u.port}` };
}

const SIGNUP_BODY = 'password=attacker123&passwordConfirm=attacker123&legal=1';

test('security: the window URL carries an unguessable per-window path, and nothing answers outside it', async () => {
  const w = await openRegisterWindow();
  const secret = w.base.split('/').filter(Boolean)[0] || '';
  assert.ok(secret.length >= 22, `at least 128 bits in the path: ${w.formUrl}`);
  const other = await openRegisterWindow();
  assert.notEqual(other.base, w.base, 'a new window, a new secret');
  for (const path of ['/', '/email', '/google?legal=1', '/linkedin']) {
    assert.equal((await rawRequest(w.port, { path, headers: { Host: `127.0.0.1:${w.port}` } })).status, 404, path);
  }
  const blind = await rawRequest(w.port, { method: 'POST', path: '/submit', headers: { Host: `127.0.0.1:${w.port}` }, body: SIGNUP_BODY });
  assert.equal(blind.status, 404);
  assert.equal(w.calls.length, 0, 'no account created without the secret');
  for (const x of [w, other]) await rawRequest(x.port, { method: 'POST', path: `${x.base}submit`, headers: { Host: `127.0.0.1:${x.port}`, Origin: x.own }, body: 'password=password123&passwordConfirm=password123&legal=1' });
  await Promise.all([w.done, other.done]);
});

test('security: a request with a foreign Host (DNS rebinding) is refused with 403, GET and POST', async () => {
  const w = await openRegisterWindow();
  const get = await rawRequest(w.port, { path: w.base, headers: { Host: 'evil.example' } });
  assert.equal(get.status, 403);
  assert.doesNotMatch(get.body, /passwordConfirm|Continue with/);
  const post = await rawRequest(w.port, { method: 'POST', path: `${w.base}submit`, headers: { Host: `evil.example:${w.port}`, Origin: 'https://evil.example' }, body: SIGNUP_BODY });
  assert.equal(post.status, 403);
  assert.equal(w.calls.length, 0);
  assert.equal((await rawRequest(w.port, { path: w.base, headers: { Host: `localhost:${w.port}` } })).status, 200, 'localhost:<port> is the same window');
  await rawRequest(w.port, { method: 'POST', path: `${w.base}submit`, headers: { Host: `127.0.0.1:${w.port}`, Origin: w.own }, body: SIGNUP_BODY });
  await w.done;
});

test('security: a POST from another origin or another site is refused with 403 and reaches no sign-up', async () => {
  const w = await openRegisterWindow();
  const host = { Host: `127.0.0.1:${w.port}` };
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: `http://127.0.0.1:${w.port + 1}` }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { Origin: w.own, 'Sec-Fetch-Site': 'none' }]) {
    const r = await rawRequest(w.port, { method: 'POST', path: `${w.base}submit`, headers: { ...host, ...headers }, body: SIGNUP_BODY });
    assert.equal(r.status, 403, JSON.stringify(headers));
  }
  assert.equal(w.calls.length, 0);
  const ok = await rawRequest(w.port, { method: 'POST', path: `${w.base}submit`, headers: { ...host, Origin: w.own, 'Sec-Fetch-Site': 'same-origin' }, body: 'password=password123&passwordConfirm=password123&legal=1' });
  assert.equal(ok.status, 200);
  assert.equal(w.calls.length, 1, 'the window\'s own form still signs up');
  assert.equal((await w.done).ok, true);
});

test('security: every page links inside the window path, so the real browser flow keeps working', async () => {
  const w = await openRegisterWindow();
  const choose = await rawRequest(w.port, { path: w.base, headers: { Host: `127.0.0.1:${w.port}` } });
  assert.doesNotMatch(choose.body, /href="\/|action="\//, 'no absolute link leaves the secret path');
  const form = await rawRequest(w.port, { path: `${w.base}email`, headers: { Host: `127.0.0.1:${w.port}` } });
  assert.equal(form.status, 200);
  assert.match(form.body, /action="submit"/);
  await rawRequest(w.port, { method: 'POST', path: `${w.base}submit`, headers: { Host: `127.0.0.1:${w.port}`, Origin: w.own }, body: 'password=password123&passwordConfirm=password123&legal=1' });
  await w.done;
});
