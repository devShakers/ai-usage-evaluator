'use strict';

// Closed questions of the MCP sign-up: a dialog when the client declares elicitation, options in the chat otherwise.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeAiUsageTool } = require('../src/mcp-ai-usage-tool');
const { makeSignupTools } = require('../src/mcp-signup-tools');
const { makeRegisterTools } = require('../src/mcp-register-tools');
const { makeRoleTools } = require('../src/mcp-role-tools');
const { normalizeRole } = require('../src/roles-client');
const { signupCopy, legalCopy } = require('../src/signup-copy');
const { resetSignupLanguage, fixSignupLanguage } = require('../src/signup-language');

const ES = signupCopy('es');
const EN = signupCopy('en');
const LEGAL_ES = legalCopy('es');

test.beforeEach(() => resetSignupLanguage());
const tick = () => new Promise((resolve) => setImmediate(resolve));
const resultOf = (msg) => JSON.parse(msg.result.content[0].text);

// A scripted talent: each dialog gets the next reply and is recorded.
function dialogs(...replies) {
  const asked = [];
  return { asked, ctx: { elicitation: true, elicit: async (params) => { asked.push(params); return replies.shift(); } } };
}
const pick = (choice) => ({ action: 'accept', content: { choice } });

function usageTool(phase = 'account') {
  const calls = { scans: 0, consent: [] };
  const tool = makeAiUsageTool({
    signupPhase: () => phase,
    scanUsage: () => { calls.scans += 1; return new Promise(() => {}); },
    loadAuthSession: () => null,
    sessionStatus: () => 'none',
    recordConsent: (decision) => calls.consent.push(decision),
  });
  return { tool, calls };
}

test('ai_usage step: no dialog before the disclaimers were shown; then the yes in the dialog starts the scan in the background at once', async () => {
  const { tool, calls } = usageTool();
  const d = dialogs(pick(ES.aiUsageYes));
  const first = await tool.handler({ lang: 'es' }, d.ctx);
  assert.equal(first.reason, 'consent-required');
  assert.deepEqual(first.relayVerbatim, [LEGAL_ES.usageInfoAccessed, LEGAL_ES.usageGoalDuration]);
  assert.equal(d.asked.length, 0, 'the disclaimers come before any dialog');
  assert.equal(calls.scans, 0);
  const yes = await tool.handler({ lang: 'es', disclaimersShown: true }, d.ctx);
  assert.equal(d.asked[0].message, ES.aiUsageQuestion);
  assert.deepEqual(d.asked[0].requestedSchema.properties.choice.enum, ['Sí, analízalo', 'Saltar este paso']);
  assert.equal(yes.background, true);
  assert.equal(yes.scope.mode, 'all', 'the sign-up looks at the whole machine');
  await tick();
  await tick();
  assert.equal(calls.scans, 1);
});

test('ai_usage step: skipping in the dialog records the denial, relays the skip line, and a later granted:true cannot override it', async () => {
  const { tool, calls } = usageTool();
  const d = dialogs(pick(ES.aiUsageSkip));
  const no = await tool.handler({ lang: 'es', disclaimersShown: true }, d.ctx);
  assert.equal(no.reason, 'consent-declined');
  assert.equal(no.relayVerbatim, ES.aiUsageSkipped);
  assert.deepEqual(calls.consent, ['denied']);
  const forced = await tool.handler({ lang: 'es', consent: { granted: true } }, d.ctx);
  assert.equal(forced.reason, 'consent-declined');
  assert.equal(calls.scans, 0);
});

