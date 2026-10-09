'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createMcpServer } = require('../src/mcp-server');
const { makeAiUsageTool, buildArgv } = require('../src/mcp-ai-usage-tool');
const { saveAuthSession } = require('../src/auth-session-store');
const BIN = path.join(__dirname, '..', 'bin', 'mcp.js');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function startMockIngest() {
  return new Promise((resolve) => {
    const received = [];
    const server = http.createServer((req, res) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => {
        try { received.push(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { /* ignore */ }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'OK' }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, received, port: server.address().port });
    });
  });
}

function mcpClient(env) {
  const child = spawn(process.execPath, [BIN], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const waiters = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const w = waiters.get(msg.id);
      if (w) { waiters.delete(msg.id); w(msg); }
    }
  });
  const request = (id, method, params) => new Promise((resolve) => {
    waiters.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };
  const close = () => new Promise((resolve) => {
    child.on('close', resolve);
    child.stdin.end();
  });
  return { child, request, notify, close };
}

test('handleMessage: initialize, tools/list and unknown method (pure, no IO)', async () => {
  const server = createMcpServer({
    tools: [{ name: 'ai_usage', description: 'x', inputSchema: { type: 'object' }, handler: async () => ({ ok: true }) }],
    serverInfo: { name: 'Shakers', version: '9.9.9' },
  });

  const init = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'Shakers');
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });

  const list = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name), ['ai_usage']);

  const notif = await server.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notif, null);

  const unknown = await server.handleMessage({ jsonrpc: '2.0', id: 3, method: 'nope' });
  assert.equal(unknown.error.code, -32601);
});

test('buildArgv maps repoScope and lang to the ai-usage --json path', () => {
  assert.deepEqual(buildArgv({ root: '/r' }), ['--json', '--no-save', '--no-ai', '--root', '/r']);
  assert.deepEqual(buildArgv({ root: '/r', repoScope: { mode: 'all' }, lang: 'es' }), ['--json', '--no-save', '--no-ai', '--root', '/r', '--all-repos', '--lang', 'es']);
  assert.deepEqual(buildArgv({ root: '/r', repoScope: { mode: 'list', repos: ['a', 'b'] } }), ['--json', '--no-save', '--no-ai', '--root', '/r', '--repos', 'a,b']);
});

test('buildArgv always includes --no-ai, even with a stray enrichment arg', () => {
  assert.ok(buildArgv({ root: '/r' }).includes('--no-ai'));
  assert.ok(buildArgv({ root: '/r', enrichment: true }).includes('--no-ai'));
  assert.ok(buildArgv({ root: '/r', repoScope: { mode: 'all' } }).includes('--no-ai'));
});

test('ai_usage tool: consent+scope mapping and send, with injected deps', async () => {
  const calls = { recorded: [], argv: null, shared: null };
  const tool = makeAiUsageTool({
    scanUsage: async (argv) => { calls.argv = argv; return { report: { tier: 'T3' }, maturity: { tierKey: 't3' } }; },
    autoShare: async (report, maturity, opts) => { calls.shared = { report, maturity, opts }; return { ok: true, backend: 'primary' }; },
    recordConsent: (decision, email, meta) => { calls.recorded.push({ decision, email, meta }); },
    persistFootprint: (p) => { calls.persisted = p; },
    isValidEmail: (e) => /@/.test(e),
    loadAuthSession: () => ({ accessToken: 'A', email: 'talent@shakers.com' }),
    sessionStatus: () => 'active',
  });

  const realRoot = mkTmp('ai_usage-root-');
  const out = await tool.handler({ consent: { granted: true, email: 'talent@shakers.com' }, repoScope: { mode: 'all' }, root: realRoot });
  assert.deepEqual(calls.recorded[0], { decision: 'granted', email: 'talent@shakers.com', meta: { verified: true } });
  assert.ok(calls.argv.includes('--all-repos') && calls.argv.includes('--json'));
  assert.equal(out.report.tier, 'T3');
  assert.deepEqual(out.send, { ok: true, backend: 'primary' });
  assert.equal(out.consent.email, 'talent@shakers.com');
  assert.equal(out.savedLocally, true, 'ai_usage persists the footprint so report has data');
  assert.deepEqual(calls.persisted, { root: realRoot, report: { tier: 'T3' }, maturity: { tierKey: 't3' } });

  await assert.rejects(
    tool.handler({ consent: { granted: true } }),
    /email is missing or invalid/,
  );
});

