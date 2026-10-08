'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestListPortfolios, requestDeclarePortfolio, requestDraftDescription, requestUpdatePortfolioSkills } = require('../src/portfolio-client');

// talents-ai-score, ADR-059: certs' talent-portfolio client.

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function serverUrl(server, p) {
  return `http://127.0.0.1:${server.address().port}${p}`;
}
function worksErrorBody(code, message = 'error') {
  return JSON.stringify({ status: 'KO', code, message, meta: {} });
}

/* ---------------- requestListPortfolios ---------------- */

test('requestListPortfolios: no endpoint -> no-endpoint, nothing sent', async () => {
  const res = await requestListPortfolios({ accessToken: 'certs.jwt', hubAccessToken: 'hub.jwt' }, { endpoint: null });
  assert.deepEqual(res, { ok: false, reason: 'no-endpoint' });
});

test('requestListPortfolios: no hubAccessToken -> no-hub-token, LOCALLY, nothing sent', async () => {
  let hit = false;
  const server = await startServer((_req, res) => { hit = true; res.writeHead(200); res.end('{}'); });
  try {
    const res = await requestListPortfolios({ accessToken: 'certs.jwt' }, { endpoint: serverUrl(server, '/portfolios') });
    assert.deepEqual(res, { ok: false, reason: 'no-hub-token' });
    assert.equal(hit, false);
  } finally {
    server.close();
  }
});

test('requestListPortfolios: GETs with Authorization Bearer + X-Hub-Token, no body', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ method: req.method, raw, auth: req.headers.authorization, hubToken: req.headers['x-hub-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [1, 2], startDate: '2024-01-01', endDate: null, isCurrent: true }] }));
    });
  });
  try {
    const res = await requestListPortfolios(
      { accessToken: 'certs.jwt', hubAccessToken: 'hub.jwt' },
      { endpoint: serverUrl(server, '/portfolios') },
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.portfolios, [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [1, 2], startDate: '2024-01-01', endDate: null, isCurrent: true }]);
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].raw, ''); // no body on a GET
    assert.equal(seen[0].auth, 'Bearer certs.jwt');
    assert.equal(seen[0].hubToken, 'hub.jwt');
  } finally {
    server.close();
  }
});

test('requestListPortfolios: an empty list is a legitimate "nothing yet" answer', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: [] }));
  });
  try {
    const res = await requestListPortfolios({ accessToken: 'x', hubAccessToken: 'y' }, { endpoint: serverUrl(server, '/portfolios') });
    assert.deepEqual(res, { ok: true, portfolios: [] });
  } finally {
    server.close();
  }
});

test('requestListPortfolios: hub_session_expired maps to hub-session-expired', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_session_expired'));
  });
  try {
    const res = await requestListPortfolios({ accessToken: 'x', hubAccessToken: 'y' }, { endpoint: serverUrl(server, '/portfolios') });
    assert.deepEqual(res, { ok: false, reason: 'hub-session-expired' });
  } finally {
    server.close();
  }
});

test('requestListPortfolios: a certs-session 401 with NO works.* code -> http-401, distinct from hub-session-expired', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }));
  });
  try {
    const res = await requestListPortfolios({ accessToken: 'x', hubAccessToken: 'y' }, { endpoint: serverUrl(server, '/portfolios') });
    assert.deepEqual(res, { ok: false, reason: 'http-401' });
  } finally {
    server.close();
  }
});

/* ---------------- requestDeclarePortfolio ---------------- */

test('requestDeclarePortfolio: no endpoint -> no-endpoint, nothing sent', async () => {
  const res = await requestDeclarePortfolio({ name: 'x', type: 'PORTFOLIO', hubAccessToken: 'hub.jwt' }, { endpoint: null });
  assert.deepEqual(res, { ok: false, reason: 'no-endpoint' });
});

test('requestDeclarePortfolio: no hubAccessToken -> no-hub-token, LOCALLY, nothing sent', async () => {
  let hit = false;
  const server = await startServer((_req, res) => { hit = true; res.writeHead(200); res.end('{}'); });
  try {
    const res = await requestDeclarePortfolio({ name: 'x', type: 'PORTFOLIO', accessToken: 'certs.jwt' }, { endpoint: serverUrl(server, '/declare') });
    assert.deepEqual(res, { ok: false, reason: 'no-hub-token' });
    assert.equal(hit, false);
  } finally {
    server.close();
  }
});

