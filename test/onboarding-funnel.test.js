'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const funnelLib = require('../src/onboarding-funnel');
const { createFunnel, STEP_INDEX, FLOW_VERSION, mcpClientFor, loadOrCreateDeviceId, DEVICE_FILE_NAME } = funnelLib;
const backend = require('../src/backend-request');
const flow = require('../src/onboarding-flow');
const { createMcpServer } = require('../src/mcp-server');
const { makeSignupTools } = require('../src/mcp-signup-tools');
const { makeRegisterTools } = require('../src/mcp-register-tools');
const { makeRoleTools } = require('../src/mcp-role-tools');
const { signupCopy } = require('../src/signup-copy');
const { resetSignupLanguage } = require('../src/signup-language');
const { needle } = require('../test-fixtures/copy-needle');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function recordingFunnel({ surface = 'cli', token = 'hub-jwt', clock = null, send = null } = {}) {
  const requests = [];
  let t = 1_000_000;
  const funnel = createFunnel({
    surface,
    hubToken: () => (typeof token === 'function' ? token() : token),
    deviceId: () => 'device-1',
    endpoint: () => 'https://hub.test/api/v1/works/talent/me/onboarding-events',
    now: clock || (() => t),
    send: send || (async (req) => { requests.push(req); return { ok: true, status: 202 }; }),
  });
  return { funnel, requests, tick: (ms = 10) => { t += ms; } };
}

function events(requests) {
  return requests.flatMap((r) => r.events);
}

function completedSteps(requests) {
  return events(requests).filter((e) => e.event_type === 'onboarding_step_completed').map((e) => e.properties.step_name);
}

function assertStrictlyIncreasing(evts) {
  for (let i = 1; i < evts.length; i++) assert.ok(evts[i].time > evts[i - 1].time, `time ${i} (${evts[i].properties.step_name}) is after ${i - 1}`);
}

test('steps and indexes are the web funnel, one to one', () => {
  assert.deepEqual(STEP_INDEX, {
    start: 1, account_creation: 2, import_sources: 3, work_situation: 4, availability: 5, rates: 6,
    languages: 7, location: 8, profile_summary: 9, pre_interview: 10, interview: 11, supercluster: 12,
  });
  assert.equal(FLOW_VERSION, 'signup_new_works_v1');
});

test('nothing leaves before the talent\'s own account exists; then the buffer goes out in one request, real times and ids kept', async () => {
  const { funnel, requests, tick } = recordingFunnel();
  funnel.begin();
  funnel.completed('start');
  tick();
  funnel.viewed('account_creation');
  tick();
  await funnel.flush();
  assert.equal(requests.length, 0, 'no flush before identified');
  funnel.completed('account_creation', { auth_method: 'email', is_returning_account: false });
  await funnel.identified();
  assert.equal(requests.length, 1);
  const sent = requests[0].events;
  assert.deepEqual(sent.map((e) => [e.event_type, e.properties.step_name]), [
    ['onboarding_step_completed', 'start'],
    ['onboarding_step_viewed', 'account_creation'],
    ['onboarding_step_completed', 'account_creation'],
  ]);
  assert.deepEqual(sent.map((e) => e.time), [1_000_000, 1_000_010, 1_000_020], 'real times are kept when already in order');
  for (const e of sent) {
    assert.match(e.insert_id, UUID_RE);
    assert.equal(e.device_id, 'device-1');
    assert.equal(e.properties.flow_version, FLOW_VERSION);
    assert.equal(e.properties.surface, 'cli');
    assert.equal(e.properties.step_index, STEP_INDEX[e.properties.step_name]);
    assert.equal('mcp_client' in e.properties, false, 'mcp_client only on surface mcp');
  }
  assert.equal(new Set(sent.map((e) => e.insert_id)).size, 3);
  assert.equal(requests[0].hubAccessToken, 'hub-jwt');
});

