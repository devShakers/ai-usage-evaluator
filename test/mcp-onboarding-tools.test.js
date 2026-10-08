'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeOnboardingTools } = require('../src/mcp-onboarding-tools');
const { saveAuthSession } = require('../src/auth-session-store');
const BIN = path.join(__dirname, '..', 'bin', 'mcp.js');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function startMockService() {
  return new Promise((resolve) => {
    const seen = [];
    const server = http.createServer((req, res) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { /* GET */ }
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, hub: req.headers['x-hub-token'] || null, body });
        const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (/\/auth\/login\/email$/.test(req.url)) {
          if (body && body.password === 'wrong') return send(401, { message: 'bad creds' });
          return send(200, { status: 'OK', data: { accessToken: 'jwt-access', expiresAt: new Date(Date.now() + 3600e3).toISOString(), email: 'talent@shakers.com', hubAccessToken: 'hub-tok' } });
        }
        if (/\/discovered-inventory$/.test(req.url)) {
          return send(200, { status: 'OK', data: { skills: [{ skillId: 7, skillName: 'React', technologies: ['react'] }], agents: [{ name: 'foo', tools: ['Read'], model: 'sonnet', category: 'orchestration', role: 'Orchestrator', level: 'operational' }] } });
        }
        if (/\/skills\/declare$/.test(req.url)) return send(200, { status: 'OK', data: [] });
        if (/\/agents\/declare$/.test(req.url)) return send(200, { status: 'OK' });
        if (/\/portfolios\/declare$/.test(req.url)) return send(200, { status: 'OK' });
        return send(404, { code: 'not_found' });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }));
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

test('onboarding tools (injected deps): login persists, add_* gate on session', async () => {
  let saved = null;
  let current = null;
  const base = {
    getLoginEndpoint: () => 'http://svc/auth/login/email',
    getUsageDiscoveredInventoryEndpoint: () => 'http://svc/usage/discovered-inventory',
    getSkillsDeclareEndpoint: () => 'http://svc/works/talents/me/skills/declare',
    getAgentsDeclareEndpoint: () => 'http://svc/works/talents/me/agents/declare',
    getPortfoliosDeclareEndpoint: () => 'http://svc/works/talents/me/portfolios/declare',
    runLoopbackAuth: async () => {
      if (base._loginShouldFail) return { ok: false, reason: 'invalid-credentials' };
      base.saveAuthSession({ accessToken: 'A', hubAccessToken: 'H', email: 'talent@shakers.com', expiresAt: new Date(Date.now() + 3600e3).toISOString() });
      return { ok: true, email: 'talent@shakers.com' };
    },
    saveAuthSession: (s) => { saved = s; current = { accessToken: s.accessToken, hubAccessToken: s.hubAccessToken, expiresAt: s.expiresAt }; },
    loadAuthSession: () => current,
    sessionStatus: (s) => (s && s.accessToken ? 'active' : 'none'),
    requestDiscoveredInventory: async () => ({ ok: true, skills: [{ skillId: 7, skillName: 'React', technologies: ['react'] }], agents: [{ name: 'foo', code: 'dev-1', whatItDoes: 'Does foo things' }] }),
    requestDeclareSkill: async (p) => { base._skill = p; return { ok: true }; },
    requestDeclareAgent: async (p) => { base._agent = p; return { ok: true }; },
    requestDeclarePortfolio: async (p) => { base._portfolio = p; return { ok: true }; },
    // No portfolios wired here — the relate/echo path stays inert so the add_*
    // gate assertions below are deterministic (its own test covers relate).
    getPortfoliosListEndpoint: () => null,
    getRemoteUrl: () => 'git@github.com:me/repo.git',
    getCommitDateRange: () => ({ startDate: '2025-01-01', endDate: '2025-06-01' }),
    isValidEmail: (e) => /@/.test(e),
    normalizeEmail: (e) => e.trim().toLowerCase(),
  };
  const tools = makeOnboardingTools(base);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  await assert.rejects(byName.add_skill.handler({ skillId: 7 }), /call the login tool/);
  await assert.rejects(byName.list_addable.handler({}), /call the login tool/);

  base._loginShouldFail = true;
  const bad = await byName.login.handler({});
  assert.deepEqual(bad, { ok: false, reason: 'invalid-credentials' });
  assert.equal(current, null, 'a failed login persists nothing');

  base._loginShouldFail = false;
  const ok = await byName.login.handler({});
  assert.deepEqual(ok, { ok: true, method: 'email', email: 'talent@shakers.com' });
  assert.equal(saved.hubAccessToken, 'H');

  const inv = await byName.list_addable.handler({});
  assert.equal(inv.ok, true);
  assert.equal(inv.skills[0].skillId, 7);
  assert.equal(inv.agents[0].code, 'dev-1');

  assert.deepEqual(await byName.add_skill.handler({ skillId: 7 }), { ok: true, skillId: 7 });
  assert.equal(base._skill.hubAccessToken, 'H');

  assert.deepEqual(await byName.add_agent.handler({ agentName: 'foo' }), { ok: true, agentName: 'foo', agentId: null });
  assert.equal(base._agent.name, 'foo');
  // The trimmed fields are never forwarded to declare.
  assert.equal('catalogCode' in base._agent, false);
  assert.equal('timeSavedHoursWeek' in base._agent, false);
  assert.equal('isVisible' in base._agent, false);
  assert.equal(base._agent.whatItDoes, 'Does foo things', 'whatItDoes auto-forwarded from inventory when not provided');

  await byName.add_agent.handler({ agentName: 'foo', whatItDoes: 'Explicit description' });
  assert.equal(base._agent.whatItDoes, 'Explicit description', 'explicit whatItDoes is never overridden');

  await byName.add_agent.handler({ agentName: 'foo', humanDecides: 'I supervise it' });
  assert.equal(base._agent.humanDecides, 'I supervise it', 'humanDecides forwarded when provided');
  assert.equal(base._agent.whatItDoes, 'Does foo things', 'whatItDoes still auto-forwarded from inventory');

  const proj = await byName.add_project.handler({ root: '/tmp/my-repo' });
  assert.deepEqual(proj, { ok: true, name: 'my-repo', type: 'PORTFOLIO' });
  assert.equal(base._portfolio.url, 'git@github.com:me/repo.git');
  assert.equal(base._portfolio.startDate, '2025-01-01', 'start/end dates derived from git history');
  assert.equal(base._portfolio.endDate, '2025-06-01');
  assert.equal(base._portfolio.clientName, undefined, 'clientName omitted when not provided');
  assert.equal(base._portfolio.clientDomain, undefined, 'clientDomain omitted when not provided');

  await byName.add_project.handler({ root: '/tmp/my-repo', clientName: 'Acme', clientDomain: 'https://www.acme.com/about' });
  assert.equal(base._portfolio.clientName, 'Acme');
  assert.equal(base._portfolio.clientDomain, 'acme.com', 'clientDomain normalized to a bare domain');
});

