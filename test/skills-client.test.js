'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestResolveAddableSkills, requestDeclareSkill, reasonForError, WORKS_CODE_TO_REASON } = require('../src/skills-client');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function serverUrl(server, path) {
  return `http://127.0.0.1:${server.address().port}${path}`;
}

function worksErrorBody(code, message = 'error') {
  return JSON.stringify({ status: 'KO', code, message, meta: {} });
}

// --- reasonForError (pure) ----------------------------------------------------

test('reasonForError: maps every works.* code to its named reason', () => {
  for (const [code, reason] of Object.entries(WORKS_CODE_TO_REASON)) {
    assert.equal(reasonForError(400, worksErrorBody(code)), reason);
  }
});

test('reasonForError: an unrecognized/absent code falls back to http-<status> (never guesses a cause)', () => {
  assert.equal(reasonForError(401, JSON.stringify({ statusCode: 401, message: 'Unauthorized' })), 'http-401');
  assert.equal(reasonForError(500, 'not json'), 'http-500');
  assert.equal(reasonForError(400, worksErrorBody('works.some_future_code')), 'http-400');
});

// --- requestResolveAddableSkills ----------------------------------------------

test('requestResolveAddableSkills: no endpoint -> no-endpoint, nothing sent', async () => {
  const res = await requestResolveAddableSkills({ technologies: ['react'], accessToken: 'certs.jwt' }, { endpoint: null });
  assert.deepEqual(res, { ok: false, reason: 'no-endpoint' });
});

test('requestResolveAddableSkills: POSTs {technologies} with Authorization Bearer, NO X-Hub-Token', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ body: JSON.parse(raw), auth: req.headers.authorization, hubToken: req.headers['x-hub-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: [{ skillId: 7, skillName: 'React', technology: 'react' }] }));
    });
  });
  try {
    const res = await requestResolveAddableSkills(
      { technologies: ['react', 'typescript'], accessToken: 'certs.jwt.xyz' },
      { endpoint: serverUrl(server, '/resolve-addable') },
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.addable, [{ skillId: 7, skillName: 'React', technology: 'react' }]);
    assert.deepEqual(seen[0].body, { technologies: ['react', 'typescript'] });
    assert.equal(seen[0].auth, 'Bearer certs.jwt.xyz');
    assert.equal(seen[0].hubToken, undefined); // NEVER sent — this route never touches Hub
  } finally {
    server.close();
  }
});

test('requestResolveAddableSkills: an empty `data` array is a legitimate "nothing to add" answer', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  try {
    const res = await requestResolveAddableSkills({ technologies: ['react'], accessToken: 't' }, { endpoint: serverUrl(server, '/resolve-addable') });
    assert.deepEqual(res, { ok: true, addable: [] });
  } finally {
    server.close();
  }
});

test('requestResolveAddableSkills: a 2xx whose `data` is missing/not-an-array -> bad-response, never a throw', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK' }));
  });
  try {
    const res = await requestResolveAddableSkills({ technologies: ['react'], accessToken: 't' }, { endpoint: serverUrl(server, '/resolve-addable') });
    assert.deepEqual(res, { ok: false, reason: 'bad-response' });
  } finally {
    server.close();
  }
});

test('requestResolveAddableSkills: an entry with a non-numeric skillId is dropped, not crashed on', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      data: [{ skillId: 7, skillName: 'React', technology: 'react' }, { skillName: 'Broken' }],
    }));
  });
  try {
    const res = await requestResolveAddableSkills({ technologies: ['react'], accessToken: 't' }, { endpoint: serverUrl(server, '/resolve-addable') });
    assert.equal(res.ok, true);
    assert.deepEqual(res.addable, [{ skillId: 7, skillName: 'React', technology: 'react' }]);
  } finally {
    server.close();
  }
});

test('requestResolveAddableSkills: a plain 401 from the global auth guard (no works.* code) -> http-401, distinct from hub-session-expired', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }));
  });
  try {
    const res = await requestResolveAddableSkills({ technologies: ['react'], accessToken: 'expired' }, { endpoint: serverUrl(server, '/resolve-addable') });
    assert.deepEqual(res, { ok: false, reason: 'http-401' });
  } finally {
    server.close();
  }
});

test('requestResolveAddableSkills: connection refused -> network-error, never a throw', async () => {
  const res = await requestResolveAddableSkills({ technologies: ['react'], accessToken: 't' }, { endpoint: 'http://127.0.0.1:1/resolve-addable' });
  assert.deepEqual(res, { ok: false, reason: 'network-error' });
});

// --- requestDeclareSkill ------------------------------------------------------

test('requestDeclareSkill: no endpoint -> no-endpoint', async () => {
  const res = await requestDeclareSkill({ skillId: 1, accessToken: 't', hubAccessToken: 'h' }, { endpoint: null });
  assert.deepEqual(res, { ok: false, reason: 'no-endpoint' });
});

