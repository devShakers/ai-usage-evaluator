'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeReportTools } = require('../src/mcp-report-tools');
const { saveAuthSession } = require('../src/auth-session-store');
const BIN = path.join(__dirname, '..', 'bin', 'mcp.js');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function startMockService() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => {
        const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (/\/auth\/login\/email$/.test(req.url)) {
          return send(200, { status: 'OK', data: { accessToken: 'jwt', expiresAt: new Date(Date.now() + 3600e3).toISOString(), email: 'talent@shakers.com', hubAccessToken: 'hub' } });
        }
        return send(200, { status: 'OK' });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function mcpClient(env) {
  const child = spawn(process.execPath, [BIN], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const call = async (id, name, args) => {
    const r = await request(id, 'tools/call', { name, arguments: args });
    const text = r.result.content[0].text;
    let payload = text;
    if (!r.result.isError) { try { payload = JSON.parse(text); } catch { payload = text; } }
    return { isError: r.result.isError, payload };
  };
  const close = () => new Promise((resolve) => { child.on('close', resolve); child.stdin.end(); });
  return { request, call, close };
}

test('report/share tools (injected deps): session gate and data mapping', async () => {
  const active = { accessToken: 'A' };
  const base = {
    materializeProjectReport: ({ root }) => (root === '/has' ? { hasData: true, htmlPath: '/tmp/report.html', fileUrl: 'file:///tmp/report.html' } : { hasData: false }),
    generateShareCard: ({ root }) => (root === '/has' ? { ok: true, htmlPath: '/tmp/card.html', fileUrl: 'file:///tmp/card.html' } : { ok: false, reason: 'no-footprint' }),
    sessionStatus: (s) => (s && s.accessToken ? 'active' : 'none'),
  };

  const noSess = makeReportTools({ ...base, loadAuthSession: () => null });
  await assert.rejects(noSess.find((t) => t.name === 'report').handler({ root: '/has' }), /call the login tool/);
  await assert.rejects(noSess.find((t) => t.name === 'share').handler({ root: '/has' }), /call the login tool/);

  const tools = makeReportTools({ ...base, loadAuthSession: () => active });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  assert.deepEqual(await byName.report.handler({ root: '/has' }), { ok: true, path: '/tmp/report.html', fileUrl: 'file:///tmp/report.html' });
  assert.equal((await byName.report.handler({ root: '/nope' })).reason, 'no-data');
  assert.deepEqual(await byName.share.handler({ root: '/has' }), { ok: true, path: '/tmp/card.html', fileUrl: 'file:///tmp/card.html' });
  assert.equal((await byName.share.handler({ root: '/nope' })).reason, 'no-footprint');
});

test('smoke: JSON-RPC subprocess — ai_usage persists, then report + share return real paths', async () => {
  const svc = await startMockService();
  const configDir = mkTmp('shakers-report-cfg-');
  const homeDir = mkTmp('shakers-report-home-');
  const root = mkTmp('shakers-report-root-');

  saveAuthSession(
    { accessToken: 'jwt', expiresAt: new Date(Date.now() + 3600e3).toISOString(), email: 'talent@shakers.com', hubAccessToken: 'hub' },
    { ...process.env, SHAKERS_CLI_CONFIG_DIR: configDir },
  );

  const client = mcpClient({
    SHAKERS_CLI_INGEST_ENDPOINT: `http://127.0.0.1:${svc.port}/usage/reports`,
    SHAKERS_CLI_CONFIG_DIR: configDir,
    SHAKERS_CLI_HOME_DIR: homeDir,
  });

  try {
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18' });
    const list = await client.request(2, 'tools/list');
    const names = list.result.tools.map((t) => t.name);
    for (const n of ['report', 'share']) assert.ok(names.includes(n), `tools/list must expose ${n}`);

    const beforeData = await client.call(3, 'report', { root });
    assert.equal(beforeData.payload.ok, false, 'report has no data before ai_usage');
    assert.equal(beforeData.payload.reason, 'no-data');

    const usage = await client.call(4, 'ai_usage', { consent: { granted: true, email: 'talent@shakers.com' }, repoScope: { mode: 'current' }, root });
    assert.equal(usage.payload.savedLocally, true, 'ai_usage persisted the footprint locally');

    const report = await client.call(5, 'report', { root });
    assert.equal(report.payload.ok, true, `report should have data: ${JSON.stringify(report.payload)}`);
    assert.ok(fs.existsSync(report.payload.path), 'the report HTML file exists on disk');

    const share = await client.call(6, 'share', { root });
    assert.equal(share.payload.ok, true);
    assert.ok(fs.existsSync(share.payload.path), 'the share card file exists on disk');
  } finally {
    await client.close();
    svc.server.close();
  }
});