test('ai_usage step: a closed dialog returns the question without repeating the disclaimers; a chat client gets both, in the talent\'s language', async () => {
  const { tool, calls } = usageTool();
  for (const ctx of [dialogs({ action: 'cancel' }).ctx, dialogs({ action: 'decline' }).ctx]) {
    const r = await tool.handler({ lang: 'es', disclaimersShown: true }, ctx);
    assert.equal(r.reason, 'consent-required');
    assert.equal(r.question, ES.aiUsageQuestion);
    assert.equal(r.relayVerbatim, undefined);
  }
  fixSignupLanguage('en');
  const chat = await tool.handler({ lang: 'es' }, {});
  assert.deepEqual(chat.relayVerbatim, [legalCopy('en').usageInfoAccessed, legalCopy('en').usageGoalDuration]);
  assert.equal(chat.question, EN.aiUsageQuestion);
  assert.deepEqual(chat.options, ['Yes, analyse it', 'Skip this step']);
  assert.match(chat.message, /numbered list/);
  assert.deepEqual(calls.consent, [], 'closing the dialog is not a no');
  assert.equal(calls.scans, 0);
});

function signupTools() {
  const sent = [];
  const tools = Object.fromEntries(makeSignupTools({
    lang: 'es',
    flowDeps: { loadAuthSession: () => null, sessionStatus: () => 'none', saveAuthSession: () => {}, getTalentProfileUrl: () => 'https://works.test/login' },
    runLoopbackAuth: (_args, options) => { options.onUrl('http://127.0.0.1:5555/'); return new Promise(() => {}); },
    requestMcpSignup: async (body) => { sent.push(body); return { ok: true, claimCode: 'CODE', claimCodeExpiresAt: 'x' }; },
    getMcpSignupEndpoint: () => 'https://hub.test/s',
    checkOnboardingCompleted: async () => false,
    openBrowser: () => {},
    sleep: (ms) => (ms >= 1000 ? new Promise(() => {}) : tick()),
  }).map((t) => [t.name, t]));
  return { tools, sent };
}
const DRAFT = { name: 'Ada Lovelace', role: 'Data Engineer', hourlyRate: 45 };

test('welcome: a dialog client shows the welcome first, then the dialog asks the one question', async () => {
  const { tools } = signupTools();
  const d = dialogs(pick(ES.cvSearch));
  const first = await tools.signup_start.handler({ language: 'es' }, d.ctx);
  assert.equal(first.reason, 'show-first');
  assert.deepEqual(first.relayVerbatim, [ES.welcome(null)]);
  assert.equal(d.asked.length, 0);
  const answered = await tools.signup_start.handler({ shown: true }, d.ctx);
  assert.equal(d.asked[0].message, ES.welcomeQuestion);
  assert.deepEqual(d.asked[0].requestedSchema.properties.choice.enum, ['Sí, búscalo', 'Te lo adjunto yo']);
  assert.equal(answered.step, 'cv-search');
});

test('email: a known email is asked in a dialog with its two options; the open question is never a dialog', async () => {
  const { tools } = signupTools();
  await tools.signup_start.handler({ language: 'es' });
  const d = dialogs(pick(ES.emailYes));
  const r = await tools.signup_email.handler({ email: 'ada@gmail.com' }, d.ctx);
  assert.equal(d.asked[0].message, ES.emailKnown('ada@gmail.com'));
  assert.deepEqual(d.asked[0].requestedSchema.properties.choice.enum, ['Sí, ese', 'Usar otro']);
  assert.equal(r.email, 'ada@gmail.com');
  const other = await tools.signup_email.handler({ email: 'ada@gmail.com' }, dialogs(pick(ES.emailOther)).ctx);
  assert.equal(other.relayVerbatim, ES.emailUnknown);
  const none = dialogs();
  await tools.signup_email.handler({}, none.ctx);
  assert.equal(none.asked.length, 0);
});

test('draft: the dialog asks for confirmation only after the draft and the notice were shown; nothing is sent before it', async () => {
  const { tools, sent } = signupTools();
  await tools.signup_start.handler({ language: 'es' });
  const d = dialogs(pick(ES.draftOk));
  const first = await tools.signup_draft.handler(DRAFT, d.ctx);
  assert.equal(first.reason, 'show-first');
  assert.equal(first.relayVerbatim[1], LEGAL_ES.signupNotice);
  assert.equal(d.asked.length, 0);
  const ok = await tools.signup_draft.handler({ ...DRAFT, shown: true }, d.ctx);
  assert.equal(d.asked[0].message, ES.draftQuestion);
  assert.equal(ok.relayVerbatim, ES.windowOpening);
  assert.equal(sent.length, 0);
  await tools.signup_create_account.handler({ windowAnnounced: true, linkedinUrl: 'https://www.linkedin.com/in/ada' });
  assert.equal(sent.length, 1);
});