test('ai_usage tool: root resolution refuses a non-repo cwd in current mode, allows machine-wide', async () => {
  let ranArgv = null;
  const deps = {
    cwdIsRepo: () => false,
    scanUsage: async (argv) => { ranArgv = argv; return { report: {}, maturity: {} }; },
    autoShare: async () => ({ ok: true }),
    recordConsent: () => {},
    isValidEmail: () => true,
    persistFootprint: () => {},
  };

  const currentMode = await makeAiUsageTool(deps).handler({ consent: { granted: true, email: 'a@b.co' }, repoScope: { mode: 'current' } });
  assert.equal(currentMode.ok, false);
  assert.equal(currentMode.reason, 'no-repo-root');
  assert.equal(ranArgv, null, 'no scan runs when there is no repo root');

  const machineWide = await makeAiUsageTool(deps).handler({ consent: { granted: true, email: 'a@b.co' }, repoScope: { mode: 'all' } });
  assert.ok(ranArgv && ranArgv.includes('--all-repos'), 'machine-wide still runs from a non-repo cwd');
  assert.ok(machineWide.report !== undefined);

  ranArgv = null;
  const badRoot = await makeAiUsageTool(deps).handler({ consent: { granted: true, email: 'a@b.co' }, root: '/does/not/exist/xyz', repoScope: { mode: 'all' } });
  assert.equal(badRoot.ok, false);
  assert.equal(badRoot.reason, 'invalid-root');
  assert.equal(ranArgv, null);
});

function hybridDeps(over) {
  return {
    cwdIsRepo: () => true,
    scanUsage: async () => ({ report: { agents: [{ name: 'backend-developer' }] }, maturity: { tierKey: 'T6', tierName: 'Multi-agente', name: 'Orchestrated', score: 59 } }),
    autoShare: async () => ({ ok: true }),
    recordConsent: () => {},
    isValidEmail: () => true,
    persistFootprint: () => {},
    getUsageDiscoveredInventoryEndpoint: () => 'http://svc/usage/discovered-inventory',
    ...over,
  };
}

test('ai_usage hybrid: enriched-in-one-call when classification is ready, with a display block and no raw IDs', async () => {
  const out = await makeAiUsageTool(hybridDeps({
    loadAuthSession: () => ({ accessToken: 'A' }),
    sessionStatus: () => 'active',
    pollClassifiedInventory: async () => ({ status: 'ready', reason: 'classified', agents: [{ name: 'backend-developer', tools: [], model: null, category: 'developer', role: 'AI-Assisted Code Writer', level: null, code: 'dev-1', whatItDoes: 'Writes code', method: 'llm' }] }),
  })).handler({ consent: { granted: true, email: 'talent@shakers.com' }, root: process.cwd() });

  assert.equal(out.enrichment, 'ready');
  assert.equal(out.next, null);
  assert.match(out.message, /complete/i);
  assert.equal(out.agents[0].code, 'dev-1', 'raw enriched agents (with code) available for add_agent');
  assert.equal(out.display.tier.key, 'T6');
  assert.equal(out.display.tierLegend.length, 8);
  assert.deepEqual(out.display.agents, [{ name: 'backend-developer', category: 'developer', role: 'AI-Assisted Code Writer' }]);
  assert.equal('code' in out.display.agents[0], false, 'display agents carry no internal code');
});

test('ai_usage hybrid: pending when classification is not ready within the inline wait', async () => {
  const out = await makeAiUsageTool(hybridDeps({
    loadAuthSession: () => ({ accessToken: 'A' }),
    sessionStatus: () => 'active',
    pollClassifiedInventory: async () => ({ status: 'pending', reason: 'classifying', agents: [] }),
  })).handler({ consent: { granted: true, email: 'talent@shakers.com' }, root: process.cwd() });

  assert.equal(out.enrichment, 'pending');
  assert.equal(out.next, 'ai_usage_result');
  assert.equal(out.agents, null);
  assert.match(out.message, /not an error/i);
  assert.deepEqual(out.display.agents, [{ name: 'backend-developer' }]);
});

test('ai_usage hybrid: no verified session => fail-closed, no submit, no enrichment', async () => {
  let polled = false;
  let shared = false;
  const out = await makeAiUsageTool(hybridDeps({
    loadAuthSession: () => null,
    sessionStatus: () => 'none',
    autoShare: async () => { shared = true; return { ok: true }; },
    pollClassifiedInventory: async () => { polled = true; return { status: 'ready', agents: [] }; },
  })).handler({ consent: { granted: true, email: 'talent@shakers.com' }, root: process.cwd() });
  assert.equal(shared, false, 'no report is POSTed without a verified session');
  assert.equal(polled, false, 'no enrichment poll without a submit');
  assert.equal(out.send.skipped, true);
  assert.equal(out.send.reason, 'email-unverified');
  assert.equal(out.enrichment, 'none');
  assert.equal(out.next, null);
  assert.match(out.message, /not submitted/i);
  assert.match(out.message, /not verified/i);
  assert.equal(out.savedLocally, true, 'still saved locally');
});