test('add_skill: always returns portfolios, relates when relatedPortfolioIds is given (injected deps, ADR-038)', async () => {
  let current = { accessToken: 'A', hubAccessToken: 'H' };
  const updateCalls = [];
  const tools = makeOnboardingTools({
    getSkillsDeclareEndpoint: () => 'http://svc/skills/declare',
    getPortfoliosListEndpoint: () => 'http://svc/portfolios',
    getPortfolioUpdateEndpoint: () => 'http://svc/works/portfolios',
    loadAuthSession: () => current,
    sessionStatus: (s) => (s && s.accessToken ? 'active' : 'none'),
    requestDeclareSkill: async () => ({ ok: true }),
    requestListPortfolios: async () => ({
      ok: true,
      portfolios: [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [2] }],
    }),
    requestUpdatePortfolioSkills: async (p) => { updateCalls.push(p); return { ok: true }; },
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const noRelation = await byName.add_skill.handler({ skillId: 7 });
  assert.equal(noRelation.ok, true);
  assert.deepEqual(noRelation.portfolios, [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO' }]);
  assert.equal(updateCalls.length, 0, 'omitting relatedPortfolioIds never calls update');

  const related = await byName.add_skill.handler({ skillId: 7, relatedPortfolioIds: ['pf-1'] });
  assert.equal(related.ok, true);
  assert.deepEqual(related.related, ['pf-1']);
  assert.deepEqual(related.relateFailures, []);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].portfolioId, 'pf-1');
  assert.deepEqual(updateCalls[0].skillIds, [2, 7]);
  assert.equal(updateCalls[0].hubAccessToken, 'H');

  const unknown = await byName.add_skill.handler({ skillId: 7, relatedPortfolioIds: ['nope'] });
  assert.deepEqual(unknown.relateFailures, [{ portfolioId: 'nope', reason: 'unknown-portfolio' }]);
});

test('add_skill: an already-declared skill (declare 409) still relates instead of failing (idempotent)', async () => {
  const updateCalls = [];
  const tools = makeOnboardingTools({
    getSkillsDeclareEndpoint: () => 'http://svc/skills/declare',
    getPortfoliosListEndpoint: () => 'http://svc/portfolios',
    getPortfolioUpdateEndpoint: () => 'http://svc/portfolios/update',
    loadAuthSession: () => ({ accessToken: 'A', hubAccessToken: 'H' }),
    sessionStatus: () => 'active',
    requestDeclareSkill: async () => ({ ok: false, reason: 'skill-exists' }),
    requestListPortfolios: async () => ({ ok: true, portfolios: [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [2] }] }),
    requestUpdatePortfolioSkills: async (p) => { updateCalls.push(p); return { ok: true }; },
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const out = await byName.add_skill.handler({ skillId: 7, relatedPortfolioIds: ['pf-1'] });
  assert.equal(out.ok, true, 'an already-declared skill is not an error');
  assert.equal(out.alreadyExisted, true);
  assert.deepEqual(out.related, ['pf-1']);
  assert.equal(updateCalls.length, 1, 'it reaches the portfolio-skills update');
});

test('add_agent: echoes portfolios + agentId, relates (portfolioId only) when relatedPortfolios is given (injected deps, ADR-041)', async () => {
  const current = { accessToken: 'A', hubAccessToken: 'H' };
  const relateCalls = [];
  const tools = makeOnboardingTools({
    getAgentsDeclareEndpoint: () => 'http://svc/agents/declare',
    getPortfoliosListEndpoint: () => 'http://svc/portfolios',
    getAgentPortfoliosEndpoint: (id) => `http://svc/works/me/agents/${id}/portfolios`,
    loadAuthSession: () => current,
    sessionStatus: (s) => (s && s.accessToken ? 'active' : 'none'),
    requestDeclareAgent: async () => ({ ok: true, agentId: '42' }),
    requestListPortfolios: async () => ({
      ok: true,
      portfolios: [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [] }],
    }),
    requestRelateAgentPortfolios: async (p) => { relateCalls.push(p); return { ok: true }; },
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const noRelation = await byName.add_agent.handler({ agentName: 'foo', whatItDoes: 'x' });
  assert.equal(noRelation.ok, true);
  assert.equal(noRelation.agentId, '42');
  assert.deepEqual(noRelation.portfolios, [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO' }]);
  assert.equal(relateCalls.length, 0, 'omitting relatedPortfolios never relates');

  const related = await byName.add_agent.handler({
    agentName: 'foo', whatItDoes: 'x',
    relatedPortfolios: [{ portfolioId: 'pf-1' }],
  });
  assert.equal(related.ok, true);
  assert.deepEqual(related.related, ['pf-1']);
  assert.deepEqual(related.relateFailures, []);
  assert.equal(relateCalls.length, 1);
  assert.equal(relateCalls[0].agentId, '42');
  assert.equal(relateCalls[0].hubAccessToken, 'H');
  assert.deepEqual(relateCalls[0].items, [{ portfolioId: 'pf-1' }]);

  const unknown = await byName.add_agent.handler({
    agentName: 'foo', whatItDoes: 'x', relatedPortfolios: [{ portfolioId: 'nope' }],
  });
  assert.deepEqual(unknown.relateFailures, [{ portfolioId: 'nope', reason: 'unknown-portfolio' }]);
  assert.equal(relateCalls.length, 1, 'an unknown portfolio never reaches the relate call');
});

test('add_agent: when the agent already exists (declare 409), resolves its id from the list and relates instead of failing (idempotent, ADR-041)', async () => {
  const current = { accessToken: 'A', hubAccessToken: 'H' };
  const relateCalls = [];
  const tools = makeOnboardingTools({
    getAgentsDeclareEndpoint: () => 'http://svc/agents/declare',
    getAgentsListEndpoint: () => 'http://svc/agents',
    getPortfoliosListEndpoint: () => 'http://svc/portfolios',
    getAgentPortfoliosEndpoint: (id) => `http://svc/works/me/agents/${id}/portfolios`,
    loadAuthSession: () => current,
    sessionStatus: (s) => (s && s.accessToken ? 'active' : 'none'),
    requestDeclareAgent: async () => ({ ok: false, reason: 'agent-exists' }),
    requestListAgents: async () => ({ ok: true, agents: [{ name: 'foo', id: '99' }] }),
    requestListPortfolios: async () => ({ ok: true, portfolios: [{ id: 'pf-1', name: 'Shakers CLI', type: 'PORTFOLIO', skillIds: [] }] }),
    requestRelateAgentPortfolios: async (p) => { relateCalls.push(p); return { ok: true }; },
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const out = await byName.add_agent.handler({
    agentName: 'foo', whatItDoes: 'x',
    relatedPortfolios: [{ portfolioId: 'pf-1' }],
  });
  assert.equal(out.ok, true, 'an already-existing agent is not an error');
  assert.equal(out.alreadyExisted, true);
  assert.equal(out.agentId, '99', 'the id is resolved from the list, not re-created');
  assert.deepEqual(out.related, ['pf-1']);
  assert.equal(relateCalls.length, 1, 'it reaches the relate/junction call');
  assert.equal(relateCalls[0].agentId, '99');
});

test('add_agent: a genuine declare error (agent absent from the list) is surfaced, not masked', async () => {
  const tools = makeOnboardingTools({
    getAgentsDeclareEndpoint: () => 'http://svc/agents/declare',
    getAgentsListEndpoint: () => 'http://svc/agents',
    loadAuthSession: () => ({ accessToken: 'A', hubAccessToken: 'H' }),
    sessionStatus: () => 'active',
    requestDeclareAgent: async () => ({ ok: false, reason: 'hub-upstream-error' }),
    requestListAgents: async () => ({ ok: true, agents: [] }),
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const out = await byName.add_agent.handler({ agentName: 'foo', whatItDoes: 'x' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'hub-upstream-error');
});

test('login method:google points to the device-flow tools (does not sign in here)', async () => {
  const tools = makeOnboardingTools({
    saveAuthSession: () => { throw new Error('login must not persist a session — Google is the device flow'); },
    loadAuthSession: () => null,
    sessionStatus: () => 'none',
  });
  const login = tools.find((t) => t.name === 'login');
  const out = await login.handler({ method: 'google' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'use-device-flow');
  assert.equal(out.next, 'social_signin_start');
  assert.equal(out.mode, 'login');
  assert.match(out.message, /social_signin_start/);
});

test('login (no method): picking Google in the form (viaGoogle) points to the device-flow tools', async () => {
  const tools = makeOnboardingTools({
    // No explicit method -> the loopback form is opened; here it reports the
    // talent chose Google on the method-choice screen.
    runLoopbackAuth: async () => ({ ok: true, viaSocial: true, provider: 'google' }),
    saveAuthSession: () => { throw new Error('must not persist — hand off to the device flow'); },
    loadAuthSession: () => null,
    sessionStatus: () => 'none',
  });
  const login = tools.find((t) => t.name === 'login');
  const out = await login.handler({});
  assert.equal(out.ok, false);
  assert.equal(out.next, 'social_signin_start');
  assert.equal(out.mode, 'login');
});

test('login method:email skips the choice screen and forces the email form', async () => {
  const calls = [];
  const tools = makeOnboardingTools({
    getLoginEndpoint: () => 'http://svc/auth/login/email',
    runLoopbackAuth: async (opts) => { calls.push(opts); return { ok: true, email: 't@shakers.com' }; },
    saveAuthSession: () => {},
    loadAuthSession: () => null,
    sessionStatus: () => 'none',
  });
  const login = tools.find((t) => t.name === 'login');
  const out = await login.handler({ method: 'email' });
  assert.deepEqual(out, { ok: true, method: 'email', email: 't@shakers.com' });
  assert.equal(calls[0].method, 'email', 'the email form is forced (choice screen skipped)');
});

test('logout clears the session and is idempotent (injected deps)', async () => {
  let current = { accessToken: 'A' };
  let cleared = 0;
  const tools = makeOnboardingTools({
    loadAuthSession: () => current,
    clearAuthSession: () => { cleared += 1; current = null; },
    sessionStatus: (s) => (s && s.accessToken ? 'active' : 'none'),
  });
  const logout = tools.find((t) => t.name === 'logout');

  assert.deepEqual(await logout.handler({}), { ok: true, wasLoggedIn: true });
  assert.equal(cleared, 1);
  assert.deepEqual(await logout.handler({}), { ok: true, wasLoggedIn: false });
});

test('smoke: JSON-RPC subprocess — login then list_addable + add_skill/agent/project', async () => {
  const svc = await startMockService();
  const configDir = mkTmp('shakers-onb-cfg-');
  const homeDir = mkTmp('shakers-onb-home-');
  const root = mkTmp('shakers-onb-root-');

  const client = mcpClient({
    SHAKERS_CLI_INGEST_ENDPOINT: `http://127.0.0.1:${svc.port}/usage/reports`,
    SHAKERS_CLI_CONFIG_DIR: configDir,
    SHAKERS_CLI_HOME_DIR: homeDir,
  });

  try {
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18' });
    const list = await client.request(2, 'tools/list');
    const names = list.result.tools.map((t) => t.name);
    for (const n of ['login', 'list_addable', 'add_skill', 'add_agent', 'add_project']) {
      assert.ok(names.includes(n), `tools/list must expose ${n}`);
    }

    const noSess = await client.call(3, 'add_skill', { skillId: 7 });
    assert.equal(noSess.isError, true, 'add_skill without a session is a clear error');

    saveAuthSession(
      { accessToken: 'jwt-access', hubAccessToken: 'hub-tok', email: 'talent@shakers.com', expiresAt: new Date(Date.now() + 3600e3).toISOString() },
      { SHAKERS_CLI_CONFIG_DIR: configDir },
    );

    const inv = await client.call(5, 'list_addable', {});
    assert.equal(inv.payload.ok, true);
    assert.equal(inv.payload.skills[0].skillId, 7);
    assert.ok(inv.payload.agents.some((a) => a.name === 'foo'));

    const addSkill = await client.call(6, 'add_skill', { skillId: 7 });
    assert.equal(addSkill.payload.ok, true);
    const addAgent = await client.call(7, 'add_agent', { agentName: 'foo' });
    assert.equal(addAgent.payload.ok, true);
    const addProject = await client.call(8, 'add_project', { root });
    assert.equal(addProject.payload.ok, true);
    assert.equal(addProject.payload.name, path.basename(root));

    const declare = svc.seen.find((r) => /\/skills\/declare$/.test(r.url));
    assert.equal(declare.auth, 'Bearer jwt-access', 'declare carries the login Bearer');
    assert.equal(declare.hub, 'hub-tok', 'declare carries the X-Hub-Token from the login session');

    const loggedOut = await client.call(9, 'logout', {});
    assert.equal(loggedOut.payload.ok, true);
    assert.equal(loggedOut.payload.wasLoggedIn, true);
    const afterLogout = await client.call(10, 'list_addable', {});
    assert.equal(afterLogout.isError, true, 'after logout, gated tools return the login error');
    const logoutAgain = await client.call(11, 'logout', {});
    assert.equal(logoutAgain.payload.wasLoggedIn, false, 'logout is idempotent');
  } finally {
    await client.close();
    svc.server.close();
  }
});

test('smoke: the login tool over MCP advertises NO password/email field (credentials never in args)', async () => {
  const configDir = mkTmp('shakers-onb-schema-');
  const homeDir = mkTmp('shakers-onb-schema-home-');
  const client = mcpClient({ SHAKERS_CLI_CONFIG_DIR: configDir, SHAKERS_CLI_HOME_DIR: homeDir });
  try {
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18' });
    const list = await client.request(2, 'tools/list');
    const login = list.result.tools.find((t) => t.name === 'login');
    assert.ok(login, 'login tool is exposed');
    const props = (login.inputSchema && login.inputSchema.properties) || {};
    assert.equal(props.password, undefined, 'no password field in the login schema');
    assert.equal(props.email, undefined, 'no email field in the login schema');
    const signup = list.result.tools.find((t) => t.name === 'signup_start');
    const signupProps = signup.inputSchema.properties || {};
    assert.equal(signupProps.password, undefined, 'no password in the sign-up schema');
    assert.equal(signupProps.claimCode, undefined, 'the claim code never travels through tool args');
  } finally {
    await client.close();
  }
});