test('draft: a closed dialog falls back to the question in the chat, without the draft again', async () => {
  const { tools } = signupTools();
  await tools.signup_start.handler({ language: 'es' });
  const r = await tools.signup_draft.handler({ ...DRAFT, shown: true }, dialogs({ action: 'cancel' }).ctx);
  assert.equal(r.reason, 'answer-required');
  assert.equal(r.dismissed, 'cancel');
  assert.equal(r.relayVerbatim, undefined);
  assert.deepEqual(r.options, [ES.draftOk, ES.draftChange]);
});

function interviewTools() {
  const started = [];
  const flowDeps = {
    loadAuthSession: () => ({ accessToken: 'tok', hubAccessToken: 'hub', email: 't@t.com', userId: '11111111-2222-3333-4444-555555555555' }),
    sessionStatus: () => 'active',
    getOnboardingInterviewsEndpoint: () => 'https://certs/interviews',
    requestCreateOnboardingInterview: async () => { started.push('create'); return { ok: true, interviewId: 'iv-1', created: true }; },
    requestStartLivekitSession: async () => ({ ok: true, interviewId: 'iv-1', livekitUrl: 'wss://x', token: 't', roomName: 'r', closingMessage: null }),
    makeInterviewClient: () => ({ async connect() {}, async receiveTurn() { return { text: 'hola', ended: false }; }, async disconnect() {} }),
  };
  const tools = makeRegisterTools({ lang: 'es', flowDeps, checkOnboardingCompleted: async () => false });
  return { start: tools.find((t) => t.name === 'onboarding_interview_start'), started };
}

test('interview: the dialog asks here or later first; later skips it, here hands over the disclaimers', async () => {
  const { start } = interviewTools();
  const later = dialogs(pick(ES.interviewLater));
  const r = await start.handler({}, later.ctx);
  assert.equal(r.reason, 'interview-later');
  assert.equal(r.relayVerbatim, undefined);
  assert.equal(later.asked[0].message, ES.interviewWhereQuestion);
  assert.deepEqual(later.asked[0].requestedSchema.properties.choice.enum, ['Aquí ahora', 'Luego en la web']);
  const here = await start.handler({}, dialogs(pick(ES.interviewHere)).ctx);
  assert.equal(here.reason, 'disclaimers-not-acknowledged');
  assert.deepEqual(here.relayVerbatim, [LEGAL_ES.interviewInfoAccessed, LEGAL_ES.interviewGoalDuration]);
  assert.equal(here.where, undefined);
});

test('interview: without a dialog the disclaimers come with the where question and its options; where:"later" skips it', async () => {
  const { start } = interviewTools();
  const r = await start.handler({}, {});
  assert.equal(r.reason, 'disclaimers-not-acknowledged');
  assert.deepEqual(r.where.options, [ES.interviewHere, ES.interviewLater]);
  assert.match(r.message, /First ask `where.question`/);
  assert.equal((await start.handler({ where: 'later' }, {})).reason, 'interview-later');
  assert.equal((await start.handler({ where: 'here' }, dialogs().ctx)).where, undefined);
});

