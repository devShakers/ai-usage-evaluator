'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const client = require('../src/onboarding-client');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        handler(req, res, raw);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

function ok(res, data) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'OK', data }));
}

test('requestImportProfile: POSTs sources to hub with Bearer hub JWT (no X-Hub-Token), returns the synchronous import report', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res, raw) => {
    seen.method = req.method;
    seen.auth = req.headers.authorization;
    seen.hub = req.headers['x-hub-token'];
    seen.body = JSON.parse(raw);
    ok(res, { talentId: 't-1', importReport: { outcome: 'partial', traceId: 'x', sources: [{ source: 'linkedin', status: 'failed', code: 'source.linkedin_unavailable', retryable: true, provider: 'p' }, { source: 'github', status: 'imported' }] } });
  });
  const r = await client.requestImportProfile(
    { linkedinUrl: 'https://linkedin/in/me', githubUrl: 'https://gh/me', language: 'ES', accessToken: 'tok', hubAccessToken: 'hubjwt' },
    { endpoint: `${base}/works/me/import-profile` },
  );
  server.close();
  assert.equal(seen.method, 'POST');
  assert.equal(seen.auth, 'Bearer hubjwt');
  assert.equal(seen.hub, undefined);
  assert.equal(seen.body.linkedinUrl, 'https://linkedin/in/me');
  assert.equal(seen.body.language, 'es', 'language is required, lowercased to the hub enum');
  assert.equal('fillEmptyOnly' in seen.body, false, 'overwrite stays the default');
  assert.deepEqual(r, { ok: true, report: { outcome: 'partial', sources: [{ source: 'linkedin', status: 'failed', code: 'source.linkedin_unavailable', retryable: true }, { source: 'github', status: 'imported' }] } });
});

test('requestImportProfile: fillEmptyOnly and userQuery reach hub in JSON, and without LinkedIn when another source is given', async () => {
  let body = null;
  const { server, base } = await startServer((req, res, raw) => { body = JSON.parse(raw); ok(res, { talentId: 't', importReport: null }); });
  const r = await client.requestImportProfile({ websiteUrl: 'https://me.dev', userQuery: 'Senior data engineer', fillEmptyOnly: true, hubAccessToken: 'h' }, { endpoint: `${base}/i` });
  server.close();
  assert.deepEqual(body, { language: 'en', websiteUrl: 'https://me.dev', userQuery: 'Senior data engineer', fillEmptyOnly: true });
  assert.deepEqual(r, { ok: true, report: null });
});

test('requestImportProfile: language defaults to en and rejects out-of-enum values', async () => {
  let body = null;
  const { server, base } = await startServer((req, res, raw) => { body = JSON.parse(raw); ok(res, { jobId: 'j', state: 'running' }); });
  await client.requestImportProfile({ linkedinUrl: 'x', hubAccessToken: 'h' }, { endpoint: `${base}/i` });
  const firstDefault = body.language;
  await client.requestImportProfile({ linkedinUrl: 'x', language: 'de', hubAccessToken: 'h' }, { endpoint: `${base}/i` });
  server.close();
  assert.equal(firstDefault, 'en');
  assert.equal(body.language, 'en', 'an unsupported language falls back to en');
});

test('requestImportProfile: local guards fire before any request', async () => {
  assert.equal((await client.requestImportProfile({}, { endpoint: 'x' })).reason, 'no-source');
  assert.equal((await client.requestImportProfile({ linkedinUrl: 'x' }, { endpoint: 'y' })).reason, 'no-hub-token');
  assert.equal((await client.requestImportProfile({ linkedinUrl: 'x', hubAccessToken: 'h' }, {})).reason, 'no-endpoint');
});

test('requestSetProfessionalDetails: PATCH with currentEmploymentStatus + freelanceIntent + changeMotivators (ADR-036)', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res, raw) => { seen.method = req.method; seen.body = JSON.parse(raw); ok(res, {}); });
  const r = await client.requestSetProfessionalDetails(
    { currentEmploymentStatus: 'IN_HOUSE_FULL_TIME', freelanceIntent: 'OPEN_TO_FREELANCE', changeMotivators: 'FLEXIBILITY', accessToken: 't', hubAccessToken: 'h' },
    { endpoint: `${base}/works/me/professional-details` },
  );
  server.close();
  assert.equal(seen.method, 'PATCH');
  assert.deepEqual(seen.body, { currentEmploymentStatus: 'IN_HOUSE_FULL_TIME', freelanceIntent: 'OPEN_TO_FREELANCE', changeMotivators: 'FLEXIBILITY' });
  assert.equal(r.ok, true);
});

