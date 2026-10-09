'use strict';

// MCP elicitation (spec 2025-06-18): the server asks the client and routes its answer back to the waiting tool.
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');

const { createMcpServer } = require('../src/mcp-server');
const { askChoice } = require('../src/mcp-choice');

const tick = () => new Promise((resolve) => setImmediate(resolve));

// A client on the other end of the server's stdio, line by line.
function wire(options) {
  const server = createMcpServer(options);
  const input = new PassThrough();
  const output = new PassThrough();
  const lines = [];
  const waiters = [];
  let buffer = '';
  output.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const msg = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      lines.push(msg);
      for (const w of waiters.splice(0)) w();
    }
  });
  const rl = server.start({ input, output });
  const send = (msg) => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  async function next(pred) {
    for (;;) {
      const i = lines.findIndex(pred);
      if (i !== -1) return lines.splice(i, 1)[0];
      await new Promise((resolve) => waiters.push(resolve));
    }
  }
  return { server, send, next, lines, close: () => rl.close() };
}

function askTool(onAsk = async (ctx) => ctx.elicit({ message: 'Q?', requestedSchema: { type: 'object', properties: {} } })) {
  return { name: 'ask', handler: async (_args, ctx) => ({ reply: await onAsk(ctx), elicitation: ctx.elicitation }) };
}

async function callAsk(c, id = 2) {
  c.send({ id, method: 'tools/call', params: { name: 'ask', arguments: {} } });
}

const resultOf = (msg) => JSON.parse(msg.result.content[0].text);

test('server: a client that declares elicitation gets elicitation/create and its answer reaches the tool', async () => {
  const c = wire({ tools: [askTool()] });
  c.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: { elicitation: {} } } });
  await c.next((m) => m.id === 1);
  await callAsk(c);
  const req = await c.next((m) => m.method === 'elicitation/create');
  assert.equal(typeof req.id, 'string');
  assert.deepEqual(req.params, { message: 'Q?', requestedSchema: { type: 'object', properties: {} } });
  c.send({ id: req.id, result: { action: 'accept', content: { choice: 'Sí' } } });
  const done = await c.next((m) => m.id === 2);
  assert.deepEqual(resultOf(done), { reply: { action: 'accept', content: { choice: 'Sí' } }, elicitation: true });
  c.close();
});

test('server: decline and cancel reach the tool as the client sent them, each request with its own id', async () => {
  const c = wire({ tools: [askTool()] });
  c.send({ id: 1, method: 'initialize', params: { capabilities: { elicitation: { form: {} } } } });
  await c.next((m) => m.id === 1);
  await callAsk(c, 2);
  const first = await c.next((m) => m.method === 'elicitation/create');
  await callAsk(c, 3);
  const second = await c.next((m) => m.method === 'elicitation/create');
  assert.notEqual(first.id, second.id);
  c.send({ id: second.id, result: { action: 'cancel' } });
  c.send({ id: first.id, result: { action: 'decline' } });
  assert.equal(resultOf(await c.next((m) => m.id === 2)).reply.action, 'decline');
  assert.equal(resultOf(await c.next((m) => m.id === 3)).reply.action, 'cancel');
  c.close();
});

test('server: without the capability, or with URL-only elicitation, nothing is sent and the tool gets null', async () => {
  for (const capabilities of [{}, { elicitation: { url: {} } }]) {
    const c = wire({ tools: [askTool()] });
    c.send({ id: 1, method: 'initialize', params: { capabilities } });
    await c.next((m) => m.id === 1);
    await callAsk(c);
    const done = await c.next((m) => m.id === 2);
    assert.deepEqual(resultOf(done), { reply: null, elicitation: false });
    assert.equal(c.lines.length, 0, 'no request went to the client');
    c.close();
  }
});