test('requestDeclarePortfolio: sends ONLY the fields that are actually set — optional fields are OMITTED, never null/empty', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ body: JSON.parse(raw), auth: req.headers.authorization, hubToken: req.headers['x-hub-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: { name: 'x' } }));
    });
  });
  try {
    await requestDeclarePortfolio(
      {
        name: 'Shakers CLI', type: 'PORTFOLIO',
        skillIds: [], description: '', url: '', clientName: '', startDate: null, endDate: null,
        accessToken: 'certs.jwt', hubAccessToken: 'hub.jwt',
      },
      { endpoint: serverUrl(server, '/declare') },
    );
    // `generatedWith:'AI'` is ALWAYS sent (dueño, 2026-08-12 follow-up) —
    // it is not one of the "optional, omitted when empty" fields.
    assert.deepEqual(seen[0].body, { name: 'Shakers CLI', type: 'PORTFOLIO', generatedWith: 'AI' });
    assert.equal(seen[0].auth, 'Bearer certs.jwt');
    assert.equal(seen[0].hubToken, 'hub.jwt');
  } finally {
    server.close();
  }
});

test('requestDeclarePortfolio: every optional field, when present, IS sent', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: {} }));
    });
  });
  try {
    await requestDeclarePortfolio(
      {
        name: 'Shakers CLI', type: 'EXPERIENCE', skillIds: [7, 12],
        description: 'A zero-dependency CLI.', url: 'https://github.com/acme/widgets',
        clientName: 'Acme', clientDomain: 'acme.com', startDate: '2026-01-01', endDate: '2026-06-01',
        accessToken: 'certs.jwt', hubAccessToken: 'hub.jwt',
      },
      { endpoint: serverUrl(server, '/declare') },
    );
    assert.deepEqual(seen[0], {
      name: 'Shakers CLI', type: 'EXPERIENCE', skillIds: [7, 12],
      description: 'A zero-dependency CLI.', url: 'https://github.com/acme/widgets',
      clientName: 'Acme', clientDomain: 'acme.com', startDate: '2026-01-01', endDate: '2026-06-01',
      generatedWith: 'AI',
    });
  } finally {
    server.close();
  }
});

test('requestDeclarePortfolio: generatedWith:"AI" is ALWAYS sent, unconditionally (dueño, 2026-08-12 follow-up)', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: {} }));
    });
  });
  try {
    // No caller ever passes `generatedWith` in — it is not a parameter of
    // this function at all. It must still show up on the wire every time.
    await requestDeclarePortfolio(
      { name: 'x', type: 'PORTFOLIO', accessToken: 'a', hubAccessToken: 'b' },
      { endpoint: serverUrl(server, '/declare') },
    );
    assert.equal(seen[0].generatedWith, 'AI');
  } finally {
    server.close();
  }
});

test('requestDeclarePortfolio: hub_session_expired maps to hub-session-expired', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(worksErrorBody('works.hub_session_expired'));
  });
  try {
    const res = await requestDeclarePortfolio(
      { name: 'x', type: 'PORTFOLIO', accessToken: 'a', hubAccessToken: 'b' },
      { endpoint: serverUrl(server, '/declare') },
    );
    assert.deepEqual(res, { ok: false, reason: 'hub-session-expired' });
  } finally {
    server.close();
  }
});

test('requestDeclarePortfolio: a 2xx whose envelope is not {status:"OK"} is bad-response, not a false success', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'KO', code: 'weird' }));
  });
  try {
    const res = await requestDeclarePortfolio(
      { name: 'x', type: 'PORTFOLIO', accessToken: 'a', hubAccessToken: 'b' },
      { endpoint: serverUrl(server, '/declare') },
    );
    assert.deepEqual(res, { ok: false, reason: 'bad-response' });
  } finally {
    server.close();
  }
});

/* ---------------- requestDraftDescription ---------------- */

test('requestDraftDescription: no endpoint -> no-endpoint, nothing sent', async () => {
  const res = await requestDraftDescription({ name: 'x', technologies: ['React'] }, { endpoint: null });
  assert.deepEqual(res, { ok: false, reason: 'no-endpoint' });
});

test('requestDraftDescription: POSTs {consent:true, name, technologies} with Authorization Bearer, NO X-Hub-Token', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ body: JSON.parse(raw), auth: req.headers.authorization, hubToken: req.headers['x-hub-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: { description: 'A zero-dependency CLI for AI usage evaluation.' } }));
    });
  });
  try {
    const res = await requestDraftDescription(
      { name: 'Shakers CLI', technologies: ['React', 'Node.js'], accessToken: 'certs.jwt' },
      { endpoint: serverUrl(server, '/draft-description') },
    );
    assert.equal(res.ok, true);
    assert.equal(res.description, 'A zero-dependency CLI for AI usage evaluation.');
    // `consent: true` is sent UNCONDITIONALLY: this client is only ever
    // invoked after the caller's own consent gate already accepted.
    assert.deepEqual(seen[0].body, { consent: true, name: 'Shakers CLI', technologies: ['React', 'Node.js'] });
    assert.equal(seen[0].auth, 'Bearer certs.jwt');
    assert.equal(seen[0].hubToken, undefined); // NEVER sent — this route never touches Hub
  } finally {
    server.close();
  }
});

