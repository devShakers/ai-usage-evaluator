'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { scrubSecrets, buildSynthesisRequest, requestAgentSynthesis } = require('../src/agent-synthesis');

// talents-ai-score, ADR-010/ADR-011: the agent-synthesis client.

// --- scrubSecrets ------------------------------------------------------------

test('scrubSecrets: redacts common API key / token shapes', () => {
  const text = 'Uses sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF for the OpenAI client.';
  const scrubbed = scrubSecrets(text);
  assert.equal(scrubbed.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF'), false);
  assert.match(scrubbed, /\[REDACTED\]/);
});

test('scrubSecrets: redacts AWS-style access key ids', () => {
  const text = 'Access key: AKIAIOSFODNN7EXAMPLE is configured in the env.';
  const scrubbed = scrubSecrets(text);
  assert.equal(scrubbed.includes('AKIAIOSFODNN7EXAMPLE'), false);
});

test('scrubSecrets: redacts bearer tokens and generic long hex/base64-looking secrets', () => {
  const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const scrubbed = scrubSecrets(text);
  assert.equal(scrubbed.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
});

test('scrubSecrets: redacts emails', () => {
  const text = 'Contact talent@example.com if this breaks.';
  const scrubbed = scrubSecrets(text);
  assert.equal(scrubbed.includes('talent@example.com'), false);
  assert.match(scrubbed, /\[REDACTED\]/);
});

test('scrubSecrets: redacts absolute filesystem paths (unix and windows)', () => {
  const text = 'Config lives at /Users/alex/Desktop/secret-project/config.json and C:\\Users\\alex\\secrets.json';
  const scrubbed = scrubSecrets(text);
  assert.equal(scrubbed.includes('/Users/alex/Desktop/secret-project'), false);
  assert.equal(scrubbed.includes('C:\\Users\\alex\\secrets.json'), false);
});

test('scrubSecrets: leaves ordinary prose untouched', () => {
  const text = 'This agent reviews backend code and writes tests for new endpoints.';
  assert.equal(scrubSecrets(text), text);
});

test('scrubSecrets: handles empty/null/undefined input without throwing', () => {
  assert.equal(scrubSecrets(''), '');
  assert.equal(scrubSecrets(null), '');
  assert.equal(scrubSecrets(undefined), '');
});

// --- gaps closed by the three-way security review ---------------------------

test('scrubSecrets: redacts an AWS SECRET access key (base64-shaped, not just the AKIA access key id)', () => {
  const secret = 'wJalrXUtnFEMIK7MDENG7bPx/fiCYEXAMPLEKEY1';
  const text = `aws_secret_access_key = ${secret}`;
  const scrubbed = scrubSecrets(text);
  assert.equal(scrubbed.includes(secret), false);
  assert.match(scrubbed, /\[REDACTED\]/);
});

test('scrubSecrets: redacts a PEM private key block', () => {
  const text = 'Here is the key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAtest\nmoretest==\n-----END RSA PRIVATE KEY-----\nend of message';
  const scrubbed = scrubSecrets(text);
  assert.equal(scrubbed.includes('MIIEowIBAAKCAQEAtest'), false);
  assert.equal(scrubbed.includes('BEGIN RSA PRIVATE KEY'), false);
  assert.match(scrubbed, /\[REDACTED\]/);
  assert.match(scrubbed, /end of message/); // only the PEM block is redacted, not the surrounding prose
});

test('scrubSecrets: redacts credentials embedded in a connection string, keeps the scheme/host', () => {
  const text = 'DATABASE_URL=postgres://dbuser:S3cr3tPassw0rd@db.internal.example.com:5432/prod';
  const scrubbed = scrubSecrets(text);
  assert.equal(scrubbed.includes('dbuser:S3cr3tPassw0rd'), false);
  assert.match(scrubbed, /postgres:\/\/\[REDACTED\]@/);
});

test('scrubSecrets: redacts prefix-identifiable tokens (GitHub, Slack, Google, Stripe, SendGrid)', () => {
  // Fake values. Each literal is split so secret scanners (e.g. GitHub push protection)
  // do not flag the test fixtures as real tokens.
  const samples = [
    'ghp_' + '1234567890abcdefghijklmnopqrstuvwxyz',
    'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789',
    'xoxb-' + '1111111111-222222222222-abcdefghijklmnopqrstuvwx',
    'AIza' + 'SyD-1234567890abcdefghijklmnopqrstuvw',
    'sk_live_' + '51H8examplekeymaterial1234567890',
    'SG.' + 'abcdefghijklmnopqrst.uvwxyzabcdefghijklmnopqrstuvwxyz1234567890',
  ];
  for (const secret of samples) {
    const scrubbed = scrubSecrets(`token: ${secret}`);
    assert.equal(scrubbed.includes(secret), false, `expected ${secret} to be fully redacted, got: ${scrubbed}`);
  }
});

test('scrubSecrets: redacts generic key=value / key: value secret-ish fields', () => {
  const scrubbed = scrubSecrets('config: { password: "hunter2-not-a-real-one" }');
  assert.equal(scrubbed.includes('hunter2-not-a-real-one'), false);
});

// --- requestAgentSynthesis: network behavior, fallback-friendly -------------

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function serverUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/works/ai-footprint/agent-synthesis`;
}

const AGENTS_REQUEST = { agents: [{ name: 'backend-developer', description: 'writes backend code', tools: ['Read'], model: 'sonnet', parent: null }] };

test('requestAgentSynthesis: happy path returns {agents, edges}', async () => {
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' }],
        edges: [],
      }));
    });
  });
  try {
    const result = await requestAgentSynthesis(AGENTS_REQUEST, { endpoint: serverUrl(server) });
    assert.ok(result);
    assert.equal(result.agents[0].symbolicName, 'The Builder');
    assert.deepEqual(result.edges, []);
  } finally {
    server.close();
  }
});

test('requestAgentSynthesis: no endpoint configured -> null (caller falls back)', async () => {
  const result = await requestAgentSynthesis(AGENTS_REQUEST, { endpoint: null });
  assert.equal(result, null);
});

test('requestAgentSynthesis: network error -> null, never throws', async () => {
  const result = await requestAgentSynthesis(AGENTS_REQUEST, { endpoint: 'http://127.0.0.1:1/works/ai-footprint/agent-synthesis' });
  assert.equal(result, null);
});

test('requestAgentSynthesis: non-2xx response -> null', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
  });
  try {
    const result = await requestAgentSynthesis(AGENTS_REQUEST, { endpoint: serverUrl(server) });
    assert.equal(result, null);
  } finally {
    server.close();
  }
});

test('requestAgentSynthesis: invalid JSON shape (missing agents[]) -> null', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ oops: true }));
    });
  });
  try {
    const result = await requestAgentSynthesis(AGENTS_REQUEST, { endpoint: serverUrl(server) });
    assert.equal(result, null);
  } finally {
    server.close();
  }
});

test('requestAgentSynthesis: malformed (non-JSON) response body -> null', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not json at all {{{');
    });
  });
  try {
    const result = await requestAgentSynthesis(AGENTS_REQUEST, { endpoint: serverUrl(server) });
    assert.equal(result, null);
  } finally {
    server.close();
  }
});

test('requestAgentSynthesis: timeout -> null (never hangs the local report)', async () => {
  const server = await startServer((req, res) => {
    // Never responds within the test's short timeout window.
  });
  try {
    const result = await requestAgentSynthesis(AGENTS_REQUEST, { endpoint: serverUrl(server), timeoutMs: 50 });
    assert.equal(result, null);
  } finally {
    server.close();
  }
});

test('requestAgentSynthesis: sends the request body scrubbed (no raw secret survives to the wire)', async () => {
  let receivedBody;
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents: [], edges: [] }));
    });
  });
  try {
    const withSecret = {
      agents: [{ name: 'leaky', description: 'uses sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF', tools: [], model: null, parent: null }],
    };
    await requestAgentSynthesis(withSecret, { endpoint: serverUrl(server) });
    assert.equal(JSON.stringify(receivedBody).includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEF'), false);
  } finally {
    server.close();
  }
});

// --- ADR-028: traceContentConsent -------------------------------------------

test('buildSynthesisRequest: consentGranted=true sends the literal boolean true', () => {
  const body = buildSynthesisRequest([{ name: 'a' }], [], true);
  assert.equal(body.traceContentConsent, true);
});

test('buildSynthesisRequest: consentGranted false/omitted/truthy-non-boolean all OMIT the field (never a literal false)', () => {
  assert.equal('traceContentConsent' in buildSynthesisRequest([{ name: 'a' }], []), false);
  assert.equal('traceContentConsent' in buildSynthesisRequest([{ name: 'a' }], [], false), false);
  assert.equal('traceContentConsent' in buildSynthesisRequest([{ name: 'a' }], [], null), false);
  assert.equal('traceContentConsent' in buildSynthesisRequest([{ name: 'a' }], [], 'true'), false);
  assert.equal('traceContentConsent' in buildSynthesisRequest([{ name: 'a' }], [], 1), false);
});

test('requestAgentSynthesis: forwards traceContentConsent:true verbatim to the wire', async () => {
  let receivedBody;
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents: [], edges: [] }));
    });
  });
  try {
    await requestAgentSynthesis(buildSynthesisRequest([], [], true), { endpoint: serverUrl(server) });
    assert.equal(receivedBody.traceContentConsent, true);
  } finally {
    server.close();
  }
});

test('requestAgentSynthesis: OMITS traceContentConsent when not granted, and defensively drops a non-boolean truthy value set directly on the body', async () => {
  let receivedBody;
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ agents: [], edges: [] }));
    });
  });
  try {
    await requestAgentSynthesis({ ...AGENTS_REQUEST, traceContentConsent: 'true' }, { endpoint: serverUrl(server) });
    assert.equal('traceContentConsent' in receivedBody, false, 'a non-boolean value must never reach the wire');
  } finally {
    server.close();
  }
});
