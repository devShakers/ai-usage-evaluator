'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { scrubSecrets, requestAgentSynthesis } = require('../src/agent-synthesis');

/*
 * talents-ai-score, ADR-010/ADR-011: the agent-synthesis client. Every run
 * (regardless of consent — the report is always SHOWN locally), the CLI
 * sends agent DESCRIPTIONS to a Shakers hub endpoint that returns a
 * symbolic-name + "what it does" synthesis, used to enrich the agent role
 * cards in the local HTML report (src/render-html.js). This is EPHEMERAL:
 * nothing here is persisted server-side by design, and the raw description
 * content never reaches src/share.js's payload.
 *
 * Mandatory mitigation (ADR-010): scrub obvious secrets/PII before anything
 * leaves the machine. Mandatory resilience (ADR-011's "always shown"):
 * network/timeout/invalid-JSON failures must resolve to `null` so the
 * caller falls back to the plain structural card (name/tools/model only),
 * never break the local report.
 */

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
