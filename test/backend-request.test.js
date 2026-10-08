'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  postJsonWithTimeout,
  requestBackend,
  extractSetCookie,
} = require('../src/backend-request');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function urlOf(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/route`;
}

function jsonHandler(status, body) {
  return (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  };
}

// A handler that records whether it was ever hit, for asserting the fallback
// was NEVER called (the 4xx-never-falls-back rule).
function spyHandler(status, body) {
  const calls = [];
  const handler = (req, res) => {
    calls.push(1);
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  };
  return { handler, calls };
}

/* ---------- requestBackend: a response is a response ---------- */

test('requestBackend: a 2xx resolves with {backend, status, raw}', async () => {
  const server = await startServer(jsonHandler(201, { ok: true }));
  try {
    const res = await requestBackend({ endpoint: urlOf(server), body: { a: 1 }, timeoutMs: 2000 });
    assert.equal(res.status, 201);
    assert.equal(JSON.parse(res.raw).ok, true);
    // Still `'primary'`, now a constant — kept because these results are
    // persisted and the shape must match records already on talents' machines.
    assert.equal(res.backend, 'primary');
  } finally {
    server.close();
  }
});

test('requestBackend: a 4xx business rejection is returned AS-IS, never retried', async () => {
  // The old chain's single most important invariant survives the retirement for free: with one backend there is nowhere to retry to.
  const { handler, calls } = spyHandler(422, { message: 'nope' });
  const server = await startServer(handler);
  try {
    const res = await requestBackend({ endpoint: urlOf(server), body: {}, timeoutMs: 2000 });
    assert.equal(res.status, 422);
    assert.equal(calls.length, 1, 'the backend must be called exactly once');
  } finally {
    server.close();
  }
});

test('requestBackend: a 5xx is ALSO returned as a status, not thrown — the caller decides', async () => {
  // Under the chain a 5xx was a fallback trigger and the talent ended up seeing
  // hub's 404. Now it comes back as a 5xx and the caller reports a 5xx.
  const { handler, calls } = spyHandler(503, { message: 'down' });
  const server = await startServer(handler);
  try {
    const res = await requestBackend({ endpoint: urlOf(server), body: {}, timeoutMs: 2000 });
    assert.equal(res.status, 503);
    assert.equal(calls.length, 1);
  } finally {
    server.close();
  }
});

test('requestBackend: a 404 is returned as 404 — it is no longer a trigger for anything', async () => {
  const { handler, calls } = spyHandler(404, { message: 'no route' });
  const server = await startServer(handler);
  try {
    const res = await requestBackend({ endpoint: urlOf(server), body: {}, timeoutMs: 2000 });
    assert.equal(res.status, 404);
    assert.equal(calls.length, 1);
  } finally {
    server.close();
  }
});

/* ---------- requestBackend: the three real causes, told apart ---------- */

test('requestBackend: THE POINT OF ADR-042 — timeout, connection refused and invalid URL are reported DISTINCTLY', async () => {
  // Under the two-backend chain all three of these ended as the dead fallback's instant `404`, because `requestChain` surfaced the LAST hop's outcome.
  const slow = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { /* never answers */ });
  });
  try {
    const causes = {};

    await assert.rejects(
      () => requestBackend({ endpoint: urlOf(slow), body: {}, timeoutMs: 120 }),
      (e) => { causes.timeout = e.kind; return e.kind === 'timeout'; },
    );
    // Port 1 is privileged/closed: connection refused, immediately.
    await assert.rejects(
      () => requestBackend({ endpoint: 'http://127.0.0.1:1/route', body: {}, timeoutMs: 2000 }),
      (e) => { causes.refused = e.kind; return e.kind === 'network-error'; },
    );
    await assert.rejects(
      () => requestBackend({ endpoint: 'not-a-url', body: {}, timeoutMs: 2000 }),
      (e) => { causes.badUrl = e.kind; return e.kind === 'invalid-url'; },
    );

    assert.deepEqual(causes, { timeout: 'timeout', refused: 'network-error', badUrl: 'invalid-url' });
    // The assertion that carries the weight: three causes, three distinct labels.
    assert.equal(new Set(Object.values(causes)).size, 3);
  } finally {
    slow.close();
  }
});

test('requestBackend: no endpoint rejects with kind "no-endpoint" and never touches the network', async () => {
  for (const endpoint of [undefined, null, '']) {
    await assert.rejects(
      () => requestBackend({ endpoint, body: {}, timeoutMs: 1000 }),
      (e) => e.kind === 'no-endpoint',
    );
  }
});

/* ---------- the trace ---------- */

test('requestBackend: the trace records ONE entry, and names the cause on failure', async () => {
  // `hops[]` outlives the chain because records already persisted on talents' machines contain two entries — see model-call-record.js's header.
  const ok = await startServer(jsonHandler(200, { ok: true }));
  try {
    const okTrace = [];
    await requestBackend({ endpoint: urlOf(ok), body: {}, timeoutMs: 2000, trace: okTrace });
    assert.deepEqual(okTrace, [{ backend: 'primary', status: 200, kind: null }]);

    const failTrace = [];
    await assert.rejects(() => requestBackend({
      endpoint: 'http://127.0.0.1:1/route', body: {}, timeoutMs: 2000, trace: failTrace,
    }));
    assert.deepEqual(failTrace, [{ backend: 'primary', status: null, kind: 'network-error' }]);
    // NEVER a URL: a trace can be persisted, and the endpoint is configuration,
    // not evidence.
    assert.equal(JSON.stringify(failTrace).includes('127.0.0.1'), false);
  } finally {
    ok.close();
  }
});

test('requestBackend: forwards idempotencyKey, and sends no such header without one', async () => {
  const sink = [];
  const server = await startServer(capturingHandler(200, { ok: true }, sink));
  try {
    await requestBackend({ endpoint: urlOf(server), body: {}, timeoutMs: 2000, idempotencyKey: 'key-abc' });
    await requestBackend({ endpoint: urlOf(server), body: {}, timeoutMs: 2000 });
    assert.deepEqual(sink, ['key-abc', undefined]);
  } finally {
    server.close();
  }
});

test('requestBackend: threads method and extraHeaders through to the backend', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    seen.push({ method: req.method, auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    await requestBackend({
      endpoint: urlOf(server), body: null, timeoutMs: 2000,
      method: 'GET', extraHeaders: { Authorization: 'Bearer tok' },
    });
    assert.deepEqual(seen, [{ method: 'GET', auth: 'Bearer tok' }]);
  } finally {
    server.close();
  }
});

/* ---------- postJsonWithTimeout: the canonical round-trip ---------- */

function capturingHandler(status, body, sink) {
  return (req, res) => {
    sink.push(req.headers['idempotency-key']);
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  };
}

test('postJsonWithTimeout: POSTs JSON and resolves {status, raw}', async () => {
  const server = await startServer(jsonHandler(200, { ok: true }));
  try {
    const res = await postJsonWithTimeout(urlOf(server), { a: 1 }, 2000);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.raw), { ok: true });
  } finally {
    server.close();
  }
});

test('postJsonWithTimeout: an invalid URL rejects with kind "invalid-url"', async () => {
  await assert.rejects(
    () => postJsonWithTimeout('not a url', {}, 1000),
    (e) => e.kind === 'invalid-url',
  );
});

test('postJsonWithTimeout: a timeout rejects with kind "timeout"', async () => {
  const server = await startServer((_req, _res) => {
    // Never respond — forces the client-side timeout.
  });
  try {
    await assert.rejects(
      () => postJsonWithTimeout(urlOf(server), {}, 100),
      (e) => e.kind === 'timeout',
    );
  } finally {
    server.close();
  }
});

test('postJsonWithTimeout: connection refused rejects with kind "network-error"', async () => {
  // Bind and immediately close to get a real, guaranteed-closed local port.
  const server = await startServer((_req, res) => res.end());
  const url = urlOf(server);
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(
    () => postJsonWithTimeout(url, {}, 2000),
    (e) => e.kind === 'network-error',
  );
});

/* ---------- requestChain: primary success, no fallback attempted ---------- */

test('postJsonWithTimeout: sends the Idempotency-Key header when passed', async () => {
  const seen = [];
  const server = await startServer(capturingHandler(200, {}, seen));
  try {
    await postJsonWithTimeout(urlOf(server), {}, 2000, 'POST', 'direct-key');
    assert.equal(seen[0], 'direct-key');
  } finally {
    server.close();
  }
});

/* ---------- bodyless requests + extra headers (talents-ai-score, issue 038) ---------- */

// Records method, headers and the raw body of ONE request.
function recordingHandler(status, body, seen) {
  return (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ method: req.method, headers: req.headers, raw });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  };
}

// The interview's state route is this repo's first GET.
test('postJsonWithTimeout: body=null sends NO body and NEITHER Content-Type NOR Content-Length (the GET case)', async () => {
  const seen = [];
  const server = await startServer(recordingHandler(200, { ok: 1 }, seen));
  try {
    const res = await postJsonWithTimeout(urlOf(server), null, 2000, 'GET');
    assert.equal(res.status, 200);
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].raw, '', 'a bodyless request must write nothing');
    assert.equal('content-type' in seen[0].headers, false);
    assert.equal('content-length' in seen[0].headers, false);
    // Accept is still declared — the client still wants JSON back.
    assert.equal(seen[0].headers.accept, 'application/json');
  } finally {
    server.close();
  }
});

test('postJsonWithTimeout: body=undefined is also bodyless (not the JSON value null)', async () => {
  const seen = [];
  const server = await startServer(recordingHandler(200, {}, seen));
  try {
    await postJsonWithTimeout(urlOf(server), undefined, 2000, 'GET');
    assert.equal(seen[0].raw, '');
    assert.equal('content-length' in seen[0].headers, false);
  } finally {
    server.close();
  }
});

test('postJsonWithTimeout: a POST with a body still declares Content-Type and Content-Length (no regression)', async () => {
  const seen = [];
  const server = await startServer(recordingHandler(200, {}, seen));
  try {
    await postJsonWithTimeout(urlOf(server), { a: 1 }, 2000);
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].raw, '{"a":1}');
    assert.equal(seen[0].headers['content-type'], 'application/json');
    assert.equal(seen[0].headers['content-length'], '7');
  } finally {
    server.close();
  }
});

test('postJsonWithTimeout: extraHeaders reach the wire (Authorization: Bearer)', async () => {
  const seen = [];
  const server = await startServer(recordingHandler(200, {}, seen));
  try {
    await postJsonWithTimeout(urlOf(server), null, 2000, 'GET', null, {
      Authorization: 'Bearer abc.def',
    });
    assert.equal(seen[0].headers.authorization, 'Bearer abc.def');
  } finally {
    server.close();
  }
});

// Header-injection defence.
test('postJsonWithTimeout: an extra header carrying CR/LF/NUL is DROPPED, not thrown and not sent', async () => {
  const seen = [];
  const server = await startServer(recordingHandler(200, {}, seen));
  try {
    const res = await postJsonWithTimeout(urlOf(server), null, 2000, 'GET', null, {
      Authorization: 'Bearer good\r\nX-Injected: evil',
      'X-Nul': 'a\0b',
      'X-Empty': '',
      'X-Not-A-String': 42,
      'X-Fine': 'kept',
    });
    assert.equal(res.status, 200, 'must not reject — the request goes out without the bad header');
    assert.equal('authorization' in seen[0].headers, false);
    assert.equal('x-injected' in seen[0].headers, false);
    assert.equal('x-nul' in seen[0].headers, false);
    assert.equal('x-empty' in seen[0].headers, false);
    assert.equal('x-not-a-string' in seen[0].headers, false);
    assert.equal(seen[0].headers['x-fine'], 'kept', 'well-formed siblings still get through');
  } finally {
    server.close();
  }
});


// --- extractSetCookie: RFC6265 prefix tolerance (better-auth over HTTPS) ---

const NAME = 'better-auth.session_token';

test('extractSetCookie: bare name (local http) -> name=value, exact name preserved', () => {
  const headers = { 'set-cookie': [`${NAME}=abc; Path=/; HttpOnly`] };
  assert.equal(extractSetCookie(headers, NAME), `${NAME}=abc`);
});

test('extractSetCookie: __Secure- prefix (HTTPS) -> matched, prefixed name preserved for re-forward', () => {
  const headers = { 'set-cookie': [`__Secure-${NAME}=xyz; Path=/; Secure; HttpOnly; SameSite=Lax`] };
  assert.equal(extractSetCookie(headers, NAME), `__Secure-${NAME}=xyz`);
});

test('extractSetCookie: __Host- prefix -> matched, prefixed name preserved', () => {
  const headers = { 'set-cookie': [`__Host-${NAME}=qqq; Path=/; Secure; HttpOnly`] };
  assert.equal(extractSetCookie(headers, NAME), `__Host-${NAME}=qqq`);
});

test('extractSetCookie: bare name wins when both bare and prefixed are present', () => {
  const headers = { 'set-cookie': [`__Secure-${NAME}=secure`, `${NAME}=bare`] };
  assert.equal(extractSetCookie(headers, NAME), `${NAME}=bare`);
});

test('extractSetCookie: single-string set-cookie with prefix is handled', () => {
  const headers = { 'set-cookie': `__Secure-${NAME}=solo; Path=/` };
  assert.equal(extractSetCookie(headers, NAME), `__Secure-${NAME}=solo`);
});

test('extractSetCookie: no matching cookie -> null; empty value -> null', () => {
  assert.equal(extractSetCookie({ 'set-cookie': ['other=1'] }, NAME), null);
  assert.equal(extractSetCookie({ 'set-cookie': [`__Secure-${NAME}=`] }, NAME), null);
  assert.equal(extractSetCookie(null, NAME), null);
});