test('requestSetPricingRate: PUT sends the fat upsert body verbatim', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res, raw) => { seen.method = req.method; seen.body = JSON.parse(raw); ok(res, {}); });
  const pricing = {
    fullTimeProjectSelected: true,
    fullTimeProjectPrice: { amount: 5000, currency: 'EUR' },
    partTimeProjectSelected: false,
    partTimeProjectPrice: { amount: 0, currency: 'EUR' },
  };
  const r = await client.requestSetPricingRate({ pricing, accessToken: 't', hubAccessToken: 'h' }, { endpoint: `${base}/works/talents/me/work-details/pricing-rate` });
  server.close();
  assert.equal(seen.method, 'PUT');
  assert.deepEqual(seen.body, pricing);
  assert.equal(r.ok, true);
});

test('onboarding interview: create -> start -> turn -> complete over the interviews base', async () => {
  const paths = [];
  const { server, base } = await startServer((req, res, raw) => {
    paths.push(`${req.method} ${req.url}`);
    if (req.url.endsWith('/onboarding')) return ok(res, { interviewId: 'iv-9', created: true, language: 'es' });
    if (req.url.endsWith('/text-session')) return ok(res, { interviewId: 'iv-9', greeting: 'hola' });
    if (req.url.endsWith('/turns')) return ok(res, { response: JSON.parse(raw).message === 'end' ? 'bye' : 'next', ended: JSON.parse(raw).message === 'end' });
    if (req.url.endsWith('/complete')) return ok(res, { state: 'taken' });
    res.writeHead(404); res.end();
  });
  const b = `${base}/interviews`;
  const created = await client.requestCreateOnboardingInterview({ candidateId: 't@t.com', accessToken: 't' }, { base: b });
  assert.deepEqual(created, { ok: true, interviewId: 'iv-9', created: true, language: 'es' });
  const started = await client.requestStartTextSession({ interviewId: 'iv-9', language: 'es', accessToken: 't' }, { base: b });
  assert.equal(started.greeting, 'hola');
  const t1 = await client.requestOnboardingTurn({ interviewId: 'iv-9', message: 'hi', accessToken: 't' }, { base: b });
  assert.deepEqual(t1, { ok: true, response: 'next', ended: false });
  const t2 = await client.requestOnboardingTurn({ interviewId: 'iv-9', message: 'end', accessToken: 't' }, { base: b });
  assert.equal(t2.ended, true);
  const done = await client.requestCompleteTextSession({ interviewId: 'iv-9', accessToken: 't' }, { base: b });
  server.close();
  assert.deepEqual(done, { ok: true, state: 'taken' });
  assert.deepEqual(paths, [
    'POST /interviews/onboarding',
    'POST /interviews/iv-9/text-session',
    'POST /interviews/iv-9/text-session/turns',
    'POST /interviews/iv-9/text-session/turns',
    'POST /interviews/iv-9/text-session/complete',
  ]);
});

test('requestCompleteOnboarding: POST to hub with Bearer hub JWT, echoes status defensively', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res) => {
    seen.method = req.method;
    seen.auth = req.headers.authorization;
    seen.hub = req.headers['x-hub-token'];
    ok(res, { onboardingStatus: 'COMPLETED', registrationLevel: 'ONBOARDING_COMPLETED', completedProfilePercentage: 75 });
  });
  const r = await client.requestCompleteOnboarding({ accessToken: 't', hubAccessToken: 'hubjwt' }, { endpoint: `${base}/works/talents/me/complete-onboarding` });
  server.close();
  assert.equal(seen.method, 'POST');
  assert.equal(seen.auth, 'Bearer hubjwt');
  assert.equal(seen.hub, undefined);
  assert.deepEqual(r, { ok: true, onboardingStatus: 'COMPLETED', registrationLevel: 'ONBOARDING_COMPLETED', completedProfilePercentage: 75 });
});

test('requestCompleteOnboarding: 2xx with no echoed status still succeeds (shape is a seam)', async () => {
  const { server, base } = await startServer((req, res) => ok(res, {}));
  const r = await client.requestCompleteOnboarding({ accessToken: 't', hubAccessToken: 'h' }, { endpoint: `${base}/x` });
  server.close();
  assert.deepEqual(r, { ok: true, onboardingStatus: null, registrationLevel: null, completedProfilePercentage: null });
});