test('ai_usage: a stale consent arg email is re-anchored to the active session email (desync immunity)', async () => {
  const calls = { recorded: [] };
  const out = await makeAiUsageTool(hybridDeps({
    loadAuthSession: () => ({ accessToken: 'A', email: 'session-y@shakers.com' }),
    sessionStatus: () => 'active',
    isValidEmail: (e) => /@/.test(e),
    recordConsent: (decision, email, meta) => { calls.recorded.push({ decision, email, meta }); },
    autoShare: async () => ({ ok: true, backend: 'primary' }),
    pollClassifiedInventory: async () => ({ status: 'pending', reason: 'classifying', agents: [] }),
    resolveAiProfilePreview: async () => ({ status: 'unavailable', preview: null }),
    getAiProfileEndpoint: () => null,
  })).handler({ consent: { granted: true, email: 'stale-x@old.com' }, root: process.cwd() });
  // The ingest is attributed to the logged-in session, never the stale arg email.
  assert.deepEqual(calls.recorded[0], { decision: 'granted', email: 'session-y@shakers.com', meta: { verified: true } });
  assert.equal(out.consent.email, 'session-y@shakers.com');
  assert.equal(out.send.ok, true);
});

test('ai_usage: nothing is scanned without the talent\'s explicit yes; it returns the disclaimers, the question and its options in one block', async () => {
  const { signupCopy, legalCopy } = require('../src/signup-copy');
  const ES = signupCopy('es');
  let scanned = 0;
  const recorded = [];
  const tool = makeAiUsageTool(hybridDeps({
    scanUsage: async () => { scanned += 1; return { report: {}, maturity: {} }; },
    recordConsent: (decision) => { recorded.push(decision); },
    signupPhase: () => 'account',
  }));
  const asked = await tool.handler({ repoScope: { mode: 'all' }, lang: 'es' });
  assert.equal(asked.reason, 'consent-required');
  assert.ok(asked.say.startsWith([legalCopy('es').usageInfoAccessed, legalCopy('es').usageGoalDuration, ES.aiUsageQuestion].join('\n\n')));
  assert.deepEqual(asked.options, [ES.aiUsageYes, ES.aiUsageSkip]);
  assert.match(asked.message, /word for word/);
  const declined = await tool.handler({ consent: { granted: false }, repoScope: { mode: 'all' }, lang: 'es' });
  assert.equal(declined.reason, 'consent-declined');
  assert.deepEqual(require('../src/mcp-choice').takeNotices(), [ES.aiUsageSkipped], 'in the sign-up the skip line rides on the next question');
  assert.equal(scanned, 0, 'neither a missing answer nor a no starts a scan');
  assert.deepEqual(recorded, ['denied']);
  assert.match(tool.description, /explicit yes/);
});

test('smoke: JSON-RPC over stdio subprocess — initialize -> tools/list -> tools/call ai_usage', async () => {
  const mock = await startMockIngest();
  const configDir = mkTmp('shakers-mcp-cfg-');
  const homeDir = mkTmp('shakers-mcp-home-');
  const root = mkTmp('shakers-mcp-root-');

  saveAuthSession(
    { accessToken: 'jwt', expiresAt: new Date(Date.now() + 3600e3).toISOString(), email: 'talent@shakers.com', hubAccessToken: 'hub' },
    { ...process.env, SHAKERS_CLI_CONFIG_DIR: configDir },
  );

  const client = mcpClient({
    SHAKERS_CLI_INGEST_ENDPOINT: `http://127.0.0.1:${mock.port}`,
    SHAKERS_CLI_CONFIG_DIR: configDir,
    SHAKERS_CLI_HOME_DIR: homeDir,
    NO_ANIMATION: '1',
  });

  try {
    const init = await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'Shakers');

    client.notify('notifications/initialized');

    const list = await client.request(2, 'tools/list');
    assert.ok(list.result.tools.some((t) => t.name === 'ai_usage'), 'tools/list must expose ai_usage');

    const call = await client.request(3, 'tools/call', {
      name: 'ai_usage',
      arguments: { consent: { granted: true, email: 'talent@shakers.com' }, repoScope: { mode: 'current' }, root },
    });
    assert.equal(call.result.isError, false);
    const payload = JSON.parse(call.result.content[0].text);
    assert.ok(payload.report, 'the tool returns a structured report');
    assert.ok(payload.maturity, 'the tool returns the maturity/tier');
    assert.equal(payload.send.ok, true, 'the report was accepted by the mock ingest');
    const ingest = mock.received.filter((r) => r && r.email === 'talent@shakers.com' && r.payload);
    assert.equal(ingest.length, 1, 'the mock ingest received exactly one report submission');
    assert.ok(ingest[0].payload.maturity || ingest[0].payload.tools || typeof ingest[0].payload === 'object', 'the submission carries the derived report payload');
  } finally {
    await client.close();
    mock.server.close();
  }
});