test('server: a client error, a timeout or a closed connection give the tool null, and a late answer is ignored', async () => {
  const c = wire({ tools: [askTool()], elicitationTimeoutMs: 50 });
  c.send({ id: 1, method: 'initialize', params: { capabilities: { elicitation: {} } } });
  await c.next((m) => m.id === 1);
  await callAsk(c, 2);
  const erred = await c.next((m) => m.method === 'elicitation/create');
  c.send({ id: erred.id, error: { code: -32600, message: 'no dialog' } });
  assert.equal(resultOf(await c.next((m) => m.id === 2)).reply, null);
  await callAsk(c, 3);
  const late = await c.next((m) => m.method === 'elicitation/create');
  assert.equal(resultOf(await c.next((m) => m.id === 3)).reply, null);
  c.send({ id: late.id, result: { action: 'accept', content: {} } });
  c.send({ id: 'nobody-asked', result: {} });
  await tick();
  assert.equal(c.lines.length, 0, 'stray answers produce no error response');
  c.close();
  const open = wire({ tools: [askTool()] });
  open.send({ id: 1, method: 'initialize', params: { capabilities: { elicitation: {} } } });
  await open.next((m) => m.id === 1);
  await callAsk(open, 4);
  await open.next((m) => m.method === 'elicitation/create');
  const started = Date.now();
  open.close();
  assert.equal(resultOf(await open.next((m) => m.id === 4)).reply, null);
  assert.ok(Date.now() - started < 1000, 'closing answers at once, without waiting for the timeout');
});

test('server: a tool waiting on the talent does not hold other requests', async () => {
  const c = wire({ tools: [askTool()] });
  c.send({ id: 1, method: 'initialize', params: { capabilities: { elicitation: {} } } });
  await c.next((m) => m.id === 1);
  await callAsk(c, 2);
  const req = await c.next((m) => m.method === 'elicitation/create');
  c.send({ id: 3, method: 'ping' });
  assert.deepEqual((await c.next((m) => m.id === 3)).result, {});
  c.send({ id: req.id, result: { action: 'cancel' } });
  await c.next((m) => m.id === 2);
  c.close();
});

test('server: the instructions are built for what the client declared', async () => {
  const instructions = (client) => (client.elicitation ? 'dialog' : 'chat');
  const withIt = createMcpServer({ tools: [], instructions });
  const init = await withIt.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: { elicitation: {} } } });
  assert.equal(init.result.instructions, 'dialog');
  const without = createMcpServer({ tools: [], instructions });
  assert.equal((await without.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } })).result.instructions, 'chat');
});

// A scripted talent: each dialog gets the next reply and is recorded.
function dialogs(...replies) {
  const asked = [];
  return { asked, ctx: { elicitation: true, elicit: async (params) => { asked.push(params); return replies.shift(); } } };
}
const pick = (choice) => ({ action: 'accept', content: { choice } });

test('askChoice: one enum field, the pick back; a decline, a cancel or an answer outside the options fall back to the chat', async () => {
  const d = dialogs(pick('B'), { action: 'decline' }, { action: 'cancel' }, pick('Z'));
  assert.deepEqual(await askChoice(d.ctx, { question: 'Which?', options: ['A', 'B'] }), { answer: 'B' });
  assert.deepEqual(d.asked[0], { message: 'Which?', requestedSchema: { type: 'object', properties: { choice: { type: 'string', title: 'Which?', enum: ['A', 'B'] } }, required: ['choice'] } });
  for (const action of ['decline', 'cancel', 'accept']) {
    const r = await askChoice(d.ctx, { question: 'Which?', options: ['A', 'B'] });
    assert.equal(r.dismissed, action);
    assert.deepEqual(r.chat.options, ['A', 'B']);
  }
  const chat = await askChoice({}, { question: 'Which?', options: ['A', 'B'] });
  assert.deepEqual(Object.keys(chat), ['chat']);
  assert.equal(chat.chat.say, 'Which?\n\n1. A\n2. B');
  assert.match(chat.chat.choiceMessage, /Print `say` word for word.*call no tool until the talent answers/);
  const withTexts = await askChoice(dialogs({ action: 'cancel' }).ctx, { texts: ['Notice.'], question: 'Which?', options: ['A', 'B'] });
  assert.equal(withTexts.chat.say, 'Notice.\n\nWhich?\n\n1. A\n2. B', 'a closed dialog keeps the texts');
});