test('interview: the answer mode is asked with three options before the room opens, and comes back with the greeting', async () => {
  const { start, started } = interviewTools();
  fixSignupLanguage('es');
  const d = dialogs(pick(ES.answerModeFull));
  const r = await start.handler({ disclaimerAcknowledged: true }, d.ctx);
  assert.deepEqual(d.asked[0].requestedSchema.properties.choice.enum, ['Propónmelas tú', 'Las contesto yo', 'Hazla entera']);
  assert.equal(r.ok, true);
  assert.equal(r.answerMode, 'full');
  const chat = interviewTools();
  const asked = await chat.start.handler({ disclaimerAcknowledged: true }, {});
  assert.equal(asked.reason, 'answer-mode-required');
  assert.deepEqual(asked.options, [ES.answerModeDrafted, ES.answerModeOwn, ES.answerModeFull]);
  assert.deepEqual(chat.started, [], 'no interview is created before the answer mode');
  assert.equal(started.length, 1);
  assert.equal((await chat.start.handler({ disclaimerAcknowledged: true, answerMode: 'drafted' }, {})).answerMode, 'drafted');
});

const IMPORT = { clusterId: 'backend', clusterName: 'Backend Developer', category: 'tech', type: 'RECOMMENDED', source: 'IMPORT' };
const INTERVIEW = { clusterId: 'ai-eng', clusterName: 'AI Engineer', category: 'tech', type: 'RECOMMENDED', source: 'ONBOARDING_INTERVIEW' };

function roleTools(clusters = [IMPORT, INTERVIEW]) {
  const calls = { added: [], main: [] };
  const tools = makeRoleTools({
    lang: 'es',
    loadAuthSession: () => ({ accessToken: 'c', hubAccessToken: 'h' }),
    sessionStatus: () => 'active',
    getAvailableRolesEndpoint: () => 'https://hub/available',
    getSetMainRoleEndpoint: () => 'https://hub/main',
    getAssignedClustersEndpoint: () => 'https://hub/assigned',
    getMyCertificationsEndpoint: () => 'https://hub/certs',
    requestMeCertifications: async () => ({ ok: true, mainRole: null, growingInto: [] }),
    requestAssignedClusters: async () => ({ ok: true, clusters: clusters.map(normalizeRole) }),
    requestAvailableRoles: async () => ({ ok: true, roles: [{ clusterId: 'pm', name: 'Product Manager', category: 'product' }, { clusterId: 'qa', name: 'QA Engineer', category: 'tech' }] }),
    requestAddGrowthRole: async ({ clusterId }) => { calls.added.push(clusterId); return { ok: true }; },
    requestSetMainRole: async ({ clusterId }) => { calls.main.push(clusterId); return { ok: true }; },
    completedOnboardingInterview: () => null,
    countOpenPositions: async ({ clusterId }) => ({ ok: true, total: { backend: 12, 'ai-eng': 0 }[clusterId] }),
  });
  return { set: tools.find((t) => t.name === 'set_main_role'), calls };
}

test('main role: shows why each recommended role fits and its open projects, then the dialog offers one option per role plus the catalogue', async () => {
  const { set, calls } = roleTools();
  const d = dialogs(pick('Backend Developer'));
  const evidence = { backend: '8 años con Node', 'ai-eng': 'agentes en producción' };
  const shown = await set.handler({ evidence }, d.ctx);
  assert.equal(shown.reason, 'show-first');
  assert.equal(shown.relayVerbatim[0], [
    ES.rolesIntro,
    '**AI Engineer** (recomendado)\nPor lo que me contaste en la entrevista: agentes en producción',
    '**Backend Developer**\nPor tu CV y tu LinkedIn: 8 años con Node\nAhora mismo hay 12 proyectos abiertos que buscan este perfil.',
    ES.rolesOutro,
  ].join('\n\n'));
  assert.equal(d.asked.length, 0);
  const r = await set.handler({ evidence, shown: true }, d.ctx);
  assert.equal(d.asked[0].message, ES.mainRoleQuestion);
  assert.deepEqual(d.asked[0].requestedSchema.properties.choice.enum, ['AI Engineer', 'Backend Developer', ES.mainRoleOther]);
  assert.deepEqual(r, { ok: true, clusterId: 'backend', name: 'Backend Developer' });
  assert.deepEqual(calls, { added: [], main: ['backend'] });
});

