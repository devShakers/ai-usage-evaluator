'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  requestStartOnboardingLivekitSession,
  requestCompleteOnboardingLivekitSession,
  LIVEKIT_SESSION_PATH,
  COMPLETE_SESSION_PATH,
} = require('../src/onboarding-livekit-client');

function startServer(handler) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => handler(req, res, raw ? JSON.parse(raw) : {}));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
const baseOf = (s) => `http://127.0.0.1:${s.address().port}/interviews`;
const ok = (data) => JSON.stringify({ status: 'OK', data });

test('real certs contract: POST /interviews/:id/livekit-text-session, Bearer + {language}, envelope {serverUrl,participantToken,roomName} resolves', async () => {
  let seen = null;
  const server = await startServer((req, res, body) => {
    seen = { method: req.method, url: req.url, auth: req.headers.authorization, body };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // The exact post-merge certs envelope.
    res.end(ok({ interviewId: 'iv-1', serverUrl: 'wss://lk/room', participantToken: 'jwt-abc', roomName: 'r1' }));
  });
  try {
    const r = await requestStartOnboardingLivekitSession(
      { interviewId: 'iv-1', language: 'es', accessToken: 'tok' },
      { base: baseOf(server) },
    );
    assert.deepEqual(r, { ok: true, livekitUrl: 'wss://lk/room', token: 'jwt-abc', roomName: 'r1', interviewId: 'iv-1', closingMessage: null });
    assert.equal(LIVEKIT_SESSION_PATH, 'livekit-text-session');
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/interviews/iv-1/livekit-text-session');
    assert.equal(seen.auth, 'Bearer tok');
    assert.equal(seen.body.language, 'ES');
  } finally {
    server.close();
  }
});

test('field aliases are tolerated (url/participantToken/room) so a certs rename does not break the CLI', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(ok({ url: 'wss://alt', participantToken: 'jwt-2', room: 'r2', closingMessage: 'bye' }));
  });
  try {
    const r = await requestStartOnboardingLivekitSession({ interviewId: 'iv-9', accessToken: 't' }, { base: baseOf(server) });
    assert.equal(r.ok, true);
    assert.equal(r.livekitUrl, 'wss://alt');
    assert.equal(r.token, 'jwt-2');
    assert.equal(r.roomName, 'r2');
    assert.equal(r.closingMessage, 'bye');
    assert.equal(r.interviewId, 'iv-9');
  } finally {
    server.close();
  }
});

test('a response missing url or token is a bad-response', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(ok({ livekitUrl: 'wss://x' })); // no token
  });
  try {
    const r = await requestStartOnboardingLivekitSession({ interviewId: 'iv', accessToken: 't' }, { base: baseOf(server) });
    assert.deepEqual(r, { ok: false, reason: 'bad-response' });
  } finally {
    server.close();
  }
});

test('an HTTP error maps to a reason, never throws', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'boom' }));
  });
  try {
    const r = await requestStartOnboardingLivekitSession({ interviewId: 'iv', accessToken: 't' }, { base: baseOf(server) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'http-500');
  } finally {
    server.close();
  }
});

test('guards: no base and no interview id', async () => {
  assert.deepEqual(await requestStartOnboardingLivekitSession({ interviewId: 'iv' }, {}), { ok: false, reason: 'no-endpoint' });
  assert.deepEqual(await requestStartOnboardingLivekitSession({}, { base: 'http://x/interviews' }), { ok: false, reason: 'no-interview' });
});

const sampleTranscripts = [
  { role: 'AGENT', message: 'Welcome!', timestamp: '2026-09-03T10:00:00.000Z', timeInCallSecs: 0 },
  { role: 'USER', message: 'I build APIs.', timestamp: '2026-09-03T10:00:05.000Z', timeInCallSecs: 5 },
  { role: 'AGENT', message: 'Thanks, all done.', timestamp: '2026-09-03T10:00:10.000Z', timeInCallSecs: 10 },
];

test('complete: PATCH /interviews/:id/complete, Bearer + {durationSeconds,transcripts}, 2xx -> ok', async () => {
  let seen = null;
  const server = await startServer((req, res, body) => {
    seen = { method: req.method, url: req.url, auth: req.headers.authorization, body };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(ok({ interviewId: 'iv-1', status: 'TAKEN' }));
  });
  try {
    const r = await requestCompleteOnboardingLivekitSession(
      { interviewId: 'iv-1', durationSeconds: 42, transcripts: sampleTranscripts, accessToken: 'tok' },
      { base: baseOf(server) },
    );
    assert.deepEqual(r, { ok: true });
    assert.equal(COMPLETE_SESSION_PATH, 'complete');
    assert.equal(seen.method, 'PATCH');
    assert.equal(seen.url, '/interviews/iv-1/complete');
    assert.equal(seen.auth, 'Bearer tok');
    assert.equal(seen.body.durationSeconds, 42);
    assert.deepEqual(seen.body.transcripts, sampleTranscripts);
  } finally {
    server.close();
  }
});

test('complete: durationSeconds is omitted when not a non-negative integer', async () => {
  let body = null;
  const server = await startServer((req, res, b) => {
    body = b;
    res.writeHead(204);
    res.end();
  });
  try {
    const r = await requestCompleteOnboardingLivekitSession(
      { interviewId: 'iv-1', durationSeconds: -3, transcripts: sampleTranscripts, accessToken: 't' },
      { base: baseOf(server) },
    );
    assert.equal(r.ok, true); // 204 is 2xx
    assert.equal('durationSeconds' in body, false);
    assert.deepEqual(body.transcripts, sampleTranscripts);
  } finally {
    server.close();
  }
});

test('complete: an empty/missing transcript is refused BEFORE any request (no silent empty persist)', async () => {
  assert.deepEqual(
    await requestCompleteOnboardingLivekitSession({ interviewId: 'iv', transcripts: [], accessToken: 't' }, { base: 'http://x/interviews' }),
    { ok: false, reason: 'no-transcript' },
  );
  assert.deepEqual(
    await requestCompleteOnboardingLivekitSession({ interviewId: 'iv', accessToken: 't' }, { base: 'http://x/interviews' }),
    { ok: false, reason: 'no-transcript' },
  );
});

test('complete: guards for no base and no interview id', async () => {
  assert.deepEqual(await requestCompleteOnboardingLivekitSession({ interviewId: 'iv', transcripts: sampleTranscripts }, {}), { ok: false, reason: 'no-endpoint' });
  assert.deepEqual(await requestCompleteOnboardingLivekitSession({ transcripts: sampleTranscripts }, { base: 'http://x/interviews' }), { ok: false, reason: 'no-interview' });
});

test('complete: a strict 400 (malformed turn) maps to a reason, never throws', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'transcripts.0.role must be one of agent,user' }));
  });
  try {
    const r = await requestCompleteOnboardingLivekitSession(
      { interviewId: 'iv', transcripts: sampleTranscripts, accessToken: 't' },
      { base: baseOf(server) },
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'http-400');
  } finally {
    server.close();
  }
});