test('initialize: server instructions are advertised when given, omitted otherwise', async () => {
  const { createMcpServer } = require('../src/mcp-server');
  const tool = { name: 't', handler: async () => ({}) };
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } };
  const withIt = await createMcpServer({ tools: [tool], instructions: 'use t first' }).handleMessage(init);
  assert.equal(withIt.result.instructions, 'use t first');
  const without = await createMcpServer({ tools: [tool] }).handleMessage(init);
  assert.equal('instructions' in without.result, false);
});

// A scan the test finishes by hand, to tell "returned at once" from "waited for the scan".
function heldScan(result = { report: { tier: 'T3' }, maturity: { tierKey: 't3' } }) {
  const held = { calls: 0, finish: null };
  held.scanUsage = () => { held.calls += 1; return new Promise((resolve) => { held.finish = () => resolve(result); }); };
  // The scan starts on the next turn of the event loop, after the tool answered.
  held.started = () => new Promise((resolve) => setImmediate(resolve));
  return held;
}

function signupDeps(held, calls, over = {}) {
  let session = null;
  return {
    scanUsage: held.scanUsage,
    autoShare: async (report, maturity, opts) => { calls.shared.push({ report, opts }); return { ok: true, backend: 'primary' }; },
    recordConsent: (decision, email, meta) => { calls.recorded.push({ decision, email, meta }); },
    persistFootprint: () => {},
    isValidEmail: (e) => /@/.test(e || ''),
    loadAuthSession: () => session,
    sessionStatus: (s) => (s ? 'active' : 'none'),
    pollClassifiedInventory: async () => { calls.polled += 1; return { status: 'ready', agents: [] }; },
    resolveAiProfilePreview: async () => { calls.previewed += 1; return { status: 'ready', preview: null }; },
    renderFullReportText: () => 'report',
    signIn: (s) => { session = s; },
    ...over,
  };
}

test('ai_usage while the sign-up window is open: refused, so nothing is scanned, recorded or sent before the account exists', async () => {
  const calls = { recorded: [], shared: [], polled: 0, previewed: 0 };
  const held = heldScan();
  const tool = makeAiUsageTool(signupDeps(held, calls, { signupPhase: () => 'waiting' }));
  const out = await tool.handler({ consent: { granted: true }, repoScope: { mode: 'all' }, root: mkTmp('ai_usage-signup-') });
  await held.started();
  assert.equal(out.reason, 'account-pending');
  assert.equal(held.calls, 0);
  assert.deepEqual(calls.recorded, []);
  assert.equal(calls.shared.length, 0);
});

test('ai_usage once the sign-up account exists: answers before the scan starts, then scans the whole machine and uploads once, in the background', async () => {
  const calls = { recorded: [], shared: [], polled: 0, previewed: 0 };
  const held = heldScan();
  const deps = signupDeps(held, calls, { signupPhase: () => 'account' });
  deps.signIn({ accessToken: 'A', email: 'ada@example.com' });
  const tool = makeAiUsageTool(deps);
  const out = await tool.handler({ consent: { granted: true } });
  assert.equal(out.background, true);
  assert.equal(out.scope.mode, 'all');
  assert.equal(held.calls, 0, 'the answer goes out first');
  assert.match(out.message, /interview/);
  await held.started();
  assert.equal(held.calls, 1);
  held.finish();
  await held.started();
  await held.started();
  assert.deepEqual(calls.recorded, [{ decision: 'granted', email: 'ada@example.com', meta: { verified: true } }]);
  assert.deepEqual(calls.shared[0].report, { tier: 'T3' });
  assert.equal(calls.shared[0].opts.bypassThrottle, true, 'the sign-up is a registration send');
  const again = await tool.handler({ consent: { granted: true } });
  assert.equal(again.background, true);
  assert.equal(held.calls, 1, 'asking again in the sign-up does not rescan');
  assert.equal(calls.shared.length, 1, 'nor sends twice');
  assert.equal(calls.polled + calls.previewed, 0, 'nothing waits on certs in the foreground');
});

test('scanUsage: the MCP scan returns the report and writes nothing to stdout, the JSON-RPC channel', async () => {
  const { scanUsage } = require('../bin/ai-usage');
  const root = mkTmp('ai_usage-scan-');
  const written = [];
  const orig = process.stdout.write;
  // The test runner reports through stdout as bytes; the scan's own prints would be strings.
  process.stdout.write = (c, ...rest) => { if (typeof c === 'string') written.push(c); return orig.call(process.stdout, c, ...rest); };
  let out;
  try { out = await scanUsage(buildArgv({ root, lang: 'en' })); } finally { process.stdout.write = orig; }
  assert.ok(out.report && out.maturity && typeof out.maturity.tierKey === 'string');
  assert.equal(written.join(''), '');
});