test('main role: the catalogue option asks again from the catalogue, then adds and sets the role; nothing recommended goes straight there', async () => {
  const other = roleTools();
  const d = dialogs(pick(ES.mainRoleOther), pick('QA Engineer'));
  await other.set.handler({ shown: true }, d.ctx);
  assert.deepEqual(d.asked[1].requestedSchema.properties.choice.enum, ['Product Manager', 'QA Engineer']);
  assert.deepEqual(other.calls, { added: ['qa'], main: ['qa'] });
  const none = roleTools([]);
  const n = dialogs(pick('Product Manager'));
  await none.set.handler({}, n.ctx);
  assert.equal(n.asked.length, 1);
  assert.deepEqual(none.calls, { added: ['pm'], main: ['pm'] });
});

test('main role: without a dialog the roles text, the question and its options come back; the picked name is the answer', async () => {
  const { set, calls } = roleTools();
  const r = await set.handler({}, {});
  assert.equal(r.reason, 'answer-required');
  assert.match(r.relayVerbatim[0], /^Con todo lo que me has contado/);
  assert.deepEqual(r.options, ['AI Engineer', 'Backend Developer', ES.mainRoleOther]);
  assert.deepEqual(r.roles, [{ clusterId: 'ai-eng', name: 'AI Engineer' }, { clusterId: 'backend', name: 'Backend Developer' }]);
  assert.deepEqual(calls.main, []);
  assert.deepEqual(await set.handler({ answer: 'AI Engineer' }, {}), { ok: true, clusterId: 'ai-eng', name: 'AI Engineer' });
  await set.handler({ clusterId: 'pm', catalogue: true }, {});
  assert.deepEqual(calls, { added: ['pm'], main: ['ai-eng', 'pm'] });
});

test('main role: a failed open-projects count only leaves its line out', async () => {
  const tools = makeRoleTools({
    lang: 'es',
    loadAuthSession: () => ({ accessToken: 'c', hubAccessToken: 'h' }),
    sessionStatus: () => 'active',
    requestMeCertifications: async () => ({ ok: true, mainRole: null, growingInto: [] }),
    requestAssignedClusters: async () => ({ ok: true, clusters: [IMPORT].map(normalizeRole) }),
    completedOnboardingInterview: () => null,
    countOpenPositions: async () => { throw new Error('down'); },
  });
  const r = await tools.find((t) => t.name === 'set_main_role').handler({}, {});
  assert.equal(r.relayVerbatim[0], [ES.rolesIntro, '**Backend Developer** (recomendado)\nPor tu CV y tu LinkedIn', ES.rolesOutro].join('\n\n'));
});

test('instructions: a dialog client is told the tools ask the closed questions; a chat client gets the options to offer; both keep the flow order', () => {
  const { buildServerInstructions } = require('../bin/mcp');
  const dialog = buildServerInstructions({ elicitation: true });
  assert.match(dialog, /asked by the tools in a dialog once you have shown their texts/);
  const chat = buildServerInstructions({});
  assert.match(chat, /native choice buttons if you have them, otherwise as a short numbered list/);
  for (const text of [dialog, chat]) {
    const order = ['signup_start', 'signup_email', 'signup_draft', 'signup_create_account', 'update_existing_profile', 'ai_usage', 'onboarding_interview_start', 'set_main_role', 'open_web'].map((t) => text.indexOf(t));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), String(order));
    assert.match(text, /set_main_role without clusterId and with evidence/);
    assert.match(text, /onboarding_interview_start without disclaimerAcknowledged/);
  }
});