test('requestDeclareSkill: no hubAccessToken -> no-hub-token, LOCALLY, no request ever sent', async () => {
  let called = false;
  const server = await startServer(() => { called = true; });
  try {
    const res = await requestDeclareSkill({ skillId: 1, accessToken: 't', hubAccessToken: null }, { endpoint: serverUrl(server, '/declare') });
    assert.deepEqual(res, { ok: false, reason: 'no-hub-token' });
    assert.equal(called, false);
  } finally {
    server.close();
  }
});

test('requestDeclareSkill: POSTs {skillId} with BOTH Authorization Bearer AND X-Hub-Token -> ok on the real envelope', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ body: JSON.parse(raw), auth: req.headers.authorization, hubToken: req.headers['x-hub-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // The REAL success shape: {status:'OK', data: TalentSkillDto[]} — the
      // talent's FULL skill list, not the one just declared.
      res.end(JSON.stringify({
        status: 'OK',
        data: [{ talentId: 't1', skill: { id: 42, name: 'React' }, highlighted: false, level: 1, verified: false }],
      }));
    });
  });
  try {
    const res = await requestDeclareSkill(
      { skillId: 42, accessToken: 'certs.jwt.xyz', hubAccessToken: 'hub-jwt-xyz' },
      { endpoint: serverUrl(server, '/declare') },
    );
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(seen[0].body, { skillId: 42 });
    assert.equal(seen[0].auth, 'Bearer certs.jwt.xyz');
    assert.equal(seen[0].hubToken, 'hub-jwt-xyz');
  } finally {
    server.close();
  }
});

test('requestDeclareSkill: a 2xx whose envelope is not {status:"OK", data:[...]} -> bad-response (validates the envelope, not just the status code)', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([{ skillId: 42 }])); // the BARE array the coordinator warned against trusting
  });
  try {
    const res = await requestDeclareSkill({ skillId: 42, accessToken: 't', hubAccessToken: 'h' }, { endpoint: serverUrl(server, '/declare') });
    assert.deepEqual(res, { ok: false, reason: 'bad-response' });
  } finally {
    server.close();
  }
});

test('requestDeclareSkill: 400 works.hub_token_missing -> no-hub-token (server-echoed, even though the client already guards it locally)', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_token_missing'));
  });
  try {
    const res = await requestDeclareSkill({ skillId: 1, accessToken: 't', hubAccessToken: 'h' }, { endpoint: serverUrl(server, '/declare') });
    assert.deepEqual(res, { ok: false, reason: 'no-hub-token' });
  } finally {
    server.close();
  }
});

test('requestDeclareSkill: 401 works.hub_session_expired -> hub-session-expired', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_session_expired'));
  });
  try {
    const res = await requestDeclareSkill({ skillId: 1, accessToken: 't', hubAccessToken: 'h' }, { endpoint: serverUrl(server, '/declare') });
    assert.deepEqual(res, { ok: false, reason: 'hub-session-expired' });
  } finally {
    server.close();
  }
});

test('requestDeclareSkill: a PLAIN 401 (certs session expired, no works.* code) is NEVER confused with hub-session-expired', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }));
  });
  try {
    const res = await requestDeclareSkill({ skillId: 1, accessToken: 'expired', hubAccessToken: 'h' }, { endpoint: serverUrl(server, '/declare') });
    assert.deepEqual(res, { ok: false, reason: 'http-401' });
  } finally {
    server.close();
  }
});

test('requestDeclareSkill: 502 works.hub_upstream_error -> hub-upstream-error', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_upstream_error'));
  });
  try {
    const res = await requestDeclareSkill({ skillId: 1, accessToken: 't', hubAccessToken: 'h' }, { endpoint: serverUrl(server, '/declare') });
    assert.deepEqual(res, { ok: false, reason: 'hub-upstream-error' });
  } finally {
    server.close();
  }
});

test('requestDeclareSkill: 503 works.hub_unavailable -> hub-unavailable', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_unavailable'));
  });
  try {
    const res = await requestDeclareSkill({ skillId: 1, accessToken: 't', hubAccessToken: 'h' }, { endpoint: serverUrl(server, '/declare') });
    assert.deepEqual(res, { ok: false, reason: 'hub-unavailable' });
  } finally {
    server.close();
  }
});

test('requestDeclareSkill: connection refused -> network-error, never a throw', async () => {
  const res = await requestDeclareSkill({ skillId: 1, accessToken: 't', hubAccessToken: 'h' }, { endpoint: 'http://127.0.0.1:1/declare' });
  assert.deepEqual(res, { ok: false, reason: 'network-error' });
});
