'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { buildResolveRequest, requestResolve, normalizeResolveResponse, classifyCertifyFailure } = require('../src/certify-client');

/*
 * skill-code-certification, issue 004: the RESOLVE client. Unlike
 * agent-synthesis (which swallows every failure to null and silently falls
 * back to the deterministic org chart), this returns a DISCRIMINATED result
 * so the CLI can INFORM the talent — there is no deterministic fallback for
 * certification (ADR-001). It must never hang, never throw, never invent a
 * result.
 */

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function serverUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/works/ai-footprint/skill-certification`;
}

// --- buildResolveRequest -----------------------------------------------------

test('buildResolveRequest: shapes {email, technologies[]}, filters non-strings', () => {
  const body = buildResolveRequest('a@b.com', ['React', 'NestJS', 42, null, '']);
  assert.deepEqual(body, { email: 'a@b.com', technologies: ['React', 'NestJS'] });
});

test('buildResolveRequest: non-array technologies -> empty array', () => {
  assert.deepEqual(buildResolveRequest('a@b.com', undefined).technologies, []);
});

// --- normalizeResolveResponse ------------------------------------------------

test('normalizeResolveResponse: rebuilds fields, defaults nonCertifiable to []', () => {
  const out = normalizeResolveResponse({
    certifiable: [{ skillId: 7, skillName: 'React', technology: 'React', sneaky: 'x' }],
  });
  assert.deepEqual(out, {
    certifiable: [{ skillId: 7, skillName: 'React', technology: 'React' }],
    nonCertifiable: [],
  });
});

test('normalizeResolveResponse (ADR-027): no longer surfaces an authorizedAuthoring field, even if the server sends one', () => {
  const out = normalizeResolveResponse({
    certifiable: [],
    authorizedAuthoring: { domain: 'shakersworks.com', extraEmails: ['c@x.com'] },
  });
  assert.equal('authorizedAuthoring' in out, false);
});

test('normalizeResolveResponse: missing certifiable[] -> null (invalid shape)', () => {
  assert.equal(normalizeResolveResponse({ nope: true }), null);
  assert.equal(normalizeResolveResponse(null), null);
});

// --- certifyTimeoutForItems: scales with Skill count -------------------------

test('certifyTimeoutForItems: floors at the single-Skill default and scales per Skill', () => {
  const { certifyTimeoutForItems, DEFAULT_CERTIFY_TIMEOUT_MS, PER_SKILL_CERTIFY_TIMEOUT_MS } =
    require('../src/certify-client');
  // 1 Skill → max(default, 1×perSkill) = perSkill (>= default).
  assert.equal(certifyTimeoutForItems(1), Math.max(DEFAULT_CERTIFY_TIMEOUT_MS, PER_SKILL_CERTIFY_TIMEOUT_MS));
  // 2 Skills (the reported failure: ~106s > the old flat 90s) → 2×perSkill.
  assert.equal(certifyTimeoutForItems(2), 2 * PER_SKILL_CERTIFY_TIMEOUT_MS);
  assert.ok(certifyTimeoutForItems(2) > 106000, 'covers a real 2-Skill (~106s) run');
  // Defensive: 0/negative/NaN → single-Skill floor.
  assert.equal(certifyTimeoutForItems(0), Math.max(DEFAULT_CERTIFY_TIMEOUT_MS, PER_SKILL_CERTIFY_TIMEOUT_MS));
  assert.equal(certifyTimeoutForItems(NaN), Math.max(DEFAULT_CERTIFY_TIMEOUT_MS, PER_SKILL_CERTIFY_TIMEOUT_MS));
});

// --- classifyCertifyFailure (issue 014) --------------------------------------

test('classifyCertifyFailure: 403 -> gate, 413 -> too-large, 5xx -> backend-unavailable, everything else -> technical', () => {
  assert.equal(classifyCertifyFailure('http-403'), 'gate');
  assert.equal(classifyCertifyFailure('http-413'), 'too-large');
  // Missing-migrations bugfix: any 5xx is the SERVER, not the connection.
  for (const r of ['http-500', 'http-502', 'http-503', 'http-504']) {
    assert.equal(classifyCertifyFailure(r), 'backend-unavailable', `${r} should be backend-unavailable`);
  }
  // 4xx (other than the gate/too-large specials) and transport failures stay technical.
  for (const r of ['http-429', 'http-400', 'http-404', 'network-error', 'timeout', 'invalid-json', 'invalid-shape', 'no-endpoint']) {
    assert.equal(classifyCertifyFailure(r), 'technical', `${r} should be technical`);
  }
});

// --- requestResolve: happy path + every failure mode -------------------------

const REQUEST = { email: 'a@b.com', technologies: ['React'] };

test('requestResolve: happy path returns {ok:true, result}', async () => {
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        certifiable: [{ skillId: 1, skillName: 'React', technology: 'React' }],
        nonCertifiable: [{ technology: 'Express', reason: 'not-declared' }],
      }));
    });
  });
  try {
    const out = await requestResolve(REQUEST, { endpoint: serverUrl(server) });
    assert.equal(out.ok, true);
    assert.equal(out.result.certifiable[0].skillName, 'React');
    assert.equal(out.result.nonCertifiable[0].reason, 'not-declared');
  } finally {
    server.close();
  }
});

test('requestResolve: no endpoint -> {ok:false, reason:"no-endpoint"} (never sends)', async () => {
  const out = await requestResolve(REQUEST, { endpoint: null });
  assert.deepEqual(out, { ok: false, reason: 'no-endpoint' });
});

test('requestResolve: network error -> {ok:false, reason:"network-error"}, never throws', async () => {
  const out = await requestResolve(REQUEST, { endpoint: 'http://127.0.0.1:1/works/ai-footprint/skill-certification' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'network-error');
});

test('requestResolve: non-2xx -> {ok:false, reason:"http-<status>"}', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(403); res.end(JSON.stringify({ error: 'not a talent' })); });
  });
  try {
    const out = await requestResolve(REQUEST, { endpoint: serverUrl(server) });
    assert.deepEqual(out, { ok: false, reason: 'http-403' });
  } finally {
    server.close();
  }
});

test('requestResolve: malformed (non-JSON) body -> {ok:false, reason:"invalid-json"}', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200); res.end('not json {{{'); });
  });
  try {
    const out = await requestResolve(REQUEST, { endpoint: serverUrl(server) });
    assert.deepEqual(out, { ok: false, reason: 'invalid-json' });
  } finally {
    server.close();
  }
});

test('requestResolve: valid JSON, wrong shape -> {ok:false, reason:"invalid-shape"}', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200); res.end(JSON.stringify({ oops: true })); });
  });
  try {
    const out = await requestResolve(REQUEST, { endpoint: serverUrl(server) });
    assert.deepEqual(out, { ok: false, reason: 'invalid-shape' });
  } finally {
    server.close();
  }
});

test('requestResolve: timeout -> {ok:false, reason:"timeout"} (never hangs)', async () => {
  const server = await startServer(() => { /* never responds */ });
  try {
    const out = await requestResolve(REQUEST, { endpoint: serverUrl(server), timeoutMs: 50 });
    assert.deepEqual(out, { ok: false, reason: 'timeout' });
  } finally {
    server.close();
  }
});

test('requestResolve: sends exactly {email, technologies[]} on the wire', async () => {
  let received;
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received = JSON.parse(raw);
      res.writeHead(200); res.end(JSON.stringify({ certifiable: [] }));
    });
  });
  try {
    await requestResolve(buildResolveRequest('a@b.com', ['React']), { endpoint: serverUrl(server) });
    assert.deepEqual(received, { email: 'a@b.com', technologies: ['React'] });
  } finally {
    server.close();
  }
});