test('a batch filled at once is sent in funnel order, one event per step, each time strictly after the previous one', async () => {
  const { funnel, requests } = recordingFunnel();
  funnel.begin();
  funnel.completed('account_creation');
  await funnel.identified();
  funnel.completed('rates', { rate_type: 'hourly' });
  funnel.completed('work_situation');
  funnel.completed('location');
  funnel.completed('availability');
  funnel.completed('languages');
  funnel.completed('rates', { rate_type: 'annual' });
  await funnel.flush();
  assert.equal(requests.length, 2, 'the batch is one request');
  const batch = requests[1].events;
  assert.deepEqual(batch.map((e) => e.properties.step_name), ['work_situation', 'availability', 'rates', 'languages', 'location']);
  assert.equal(batch.find((e) => e.properties.step_name === 'rates').properties.rate_type, 'hourly', 'a step completes once');
  assertStrictlyIncreasing([...requests[0].events, ...batch]);
  assert.equal(batch[0].time, requests[0].events[0].time + 1, 'after the earlier-emitted step, base + 1 ms per event');
  assert.deepEqual(batch.map((e) => e.time - batch[0].time), [0, 1, 2, 3, 4]);
});

test('fire-and-forget: a failing or throwing send never rejects, and never reaches the caller', async () => {
  for (const send of [async () => { throw new Error('ECONNREFUSED'); }, () => { throw new Error('sync'); }, async () => ({ ok: false, status: 500 })]) {
    const { funnel } = recordingFunnel({ send });
    funnel.begin();
    funnel.completed('start');
    await assert.doesNotReject(funnel.identified());
    await assert.doesNotReject(funnel.idle());
  }
});