test('answer modes: drafted waits for approval unless the talent asks to answer everything, which is then said at the end, in the instructions and both interview tools', async () => {
  const { buildServerInstructions, buildServer } = require('../bin/mcp');
  for (const text of [buildServerInstructions({}), buildServerInstructions({ elicitation: true })]) {
    assert.match(text, /how they want to answer \(drafted, own, full\)/);
    assert.match(text, /send it only after the talent approves or edits it; only if they explicitly ask you to answer everything yourself \("hazla entera", "do it all"\), complete the remaining questions without per-answer approval and tell them at the end/);
  }
  const server = buildServer();
  const list = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const byName = Object.fromEntries(list.result.tools.map((t) => [t.name, t]));
  const start = byName.onboarding_interview_start;
  assert.match(start.description, /drafted: show each question VERBATIM with your proposed answer and send it only after the talent approves or edits it/);
  assert.match(start.description, /'hazla entera' or 'contéstalas tú todas'/);
  assert.deepEqual(start.inputSchema.properties.answerMode.enum, ['drafted', 'own', 'full']);
  const turn = byName.onboarding_interview_turn;
  assert.match(turn.description, /unless they explicitly asked you to answer the rest yourself \('hazla entera', 'contéstalas tú todas'\)/);
});

// The real stdio server, driven by a client that declares elicitation and by one that does not.
function stdioClient(capabilities) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-elicit-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'mcp.js')], {
    env: { ...process.env, SHAKERS_CLI_CONFIG_DIR: path.join(home, 'config'), SHAKERS_CLI_HOME_DIR: home, SHAKERS_LANG: 'es' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  const waiters = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      lines.push(JSON.parse(buffer.slice(0, nl)));
      buffer = buffer.slice(nl + 1);
      for (const w of waiters.splice(0)) w();
    }
  });
  const send = (msg) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  async function next(pred) {
    for (;;) {
      const i = lines.findIndex(pred);
      if (i !== -1) return lines.splice(i, 1)[0];
      await new Promise((resolve) => waiters.push(resolve));
    }
  }
  const close = () => new Promise((resolve) => { child.on('close', resolve); child.stdin.end(); });
  send({ id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities, clientInfo: { name: 'test', version: '1' } } });
  return { send, next, lines, close };
}

test('stdio e2e: a client with elicitation answers the AI-usage question in a dialog; one without gets it with its options', async () => {
  const dialog = stdioClient({ elicitation: {} });
  const init = await dialog.next((m) => m.id === 0);
  assert.match(init.result.instructions, /asked by the tools in a dialog/);
  dialog.send({ id: 1, method: 'tools/call', params: { name: 'ai_usage', arguments: { disclaimersShown: true, lang: 'es' } } });
  const req = await dialog.next((m) => m.method === 'elicitation/create');
  const lang = req.params.message === ES.aiUsageQuestion ? ES : EN;
  assert.equal(req.params.message, lang.aiUsageQuestion);
  assert.deepEqual(req.params.requestedSchema.properties.choice.enum, [lang.aiUsageYes, lang.aiUsageSkip]);
  dialog.send({ id: req.id, result: { action: 'accept', content: { choice: lang.aiUsageYes } } });
  assert.equal(resultOf(await dialog.next((m) => m.id === 1)).reason, 'consent-granted');
  await dialog.close();

  const chat = stdioClient({});
  const chatInit = await chat.next((m) => m.id === 0);
  assert.match(chatInit.result.instructions, /native choice buttons/);
  chat.send({ id: 1, method: 'tools/call', params: { name: 'ai_usage', arguments: { disclaimersShown: true, lang: 'es' } } });
  const r = resultOf(await chat.next((m) => m.id === 1));
  assert.equal(r.reason, 'consent-required');
  assert.ok([ES, EN].some((c) => r.options.join() === [c.aiUsageYes, c.aiUsageSkip].join()));
  assert.equal(chat.lines.filter((m) => m.method).length, 0, 'no request went to a client without elicitation');
  await chat.close();
});

test('main role: with nothing recommended, a chat client picks from the catalogue by name; the role is added, then set', async () => {
  const none = roleTools([]);
  const asked = await none.set.handler({}, {});
  assert.equal(asked.reason, 'main-role-choice-required');
  const r = await none.set.handler({ answer: 'QA Engineer' }, {});
  assert.deepEqual(r, { ok: true, clusterId: 'qa', name: 'QA Engineer' });
  assert.deepEqual(none.calls, { added: ['qa'], main: ['qa'] });
});
