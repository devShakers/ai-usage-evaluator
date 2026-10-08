'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { streamAlmaChat, askAlma } = require('../src/alma-client');
const { makeAskTools, ASK_SCHEMA } = require('../src/mcp-ask-tools');

// An NDJSON server that emits a scripted list of events, one JSON per line.
function ndjsonServer(events, { status = 200 } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        server._lastAuth = req.headers.authorization;
        server._lastBody = body;
        if (status !== 200) { res.writeHead(status); res.end('{"error":"nope"}'); return; }
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        for (const e of events) res.write(`${JSON.stringify(e)}\n`);
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

const EVENTS = [
  { type: 'turn_started', text: 'hi' },
  { type: 'text_delta', text: 'Hello' },
  { type: 'text_delta', text: ', world' },
  { type: 'turn_finished', text: 'Hello, world' },
];

test('streamAlmaChat: aggregates text_delta, fires onEvent per line, sends Bearer + {message, source}', async () => {
  const { server, base } = await ndjsonServer(EVENTS);
  const seen = [];
  try {
    const r = await streamAlmaChat({ hubAccessToken: 'hub-jwt', message: 'hey' }, { endpoint: `${base}/alma/chat`, onEvent: (e) => seen.push(e.type) });
    assert.equal(r.ok, true);
    assert.equal(r.text, 'Hello, world'); // concatenated deltas
    assert.deepEqual(seen, ['turn_started', 'text_delta', 'text_delta', 'turn_finished']);
    assert.equal(server._lastAuth, 'Bearer hub-jwt');
    assert.deepEqual(JSON.parse(server._lastBody), { message: 'hey', source: 'shakers-cli' });
  } finally { server.close(); }
});

test('streamAlmaChat: guards + non-2xx maps to a reason', async () => {
  assert.deepEqual(await streamAlmaChat({ message: 'x' }, { endpoint: 'http://127.0.0.1:1/c' }), { ok: false, reason: 'no-hub-token' });
  assert.deepEqual(await streamAlmaChat({ hubAccessToken: 't' }, { endpoint: 'http://x/c' }), { ok: false, reason: 'no-message' });
  const { server, base } = await ndjsonServer([], { status: 401 });
  try {
    const r = await streamAlmaChat({ hubAccessToken: 't', message: 'x' }, { endpoint: `${base}/c` });
    assert.equal(r.ok, false);
    assert.ok(r.reason);
  } finally { server.close(); }
});

test('streamAlmaChat: a mid-stream response error settles the promise (no hang)', async () => {
  const { EventEmitter } = require('events');
  const requestImpl = {
    request(_opts, cb) {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setEncoding = () => {};
      process.nextTick(() => {
        cb(res); // headers already received
        process.nextTick(() => res.emit('error', Object.assign(new Error('reset'), { code: 'ECONNRESET' })));
      });
      const req = new EventEmitter();
      req.write = () => {}; req.end = () => {}; req.destroy = () => {};
      return req;
    },
  };
  const r = await streamAlmaChat({ hubAccessToken: 't', message: 'x' }, { endpoint: 'http://x/alma/chat', requestImpl });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ECONNRESET');
});

test('askAlma: resolves the endpoint from config', async () => {
  const none = await askAlma({ getAlmaChatEndpoint: () => null }, { hubAccessToken: 't', message: 'x' });
  assert.equal(none.reason, 'no-endpoint');
  let passedEndpoint;
  await askAlma({ getAlmaChatEndpoint: () => 'http://alma/alma/chat', streamAlmaChat: async (_a, { endpoint }) => { passedEndpoint = endpoint; return { ok: true, text: 'ok' }; } }, { hubAccessToken: 't', message: 'x' });
  assert.equal(passedEndpoint, 'http://alma/alma/chat');
});

test('ask tool: session-gated, requires message, returns aggregated answer', async () => {
  const [tool] = makeAskTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', askAlma: async () => ({ ok: true, text: 'Full answer' }) });
  assert.equal(tool.name, 'ask');
  assert.deepEqual(ASK_SCHEMA.required, ['message']);
  assert.deepEqual(await tool.handler({}), { ok: false, reason: 'no-message' });
  assert.deepEqual(await tool.handler({ message: 'hi' }), { ok: true, answer: 'Full answer' });
  const [gated] = makeAskTools({ loadAuthSession: () => null, sessionStatus: () => 'expired' });
  await assert.rejects(() => gated.handler({ message: 'x' }), /no active Shakers session/);
});