function jwt(sub) {
  return `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
}

test('events never go out under another account that signed in on this machine after the sign-up', async () => {
  let token = jwt('talent-a');
  const { funnel, requests } = recordingFunnel({ token: () => token });
  funnel.begin();
  funnel.completed('start');
  await funnel.identified();
  token = jwt('talent-a').replace('.s', '.refreshed');
  funnel.completed('work_situation');
  await funnel.flush();
  assert.equal(requests.length, 2, 'a refreshed token of the same talent still sends');
  token = jwt('talent-b');
  funnel.completed('supercluster');
  await funnel.flush();
  assert.equal(requests.length, 2, 'held, not sent as talent B');
});

test('a sign-up begun again in the same process keeps sending once identified, and keeps unsent events', async () => {
  let token = null;
  const { funnel, requests } = recordingFunnel({ token: () => token });
  funnel.begin();
  funnel.completed('start');
  await funnel.identified();
  assert.equal(requests.length, 0, 'no session yet: nothing to bind to');
  funnel.begin();
  token = jwt('talent-a');
  await funnel.identified();
  funnel.completed('work_situation');
  await funnel.flush();
  assert.deepEqual(completedSteps(requests), ['start', 'work_situation']);
});

test('errorTypeFor: a missing endpoint is the server side, a malformed answer is validation', () => {
  assert.equal(funnelLib.errorTypeFor('no-endpoint'), 'server');
  assert.equal(funnelLib.errorTypeFor('bad-situation'), 'validation');
  assert.equal(funnelLib.errorTypeFor('no-session'), 'auth');
});

test('more than 50 events split into requests of at most 50', async () => {
  const { funnel, requests } = recordingFunnel();
  funnel.begin();
  for (let i = 0; i < 60; i++) funnel.track('source_import_started', 'import_sources', { source_type: 'cv' });
  await funnel.identified();
  assert.deepEqual(requests.map((r) => r.events.length), [50, 10]);
});

test('properties carry only string, number, boolean or string[]; undefined and null are omitted', async () => {
  const { funnel, requests } = recordingFunnel();
  funnel.begin();
  funnel.completed('location', { location_country: undefined, location_method: 'manual', is_remote_only: null, languages: ['es'], bad: { x: 1 } });
  await funnel.identified();
  const props = requests[0].events[0].properties;
  assert.deepEqual(Object.keys(props).sort(), ['flow_version', 'languages', 'location_method', 'step_index', 'step_name', 'surface']);
});

test('mcp_client: mapped from the MCP clientInfo name, unknown -> other', () => {
  assert.equal(mcpClientFor('claude-ai'), 'claude');
  assert.equal(mcpClientFor('Claude Code'), 'claude');
  assert.equal(mcpClientFor('ChatGPT'), 'chatgpt');
  assert.equal(mcpClientFor('openai-mcp'), 'chatgpt');
  assert.equal(mcpClientFor('cursor-vscode'), 'cursor');
  assert.equal(mcpClientFor('Zed'), 'other');
  assert.equal(mcpClientFor(undefined), 'other');
});

test('mcp_client: the MCP initialize handshake hands clientInfo.name to the funnel, which stamps it on surface mcp', async () => {
  const { funnel, requests } = recordingFunnel({ surface: 'mcp' });
  const server = createMcpServer({ tools: [], onInitialize: ({ clientInfo }) => funnel.setMcpClient(clientInfo.name) });
  const res = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } });
  assert.ok(res.result.serverInfo, 'the handshake still answers');
  funnel.begin();
  funnel.completed('start');
  await funnel.identified();
  assert.equal(requests[0].events[0].properties.surface, 'mcp');
  assert.equal(requests[0].events[0].properties.mcp_client, 'claude');
});

test('an onInitialize hook that throws never breaks the MCP handshake', async () => {
  const server = createMcpServer({ tools: [], onInitialize: () => { throw new Error('boom'); } });
  const res = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.ok(res.result);
});

test('the no-op funnel records nothing and a funnel never records before begin()', async () => {
  const { funnel, requests } = recordingFunnel();
  assert.equal(funnel.completed('start'), false);
  funnel.begin();
  await funnel.identified();
  assert.equal(requests.length, 0);
  assert.equal(funnelLib.NOOP_FUNNEL.completed('start'), false);
});

function captureServer() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: 1 }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

test('wire: POST works/talent/me/onboarding-events with the talent JWT; X-Shakers-Client is cli, and mcp once the MCP server set it', async (t) => {
  const { server, seen, base } = await captureServer();
  t.after(() => { backend.setClientIdentity('cli'); server.close(); });
  const env = { SHAKERS_CLI_HUB_BASE: `${base}/api/v1` };
  const endpoint = require('../src/config').getOnboardingEventsEndpoint(env);
  assert.ok(endpoint && endpoint.endsWith('/works/talent/me/onboarding-events'), endpoint);
  for (const surface of ['cli', 'mcp']) {
    if (surface === 'mcp') require('../bin/mcp').prepareProcess({ SHAKERS_CLI_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-mcp-')) });
    const funnel = createFunnel({ surface, hubToken: () => 'hub-jwt', deviceId: () => 'dev', endpoint: () => `${base}/api/v1/works/talent/me/onboarding-events` });
    funnel.begin();
    funnel.completed('start');
    await funnel.identified();
  }
  assert.equal(seen.length, 2);
  for (const [i, surface] of ['cli', 'mcp'].entries()) {
    assert.equal(seen[i].method, 'POST');
    assert.equal(seen[i].url, '/api/v1/works/talent/me/onboarding-events');
    assert.equal(seen[i].headers.authorization, 'Bearer hub-jwt');
    assert.equal(seen[i].headers['x-shakers-client'], surface);
    assert.equal(seen[i].body.events[0].properties.surface, surface);
    assert.equal(typeof seen[i].body.events[0].time, 'number');
  }
  assert.throws(() => backend.setClientIdentity('web'));
});

test('device id: created once in the config dir with mode 0600, then stable across processes', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-device-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { SHAKERS_CLI_CONFIG_DIR: dir };
  const first = loadOrCreateDeviceId(env);
  assert.match(first, UUID_RE);
  const file = path.join(dir, DEVICE_FILE_NAME);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(loadOrCreateDeviceId(env), first);
  assert.deepEqual(fs.readdirSync(dir), [DEVICE_FILE_NAME], 'no temp file left behind');
});

test('device id: an unwritable config dir yields no id instead of throwing', () => {
  const failing = { readFileSync: () => { throw new Error('ENOENT'); }, mkdirSync: () => { throw new Error('EROFS'); }, unlinkSync: () => {} };
  assert.equal(loadOrCreateDeviceId({ SHAKERS_CLI_CONFIG_DIR: '/nope' }, { fs: failing }), null);
});

const SESSION = { accessToken: 'tok', hubAccessToken: 'hub', email: 't@t.com', userId: '11111111-2222-3333-4444-555555555555' };

function cliDeps(overrides = {}) {
  let session = null;
  return {
    loadAuthSession: () => session,
    sessionStatus: (s) => (s ? 'active' : 'none'),
    saveAuthSession: () => { session = SESSION; },
    getSignUpEndpoint: () => 'https://hub/s',
    getLoginEndpoint: () => 'https://hub/l',
    requestSignUp: async () => ({ ok: true, accountExists: false }),
    requestLogin: async () => ({ ok: true, accessToken: 'tok', hubAccessToken: 'hub', email: 't@t.com' }),
    getImportProfileEndpoint: () => 'https://hub/i',
    requestImportProfile: async () => ({ ok: true, report: { outcome: 'partial', sources: [{ source: 'linkedin', status: 'imported' }, { source: 'github', status: 'failed', code: 'source.not_found' }] } }),
    getProfessionalDetailsEndpoint: () => 'https://hub/p',
    requestSetProfessionalDetails: async () => ({ ok: true }),
    getPricingRateEndpoint: () => 'https://hub/r',
    requestSetPricingRate: async () => ({ ok: true }),
    getSetAvailabilityEndpoint: () => 'https://hub/a',
    requestSetAvailability: async () => ({ ok: true }),
    getLanguagesCatalogEndpoint: () => 'https://hub/lc',
    requestLanguagesCatalog: async () => ({ ok: true, languages: [{ code: 'es', numId: 1 }, { code: 'en', numId: 2 }] }),
    getLanguagesEndpoint: () => 'https://hub/lg',
    requestSetLanguages: async () => ({ ok: true }),
    getUsageDiscoveredInventoryEndpoint: () => null,
    getCompleteOnboardingEndpoint: () => 'https://hub/c',
    requestCompleteOnboarding: async () => ({ ok: true }),
    getTalentProfileUrl: () => 'https://works.test/profile',
    getOnboardingInterviewsEndpoint: () => 'https://certs/iv',
    requestCreateOnboardingInterview: async () => ({ ok: true, interviewId: 'iv-1' }),
    requestStartLivekitSession: async () => ({ ok: true, interviewId: 'iv-1', livekitUrl: 'wss://lk', token: 'tk' }),
    requestCompleteLivekitSession: async () => ({ ok: true }),
    makeInterviewClient: () => ({ async connect() {}, async receiveTurn() { return { text: 'hola', ended: false }; }, async sendTurn() { return { text: 'fin', ended: true }; }, async disconnect() {} }),
    runMainRoleStep: async () => ({ ok: true, chosen: 'cluster-de' }),
    makeRolesDeps: () => ({}),
    ...overrides,
  };
}

function cliIo({ confirms = [true, true, false, true], onLogin = null } = {}) {
  const c = confirms.slice();
  const answers = ['https://linkedin.com/in/ada', '', 'https://github.com/ada', ''];
  return {
    lang: 'en',
    section() {},
    notify() {},
    success() {},
    error() {},
    warn() {},
    disclaimer() {},
    async ask() { return answers.shift() ?? ''; },
    async confirm() { return c.shift() ?? false; },
    async askSignUp() { if (onLogin) onLogin(); return { name: 'Ada', lastName: 'L', email: 't@t.com', password: 'password123' }; },
    async askWorkSituation() { return { situation: 'EMPLOYED', participation: 'FULL_TIME', opinion: 'OPEN_TO_FREELANCE', changeMotivators: 'HIGHER_RATE' }; },
    async askPricing() { return { fullTimeSelected: true, fullTimeAmount: '60000', fullTimeCurrency: 'EUR', partTimeSelected: true, partTimeAmount: '45', partTimeCurrency: 'EUR' }; },
    async askAvailability() { return { available: true, monthlyHours: '120', workModes: ['REMOTE'], country: 'es' }; },
    async askLanguages() { return [{ language: 'es', level: 'NATIVE' }, { language: 'en', level: 'ADVANCED' }]; },
    async runUsage() {},
    async interviewLoop({ open, turn }) { await open(); await turn('x'); return { ok: true }; },
  };
}

test('CLI register: one completed event per step it has, in funnel order, strictly increasing times, surface cli', async () => {
  const { funnel, requests, tick } = recordingFunnel({ surface: 'cli' });
  const deps = cliDeps({ requestSetPricingRate: async () => { tick(); return { ok: true }; } });
  const res = await flow.runOnboarding(cliIo(), deps, { funnel });
  assert.equal(res.ok, true);
  await funnel.idle();
  assert.deepEqual(completedSteps(requests), ['start', 'account_creation', 'import_sources', 'work_situation', 'availability', 'rates', 'languages', 'location', 'pre_interview', 'interview', 'supercluster']);
  const all = events(requests);
  assertStrictlyIncreasing(all);
  assert.ok(all.every((e) => e.properties.surface === 'cli' && e.device_id === 'device-1'));
  const byStep = Object.fromEntries(all.filter((e) => e.event_type === 'onboarding_step_completed').map((e) => [e.properties.step_name, e.properties]));
  assert.equal(byStep.account_creation.auth_method, 'email');
  assert.equal(byStep.account_creation.is_returning_account, false);
  assert.deepEqual(byStep.import_sources.sources_attempted, ['linkedin', 'github']);
  assert.deepEqual(byStep.import_sources.sources_connected, ['linkedin']);
  assert.equal(byStep.work_situation.work_situation, 'employed');
  assert.equal(byStep.availability.availability_hours_per_week, 30);
  assert.deepEqual(byStep.rates.rate_types_selected, ['hourly', 'annual']);
  assert.equal(byStep.rates.rate_currency, 'EUR');
  assert.equal(JSON.stringify(byStep.rates).includes('60000'), false, 'never an exact rate');
  assert.equal(JSON.stringify(byStep.rates).includes('45'), false, 'never an exact rate');
  assert.deepEqual(byStep.languages.languages, ['es', 'en']);
  assert.equal(byStep.languages.languages_count, 2);
  assert.deepEqual([byStep.location.location_country, byStep.location.location_method, byStep.location.is_remote_only], ['es', 'manual', true]);
  assert.equal(byStep.pre_interview.interview_choice, 'start_now');
  assert.equal(byStep.supercluster.supercluster, 'cluster-de');
  const imports = all.filter((e) => e.event_type.startsWith('source_import_'));
  assert.deepEqual(imports.map((e) => [e.event_type, e.properties.source_type]), [
    ['source_import_started', 'linkedin'], ['source_import_started', 'github'],
    ['source_import_completed', 'linkedin'], ['source_import_failed', 'github'],
  ]);
  assert.equal(imports[3].properties.failure_reason, 'source.not_found');
});

test('CLI register: steps 4-8 go out in ONE request, after languages, although pricing is saved before availability', async () => {
  const { funnel, requests } = recordingFunnel({ surface: 'cli' });
  await flow.runOnboarding(cliIo(), cliDeps(), { funnel });
  await funnel.idle();
  const batch = requests.find((r) => r.events.some((e) => e.properties.step_name === 'rates'));
  assert.deepEqual(batch.events.filter((e) => e.event_type === 'onboarding_step_completed').map((e) => e.properties.step_index), [4, 5, 6, 7, 8]);
});

test('CLI register: events before the account are buffered and flushed together with it, right after login', async () => {
  const { funnel, requests } = recordingFunnel({ surface: 'cli' });
  let atSignUp = null;
  const io = cliIo({ onLogin: () => { atSignUp = requests.length; } });
  await flow.runOnboarding(io, cliDeps(), { funnel });
  await funnel.idle();
  assert.equal(atSignUp, 0, 'nothing sent while the account form is open');
  assert.deepEqual(requests[0].events.map((e) => `${e.event_type}:${e.properties.step_name}`), [
    'onboarding_step_completed:start', 'onboarding_step_viewed:account_creation', 'onboarding_step_completed:account_creation',
  ]);
});

test('CLI register: declined steps are skipped, not completed, and the alta stands when every send fails', async () => {
  const { funnel, requests } = recordingFunnel({ surface: 'cli' });
  const res = await flow.runOnboarding(cliIo({ confirms: [false, false, false, false] }), cliDeps(), { funnel });
  await funnel.idle();
  assert.equal(res.ok, true);
  const skipped = events(requests).filter((e) => e.event_type === 'onboarding_step_skipped').map((e) => e.properties.step_name);
  assert.deepEqual(skipped, ['availability', 'languages', 'location']);
  assert.equal(completedSteps(requests).includes('availability'), false);
  assert.equal(events(requests).find((e) => e.properties.step_name === 'pre_interview' && e.event_type === 'onboarding_step_completed').properties.interview_choice, 'skip');

  const broken = createFunnel({ surface: 'cli', hubToken: () => 'hub', deviceId: () => null, endpoint: () => 'https://hub.test/e', send: async () => { throw new Error('down'); } });
  const again = await flow.runOnboarding(cliIo(), cliDeps(), { funnel: broken });
  assert.equal(again.ok, true);
  assert.equal(again.completed, 'interview');
});

const ES = signupCopy('es');
const DRAFT = { name: 'Ada Lovelace', role: 'Data Engineer', city: 'Madrid', country: 'ES', situation: 'EMPLOYED', participation: 'FULL_TIME', languages: 'Español nativo', workMode: 'Remoto', monthlyHours: '120', hourlyRate: 45, annualRate: 60000, sources: ['linkedin', 'cv'] };

function mcpHarness(funnel) {
  let session = null;
  const win = { finish: null };
  const tools = makeSignupTools({
    lang: 'es',
    funnel,
    flowDeps: {
      loadAuthSession: () => session,
      sessionStatus: (s) => (s ? 'active' : 'none'),
      saveAuthSession: () => {},
      getTalentProfileUrl: () => 'https://works.test/login',
      getProfessionalDetailsEndpoint: () => 'https://hub/p',
      requestSetProfessionalDetails: async () => ({ ok: true }),
      getPricingRateEndpoint: () => 'https://hub/r',
      requestSetPricingRate: async () => ({ ok: true }),
      getSetAvailabilityEndpoint: () => 'https://hub/a',
      requestSetAvailability: async () => ({ ok: true }),
      getLanguagesCatalogEndpoint: () => 'https://hub/lc',
      requestLanguagesCatalog: async () => ({ ok: true, languages: [{ code: 'es', numId: 1 }] }),
      getLanguagesEndpoint: () => 'https://hub/lg',
      requestSetLanguages: async () => ({ ok: true }),
    },
    runLoopbackAuth: (args, options) => {
      options.onUrl('http://127.0.0.1:5555/');
      return new Promise((resolve) => { win.finish = (o) => { session = { accessToken: 'jwt', hubAccessToken: 'jwt', email: 'ada@gmail.com', expiresAt: '2999-01-01T00:00:00.000Z' }; resolve(o); }; });
    },
    requestMcpSignup: async () => ({ ok: true, claimCode: 'CODE' }),
    requestMyImportStatus: async () => ({ ok: true, state: 'done', sources: { linkedin: { state: 'done' } } }),
    getMcpSignupEndpoint: () => 'https://hub.test/s',
    getMyImportStatusEndpoint: () => 'https://hub.test/i',
    checkOnboardingCompleted: async () => false,
    openBrowser: () => {},
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
  });
  return { tools: Object.fromEntries(tools.map((t) => [t.name, t])), win };
}

test('MCP sign-up: steps 1-3 wait for the account; steps 4-8 go out in one request when save_profile_details succeeds, after account_creation', async () => {
  resetSignupLanguage();
  const { funnel, requests, tick } = recordingFunnel({ surface: 'mcp' });
  funnel.setMcpClient('ChatGPT');
  const { tools, win } = mcpHarness(funnel);
  await tools.signup_start.handler({ language: 'es', answer: undefined }, {});
  await tools.signup_start.handler({ language: 'es', answer: ES.cvSearch }, {});
  tick();
  await tools.signup_email.handler({ email: 'ada@gmail.com', typed: true });
  await tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk }, {});
  tick();
  await tools.signup_create_account.handler({ linkedinUrl: 'https://www.linkedin.com/in/ada' });
  assert.equal(requests.length, 0, 'nothing before the account exists');
  tick();
  win.finish({ ok: true, email: 'ada@gmail.com', claimed: true });
  await new Promise((resolve) => setImmediate(resolve));
  await funnel.idle();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].events.filter((e) => e.event_type === 'onboarding_step_completed').map((e) => e.properties.step_name), ['start', 'account_creation', 'import_sources']);
  const account = requests[0].events.find((e) => e.event_type === 'onboarding_step_completed' && e.properties.step_name === 'account_creation');
  assert.deepEqual([account.properties.auth_method, account.properties.is_returning_account], ['email', false]);
  assertStrictlyIncreasing(requests[0].events);

  await tools.signup_status.handler({});
  await funnel.idle();
  assert.ok(events(requests).some((e) => e.event_type === 'source_import_completed' && e.properties.source_type === 'linkedin'));

  assert.equal(completedSteps(requests).includes('work_situation'), false, 'not at draft-confirm time');
  const saved = await tools.save_profile_details.handler({
    workSituation: { situation: 'EMPLOYED', participation: 'FULL_TIME', opinion: 'OPEN_TO_FREELANCE', changeMotivators: 'HIGHER_RATE' },
    pricing: { hourlyRate: 45, annualRate: 60000 },
    availability: { monthlyHours: '120', workModes: ['REMOTE'], country: 'ES' },
    languages: [{ language: 'es', level: 'NATIVE' }],
  });
  assert.equal(saved.ok, true);
  await funnel.idle();
  const batch = requests[requests.length - 1].events;
  assert.deepEqual(batch.map((e) => e.properties.step_name), ['work_situation', 'availability', 'rates', 'languages', 'location']);
  const all = events(requests);
  assertStrictlyIncreasing(all);
  const accountTime = all.find((e) => e === account).time;
  assert.ok(batch.every((e) => e.time > accountTime));
  assert.ok(all.every((e) => e.properties.surface === 'mcp' && e.properties.mcp_client === 'chatgpt'));
  const props = Object.fromEntries(batch.map((e) => [e.properties.step_name, e.properties]));
  assert.equal(props.work_situation.work_situation, 'employed');
  assert.equal(props.work_situation.was_edited, false);
  assert.deepEqual([props.location.location_country, props.location.location_method], ['es', 'prefilled']);
  assert.deepEqual(props.rates.rate_types_selected, ['hourly', 'annual']);
  assert.equal(props.rates.rate_currency, 'EUR');
  assert.equal(props.rates.is_prefilled, true, 'estimated by the AI, not given by the talent');
  assert.deepEqual(props.languages.languages, ['es']);

  await tools.save_profile_details.handler({ pricing: { hourlyRate: 45, annualRate: 60000 } });
  await funnel.idle();
  assert.equal(completedSteps(requests).filter((s) => s === 'rates').length, 1, 'a re-save never repeats a step');
});

test('MCP sign-up: a section that failed to save emits nothing for its step', async () => {
  resetSignupLanguage();
  const { funnel, requests } = recordingFunnel({ surface: 'mcp' });
  const { tools, win } = mcpHarness(funnel);
  await tools.signup_start.handler({ language: 'es', cvPath: '/tmp/cv.pdf' }, {});
  await tools.signup_email.handler({ email: 'ada@gmail.com', typed: true });
  await tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk }, {});
  await tools.signup_create_account.handler({ linkedinUrl: 'https://www.linkedin.com/in/ada' });
  win.finish({ ok: true, email: 'ada@gmail.com', claimed: true });
  await new Promise((resolve) => setImmediate(resolve));
  await tools.save_profile_details.handler({ workSituation: { situation: 'EMPLOYED' }, pricing: { hourlyRate: 45 } });
  await funnel.idle();
  const steps = completedSteps(requests);
  assert.equal(steps.includes('work_situation'), false, 'participation missing: refused, so not completed');
  assert.ok(steps.includes('rates'));
});

test('MCP interview and main role: emitted only while a sign-up of this process runs', async () => {
  const { funnel, requests } = recordingFunnel({ surface: 'mcp' });
  const register = Object.fromEntries(makeRegisterTools({ lang: 'es', funnel, checkOnboardingCompleted: async () => false }).map((t) => [t.name, t]));
  const roles = Object.fromEntries(makeRoleTools({
    lang: 'es',
    funnel,
    loadAuthSession: () => ({ hubAccessToken: 'hub' }),
    sessionStatus: () => 'active',
    getSetMainRoleEndpoint: () => 'https://hub/m',
    requestSetMainRole: async () => ({ ok: true }),
  }).map((t) => [t.name, t]));

  await register.onboarding_interview_start.handler({ where: 'later' }, {});
  await roles.set_main_role.handler({ clusterId: 'cl-1' }, {});
  funnel.begin();
  await funnel.identified();
  assert.equal(events(requests).length, 0, 'no sign-up running: nothing recorded');

  await register.onboarding_interview_start.handler({ where: 'later' }, {});
  await roles.set_main_role.handler({ clusterId: 'cl-1', catalogue: false }, {});
  await funnel.idle();
  const completed = events(requests).filter((e) => e.event_type === 'onboarding_step_completed');
  assert.deepEqual(completed.map((e) => [e.properties.step_name, e.properties.interview_choice || e.properties.supercluster]), [['pre_interview', 'skip'], ['supercluster', 'cl-1']]);
});

test('signup_draft shows the work situation and the location (city and country) in the talent\'s language', async () => {
  resetSignupLanguage();
  for (const lang of ['es', 'en']) {
    resetSignupLanguage();
    const shown = [];
    const tools = Object.fromEntries(makeSignupTools({ lang, flowDeps: { loadAuthSession: () => null, sessionStatus: () => 'none' } }).map((t) => [t.name, t]));
    await tools.signup_start.handler({ language: lang, answer: undefined }, {});
    const res = await tools.signup_draft.handler({ ...DRAFT }, { elicit: async ({ message }) => { shown.push(message); return { action: 'cancel' }; }, elicitation: true });
    const text = [...shown, JSON.stringify(res)].join('\n');
    const c = signupCopy(lang);
    assert.ok(text.includes(needle(c.situationLabels.EMPLOYED)), `${lang}: situation label`);
    assert.ok(text.includes(needle(c.participationLabels.FULL_TIME)), `${lang}: participation label`);
    assert.ok(text.includes(needle(c.keptLabels.workSituation)), `${lang}: the work situation is named`);
    assert.ok(text.includes(lang === 'es' ? 'Madrid, España' : 'Madrid, Spain'), `${lang}: city and country name`);
  }
});

test('draft labels exist for every work-situation and participation code, in every sign-up language', () => {
  const { WORK_SITUATIONS, EMPLOYMENT_PARTICIPATIONS } = flow;
  for (const lang of require('../src/signup-copy').SIGNUP_LANGUAGES) {
    const c = signupCopy(lang);
    assert.deepEqual(Object.keys(c.situationLabels).sort(), [...WORK_SITUATIONS].sort(), lang);
    assert.deepEqual(Object.keys(c.participationLabels).sort(), [...EMPLOYMENT_PARTICIPATIONS].sort(), lang);
  }
});