test('requestCompleteOnboarding: a precondition non-2xx becomes a named reason, no crash', async () => {
  const { server, base } = await startServer((req, res) => { res.writeHead(422); res.end(JSON.stringify({ status: 'KO', code: 'works.profile_incomplete' })); });
  const r = await client.requestCompleteOnboarding({ accessToken: 't', hubAccessToken: 'h' }, { endpoint: `${base}/x` });
  server.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http-422');
});

test('requestCompleteOnboarding: no hub token guards before any request', async () => {
  assert.equal((await client.requestCompleteOnboarding({ accessToken: 't' }, { endpoint: 'x' })).reason, 'no-hub-token');
});

test('language casing matrix: import sends lowercase, text-session sends UPPERCASE', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res, raw) => {
    seen[req.url] = raw ? JSON.parse(raw) : {};
    if (req.url.endsWith('/import-profile')) return ok(res, { talentId: 't' });
    ok(res, { interviewId: 'iv', greeting: 'hola' });
  });
  await client.requestImportProfile({ linkedinUrl: 'x', language: 'ES', hubAccessToken: 'h' }, { endpoint: `${base}/import-profile` });
  await client.requestStartTextSession({ interviewId: 'iv', language: 'es', accessToken: 't' }, { base: `${base}/interviews` });
  server.close();
  assert.equal(seen['/import-profile'].language, 'es', 'import wants lowercase');
  assert.equal(seen['/interviews/iv/text-session'].language, 'ES', 'text-session wants UPPERCASE');
});

test('a non-2xx maps to a named reason, never a mute failure', async () => {
  const { server, base } = await startServer((req, res) => { res.writeHead(500); res.end(JSON.stringify({ status: 'KO' })); });
  const r = await client.requestSetPricingRate({ pricing: {}, accessToken: 't', hubAccessToken: 'h' }, { endpoint: `${base}/x` });
  server.close();
  assert.equal(r.reason, 'http-500');
});

test('requestImportProfile: with a CV, uploads the FILE as multipart `cv` (hub never gets a local path)', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-up-'));
  const cvPath = path.join(dir, 'cv.pdf');
  fs.writeFileSync(cvPath, '%PDF-1.4 fake cv');
  const seen = {};
  const { server, base } = await startServer((req, res, raw) => {
    seen.type = req.headers['content-type'];
    seen.auth = req.headers.authorization;
    seen.raw = raw;
    ok(res, { talentId: 't', importReport: null });
  });
  const r = await client.requestImportProfile(
    { linkedinUrl: 'https://linkedin/in/me', cvPath, language: 'ES', fillEmptyOnly: true, hubAccessToken: 'hubjwt' },
    { endpoint: `${base}/works/me/import-profile` },
  );
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(seen.type, /^multipart\/form-data; boundary=/);
  assert.equal(seen.auth, 'Bearer hubjwt');
  assert.match(seen.raw, /name="cv"; filename="cv.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1.4 fake cv\r\n/);
  assert.match(seen.raw, /name="linkedinUrl"\r\n\r\nhttps:\/\/linkedin\/in\/me\r\n/);
  assert.match(seen.raw, /name="language"\r\n\r\nes\r\n/);
  assert.match(seen.raw, /name="fillEmptyOnly"\r\n\r\ntrue\r\n/, 'multipart sends the flag as the string hub transforms');
  assert.equal(seen.raw.includes('cvPath'), false, 'the local path never reaches hub');
  assert.deepEqual(r, { ok: true, report: null });
});

test('requestImportProfile: a missing or unsupported CV fails locally, before any request', async () => {
  let hits = 0;
  const { server, base } = await startServer((req, res) => { hits += 1; ok(res, {}); });
  const missing = await client.requestImportProfile({ linkedinUrl: 'x', cvPath: '/nope/cv.pdf', hubAccessToken: 'h' }, { endpoint: `${base}/i` });
  const badFormat = await client.requestImportProfile({ linkedinUrl: 'x', cvPath: '/tmp/cv.txt', hubAccessToken: 'h' }, { endpoint: `${base}/i` });
  server.close();
  assert.equal(missing.reason, 'cv-not-found');
  assert.equal(badFormat.reason, 'cv-bad-format');
  assert.equal(hits, 0);
});