test('requestDraftDescription: readme/packageDescription are sent ONLY when present, consent always', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push(JSON.parse(raw));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: { description: 'x' } }));
    });
  });
  try {
    await requestDraftDescription({ name: 'x', technologies: [], accessToken: 'a' }, { endpoint: serverUrl(server, '/draft-description') });
    assert.deepEqual(seen[0], { consent: true, name: 'x', technologies: [] });
    await requestDraftDescription(
      { name: 'x', technologies: [], readme: '# Hi', packageDescription: 'desc', accessToken: 'a' },
      { endpoint: serverUrl(server, '/draft-description') },
    );
    assert.deepEqual(seen[1], { consent: true, name: 'x', technologies: [], readme: '# Hi', packageDescription: 'desc' });
  } finally {
    server.close();
  }
});

test('requestDraftDescription: response is the ENVELOPED {status,data:{description}}, a bare {description} is bad-response', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Deliberately BARE-shaped (the old, wrong assumption), to prove this
    // client now REQUIRES the envelope and no longer accepts the bare shape.
    res.end(JSON.stringify({ description: 'wrong shape' }));
  });
  try {
    const res = await requestDraftDescription({ name: 'x', technologies: [] }, { endpoint: serverUrl(server, '/draft-description') });
    assert.deepEqual(res, { ok: false, reason: 'bad-response' });
  } finally {
    server.close();
  }
});

test('requestDraftDescription: an empty/missing description in the envelope is bad-response, never an empty string treated as a draft', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'OK', data: { description: '' } }));
  });
  try {
    const res = await requestDraftDescription({ name: 'x', technologies: [] }, { endpoint: serverUrl(server, '/draft-description') });
    assert.deepEqual(res, { ok: false, reason: 'bad-response' });
  } finally {
    server.close();
  }
});

test('requestDraftDescription: 403 works.ai_consent_required maps to reason "ai-consent-required" (verified live against certs local)', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'KO', code: 'works.ai_consent_required',
      message: 'AI features require explicit consent — none was given for this request', meta: {},
    }));
  });
  try {
    const res = await requestDraftDescription({ name: 'x', technologies: [] }, { endpoint: serverUrl(server, '/draft-description') });
    assert.deepEqual(res, { ok: false, reason: 'ai-consent-required' });
  } finally {
    server.close();
  }
});

test('requestDraftDescription: network error -> network-error (never throws)', async () => {
  const res = await requestDraftDescription({ name: 'x', technologies: [] }, { endpoint: 'http://127.0.0.1:1/draft-description', timeoutMs: 2000 });
  assert.equal(res.ok, false);
  assert.ok(['network-error', 'timeout'].includes(res.reason));
});

/* ---------------- requestUpdatePortfolioSkills (ADR-038) ---------------- */

test('requestUpdatePortfolioSkills: no endpoint -> no-endpoint, nothing sent', async () => {
  const res = await requestUpdatePortfolioSkills({ portfolioId: 'pf-1', skillIds: [1], hubAccessToken: 'hub.jwt' }, { endpoint: null });
  assert.deepEqual(res, { ok: false, reason: 'no-endpoint' });
});

test('requestUpdatePortfolioSkills: no hub token -> no-hub-token, nothing sent', async () => {
  let hit = false;
  const server = await startServer((_req, res) => { hit = true; res.writeHead(200); res.end('{}'); });
  try {
    const res = await requestUpdatePortfolioSkills({ portfolioId: 'pf-1', skillIds: [1] }, { endpoint: serverUrl(server, '/works/portfolios') });
    assert.deepEqual(res, { ok: false, reason: 'no-hub-token' });
    assert.equal(hit, false);
  } finally {
    server.close();
  }
});

test('requestUpdatePortfolioSkills: PATCHes DIRECT to hub with only Authorization Bearer (no X-Hub-Token), skillIds joined into the portfolioId path', async () => {
  const seen = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, raw, auth: req.headers.authorization, hubToken: req.headers['x-hub-token'] });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', data: {} }));
    });
  });
  try {
    const res = await requestUpdatePortfolioSkills(
      { portfolioId: 'pf-1', skillIds: [1, 2, 3], hubAccessToken: 'hub.jwt' },
      { endpoint: serverUrl(server, '/works/portfolios') },
    );
    assert.equal(res.ok, true);
    assert.equal(seen[0].method, 'PATCH');
    assert.equal(seen[0].url, '/works/portfolios/pf-1');
    assert.equal(seen[0].auth, 'Bearer hub.jwt');
    assert.equal(seen[0].hubToken, undefined);
    assert.match(seen[0].raw, /name="skillIds"/);
    assert.match(seen[0].raw, /1,2,3/);
  } finally {
    server.close();
  }
});

test('requestUpdatePortfolioSkills: a non-2xx maps to a named reason', async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'KO', code: 'not-found', message: 'Portfolio not found', meta: {} }));
  });
  try {
    const res = await requestUpdatePortfolioSkills(
      { portfolioId: 'pf-1', skillIds: [1], hubAccessToken: 'hub.jwt' },
      { endpoint: serverUrl(server, '/works/portfolios') },
    );
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'http-404');
  } finally {
    server.close();
  }
});
