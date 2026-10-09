'use strict';

// Failures a real model showed in the 39540 sign-up simulation: each test drives the tools the way that model did.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeSignupTools } = require('../src/mcp-signup-tools');
const { makeRegisterTools } = require('../src/mcp-register-tools');
const { makeRoleTools } = require('../src/mcp-role-tools');
const { makeAiUsageTool } = require('../src/mcp-ai-usage-tool');
const { normalizeRole } = require('../src/roles-client');
const { findCvCandidates } = require('../src/register-context');
const { signupCopy, legalCopy, renderDraft } = require('../src/signup-copy');
const { resetSignupLanguage, fixSignupLanguage } = require('../src/signup-language');
const { getCatalog } = require('../src/i18n');
const { takeNotices } = require('../src/mcp-choice');
const { needle } = require('../test-fixtures/copy-needle');

const ES = signupCopy('es');
const LEGAL_ES = legalCopy('es');
const SESSION = { accessToken: 'jwt', hubAccessToken: 'jwt', email: 'ada@example.com', expiresAt: '2999-01-01T00:00:00.000Z' };
const DRAFT = { name: 'Ada Lovelace', role: 'Data Engineer', city: 'Madrid', monthlyHours: '120', hourlyRate: 50, annualRate: 55000 };

test.beforeEach(() => { resetSignupLanguage(); takeNotices(); });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A client whose dialogs the talent never sees: headless clients cancel every elicitation.
function cancelling() {
  const asked = [];
  return { asked, ctx: { elicitation: true, elicit: async (params) => { asked.push(params); return { action: 'cancel' }; } } };
}

function accepting(choice) {
  const asked = [];
  return { asked, ctx: { elicitation: true, elicit: async (params) => { asked.push(params); return { action: 'accept', content: { choice } }; } } };
}

// What the talent reads: the block the model must print.
function printed(reply) {
  assert.equal(typeof reply.say, 'string', `no block to print in ${JSON.stringify(reply)}`);
  return reply.say;
}

function signupHarness(overrides = {}) {
  const calls = { opened: [], pricing: [], availability: [], languages: [], professional: [] };
  let session = overrides.session || null;
  let finish = null;
  const wakes = [];
  const flowDeps = {
    loadAuthSession: () => session,
    sessionStatus: (s) => (s ? 'active' : 'none'),
    saveAuthSession: () => {},
    getTalentProfileUrl: () => 'https://works.test/login',
    getImportProfileEndpoint: () => 'https://hub.test/import',
    requestImportProfile: async () => ({ ok: true, report: { outcome: 'ok', sources: [] } }),
    getProfessionalDetailsEndpoint: () => 'https://hub.test/pd',
    getPricingRateEndpoint: () => 'https://hub.test/pr',
    getSetAvailabilityEndpoint: () => 'https://hub.test/av',
    getLanguagesCatalogEndpoint: () => 'https://hub.test/langs',
    getLanguagesEndpoint: () => 'https://hub.test/my-langs',
    requestLanguagesCatalog: async () => ({ ok: true, languages: [{ code: 'es', numId: 1 }, { code: 'en', numId: 2 }] }),
    requestSetLanguages: async (p) => { calls.languages.push(p); return { ok: true }; },
    requestSetProfessionalDetails: async (p) => { calls.professional.push(p); return { ok: true }; },
    requestSetPricingRate: async (p) => { calls.pricing.push(p); return { ok: true }; },
    requestSetAvailability: async (p) => { calls.availability.push(p); return { ok: true }; },
  };
  const tools = Object.fromEntries(makeSignupTools({
    lang: 'es',
    flowDeps,
    runLoopbackAuth: (_args, options) => {
      options.onUrl('http://127.0.0.1:5555/');
      options.openBrowser('http://127.0.0.1:5555/');
      return new Promise((resolve) => { finish = resolve; });
    },
    requestMcpSignup: async () => ({ ok: true, claimCode: 'CODE', claimCodeExpiresAt: 'x' }),
    requestMyImportStatus: overrides.importStatus || (async () => ({ ok: true, state: 'running', sources: {} })),
    getMcpSignupEndpoint: () => 'https://hub.test/s',
    getMyImportStatusEndpoint: () => 'https://hub.test/st',
    checkOnboardingCompleted: async () => false,
    requestOneTimeToken: async () => ({ ok: true, token: 'OTT' }),
    getOneTimeTokenEndpoint: () => 'https://hub.test/ott',
    getOneTimeLoginUrl: (token) => `https://works.test/auth/one-time?token=${token}`,
    fetchPricingRate: overrides.fetchPricingRate || (async () => ({ ok: true, pricing: { partTimeSelected: true, partTimePrice: { amount: 45, currency: 'EUR' }, fullTimeSelected: false, fullTimePrice: null } })),
    fetchAvailability: overrides.fetchAvailability || (async () => ({ ok: true, availability: { available: true, monthlyHours: '80', workModes: [], country: null, timezone: 'Europe/Madrid', subdivision: null, longFullTimeProjects: null } })),
    fetchLanguages: overrides.fetchLanguages || (async () => ({ ok: true, languageCount: 2, languageCodes: ['es', 'en'] })),
    openBrowser: (url) => { calls.opened.push(url); },
    // Only the browser delay is held, so the test sees what happens before and after it.
    sleep: (ms) => (ms >= 1000 ? new Promise((resolve) => { wakes.push(resolve); }) : tick()),
  }).map((t) => [t.name, t]));
  return { tools, calls, finish: (o) => finish(o), elapse: () => wakes.splice(0).forEach((w) => w()), setSession: (s) => { session = s; } };
}

test('welcome: the model calls again with shown:true without printing anything; the welcome still comes with the question it must print', async () => {
  const { tools } = signupHarness();
  const d = cancelling();
  await tools.signup_start.handler({ language: 'es' }, d.ctx);
  const again = await tools.signup_start.handler({ language: 'es', shown: true }, d.ctx);
  const block = printed(again);
  assert.ok(block.startsWith(ES.welcome(null)), block);
  assert.ok(block.includes(ES.welcomeQuestion));
  assert.ok(block.includes(`1. ${ES.cvSearch}`) && block.includes(`2. ${ES.cvAttach}`));
});

test('welcome: a dialog carries the welcome with its question, and a chat client prints both as one block ending with the question', async () => {
  const { tools } = signupHarness();
  const d = accepting(ES.cvSearch);
  const r = await tools.signup_start.handler({ language: 'es' }, d.ctx);
  assert.equal(r.step, 'cv-search');
  assert.equal(d.asked[0].message, [ES.welcome(null), ES.welcomeQuestion].join('\n\n'));
  const chat = await signupHarness().tools.signup_start.handler({ language: 'es' }, {});
  assert.equal(printed(chat), [ES.welcome(null), ES.welcomeQuestion, `1. ${ES.cvSearch}\n2. ${ES.cvAttach}`].join('\n\n'));
  assert.doesNotMatch(chat.message, /shown:true/);
});

test('draft: a closed dialog still prints the draft and the data notice with the confirmation question', async () => {
  const { tools } = signupHarness();
  await tools.signup_start.handler({ language: 'es' });
  const d = cancelling();
  const r = await tools.signup_draft.handler({ ...DRAFT, shown: true }, d.ctx);
  const block = printed(r);
  assert.ok(block.startsWith(renderDraft('es', DRAFT)));
  assert.ok(block.includes(LEGAL_ES.signupNotice));
  assert.ok(block.indexOf(LEGAL_ES.signupNotice) < block.indexOf(ES.draftQuestion));
  assert.ok(d.asked[0].message.includes(LEGAL_ES.signupNotice), 'the dialog carries the notice too');
});

test('window: the warning comes inside the draft block the talent confirms; the account step only opens the window', async () => {
  const h = signupHarness();
  await h.tools.signup_start.handler({ language: 'es' });
  await h.tools.signup_email.handler({ email: 'ada@gmail.com', typed: true });
  const block = printed(await h.tools.signup_draft.handler(DRAFT, cancelling().ctx));
  assert.ok(block.includes(needle(ES.windowNotice)), block);
  assert.ok(block.indexOf(LEGAL_ES.signupNotice) < block.indexOf(ES.windowNotice));
  assert.ok(block.indexOf(ES.windowNotice) < block.indexOf(ES.draftQuestion));
  assert.ok(block.endsWith(`1. ${ES.draftOk}\n2. ${ES.draftChange}`));
  for (const lang of ['en', 'it', 'pt']) assert.equal(typeof signupCopy(lang).windowNotice, 'string');
  const ok = await h.tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk });
  assert.equal(ok.next, 'signup_create_account');
  const created = await h.tools.signup_create_account.handler({ linkedinUrl: 'https://www.linkedin.com/in/ada', firstName: 'Ada' });
  assert.equal(created.status, 'window-open');
  assert.equal(created.say, undefined, 'nothing left to print between the confirmation and the window');
  assert.doesNotMatch(created.message, /Print/);
  h.elapse();
  await tick();
  assert.deepEqual(h.calls.opened, ['http://127.0.0.1:5555/']);
});

function usageTool() {
  const calls = { scans: 0 };
  const tool = makeAiUsageTool({
    signupPhase: () => 'account',
    scanUsage: () => { calls.scans += 1; return new Promise(() => {}); },
    loadAuthSession: () => null,
    sessionStatus: () => 'none',
    recordConsent: () => {},
  });
  return { tool, calls };
}

test('ai_usage: the model calls with disclaimersShown:true without printing them; the two disclaimers still come before the question', async () => {
  const { tool, calls } = usageTool();
  const disclaimers = [LEGAL_ES.usageInfoAccessed, LEGAL_ES.usageGoalDuration];
  for (const ctx of [cancelling().ctx, {}]) {
    const r = await tool.handler({ lang: 'es', disclaimersShown: true }, ctx);
    assert.equal(r.reason, 'consent-required');
    assert.ok(printed(r).startsWith(disclaimers.join('\n\n')));
    assert.ok(printed(r).includes(ES.aiUsageQuestion));
  }
  const d = accepting(ES.aiUsageYes);
  await tool.handler({ lang: 'es' }, d.ctx);
  assert.equal(d.asked[0].message, [...disclaimers, ES.aiUsageQuestion].join('\n\n'));
  await tick();
  assert.equal(calls.scans, 1);
});

const IMPORT = { clusterId: 'backend', clusterName: 'Backend Developer', category: 'tech', type: 'RECOMMENDED', source: 'IMPORT' };

function roleTools(clusters, available = [{ clusterId: 'pm', name: 'Product Manager', category: 'product' }, { clusterId: 'qa', name: 'QA Engineer', category: 'tech' }], mainRole = null) {
  const calls = { main: [], added: [] };
  const tools = makeRoleTools({
    lang: 'es',
    loadAuthSession: () => ({ accessToken: 'c', hubAccessToken: 'h' }),
    sessionStatus: () => 'active',
    getAvailableRolesEndpoint: () => 'https://hub/available',
    getSetMainRoleEndpoint: () => 'https://hub/main',
    getAssignedClustersEndpoint: () => 'https://hub/assigned',
    getMyCertificationsEndpoint: () => 'https://hub/certs',
    requestMeCertifications: async () => ({ ok: true, mainRole, growingInto: [] }),
    requestAssignedClusters: async () => ({ ok: true, clusters: clusters.map(normalizeRole) }),
    requestAvailableRoles: async () => ({ ok: true, roles: available }),
    requestAddGrowthRole: async ({ clusterId }) => { calls.added.push(clusterId); return { ok: true }; },
    requestSetMainRole: async ({ clusterId }) => { calls.main.push(clusterId); return { ok: true }; },
    completedOnboardingInterview: () => null,
    countOpenPositions: async () => ({ ok: true, total: 3 }),
  });
  return { set: tools.find((t) => t.name === 'set_main_role'), list: tools.find((t) => t.name === 'list_my_roles'), calls };
}

test('main role: the reasons and open-projects lines come with the question even when the model skips printing them', async () => {
  const { set } = roleTools([IMPORT]);
  const r = await set.handler({ evidence: { backend: '8 años con Node' }, shown: true }, cancelling().ctx);
  const block = printed(r);
  assert.ok(block.includes('Por tu CV y tu LinkedIn: 8 años con Node'));
  assert.ok(block.includes('Ahora mismo hay 3 proyectos abiertos'));
  assert.ok(block.indexOf(ES.rolesOutro) < block.indexOf(ES.mainRoleQuestion));
});

test('main role: with nothing recommended the whole catalogue is never listed; the talent says their role and only the matches are offered', async () => {
  const catalogue = Array.from({ length: 40 }, (_, i) => ({ clusterId: `r${i}`, name: `Role ${i}`, category: 'tech' }))
    .concat([{ clusterId: 'ds', name: 'Data Scientist', category: 'data' }, { clusterId: 'de', name: 'Data Engineer', category: 'data' }]);
  const { set, calls } = roleTools([], catalogue);
  const ask = await set.handler({}, {});
  assert.ok(!ask.options || ask.options.length <= 5, `offered ${ask.options && ask.options.length} roles`);
  assert.ok(printed(ask).length < 400);
  const matches = await set.handler({ catalogue: true, answer: 'data scientist' }, {});
  assert.ok(matches.options.includes('Data Scientist'));
  assert.ok(matches.options.length <= 5);
  const picked = await set.handler({ catalogue: true, answer: 'Data Scientist' }, {});
  assert.equal(picked.clusterId, 'ds');
  assert.deepEqual(calls, { main: ['ds'], added: ['ds'] });
});

test('interview: "here" in a dialog asks how to answer with the disclaimers in that same dialog; a chat client prints them with that question', async () => {
  const flowDeps = {
    loadAuthSession: () => ({ ...SESSION, userId: '11111111-2222-3333-4444-555555555555' }),
    sessionStatus: () => 'active',
    getOnboardingInterviewsEndpoint: () => 'https://certs/interviews',
    requestCreateOnboardingInterview: async () => ({ ok: true, interviewId: 'iv-1', created: true }),
    requestStartLivekitSession: async () => ({ ok: true, interviewId: 'iv-1', livekitUrl: 'wss://x', token: 't', roomName: 'r', closingMessage: null }),
    makeInterviewClient: () => ({ async connect() {}, async receiveTurn() { return { text: 'hola', ended: false }; }, async disconnect() {} }),
  };
  const start = makeRegisterTools({ lang: 'es', flowDeps, checkOnboardingCompleted: async () => false }).find((t) => t.name === 'onboarding_interview_start');
  fixSignupLanguage('es');
  const replies = [ES.interviewHere, ES.answerModeDrafted];
  const asked = [];
  const ctx = { elicitation: true, elicit: async (p) => { asked.push(p); return { action: 'accept', content: { choice: replies.shift() } }; } };
  const r = await start.handler({ disclaimerAcknowledged: false }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(asked[1].message, [LEGAL_ES.interviewInfoAccessed, LEGAL_ES.interviewGoalDuration, ES.answerModeQuestion].join('\n\n'));
  const chat = await start.handler({ disclaimerAcknowledged: false, where: 'here' }, {});
  assert.ok(printed(chat).startsWith([LEGAL_ES.interviewInfoAccessed, LEGAL_ES.interviewGoalDuration, ES.answerModeQuestion].join('\n\n')));
});

test('CV search: an unknown name is no mismatch, and the message says to read the most likely candidate', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-sim-'));
  fs.mkdirSync(path.join(home, 'Documents'));
  fs.writeFileSync(path.join(home, 'Documents', 'CV_Irene_Calvo.pdf'), '%PDF');
  const [candidate] = findCvCandidates(home, '');
  assert.equal(candidate.nameMatch, null);
  assert.equal(findCvCandidates(home, 'Irene Calvo')[0].nameMatch, true);
  const suggest = makeRegisterTools({ lang: 'es', readRegisterContextSuggestions: () => ({ cvCandidates: [candidate] }) }).find((t) => t.name === 'suggest_register_context');
  const r = await suggest.handler({});
  assert.match(r.message, /read_cv/);
  assert.match(r.message, /nameMatch:null/);
});

function interviewStart({ startSession, receiveTurn, sendTurn, complete, lang = 'es' } = {}) {
  const disconnects = [];
  const flowDeps = {
    loadAuthSession: () => ({ ...SESSION, userId: '11111111-2222-3333-4444-555555555555' }),
    sessionStatus: () => 'active',
    getOnboardingInterviewsEndpoint: () => 'https://certs/interviews',
    requestCreateOnboardingInterview: async () => ({ ok: true, interviewId: 'iv-1', created: true }),
    requestStartLivekitSession: startSession || (async () => ({ ok: true, interviewId: 'iv-1', livekitUrl: 'wss://x', token: 't', roomName: 'r', closingMessage: null })),
    requestCompleteLivekitSession: complete || (async () => ({ ok: true })),
    makeInterviewClient: () => ({
      async connect() {},
      receiveTurn: receiveTurn || (async () => ({ text: 'hola', ended: false })),
      sendTurn: sendTurn || (async () => ({ text: 'siguiente', ended: false })),
      async disconnect() { disconnects.push(1); },
    }),
  };
  const tools = makeRegisterTools({ lang, flowDeps, checkOnboardingCompleted: async () => false, interviewTimeoutMs: 50 });
  return { start: tools.find((t) => t.name === 'onboarding_interview_start'), turn: tools.find((t) => t.name === 'onboarding_interview_turn'), disconnects };
}

const WEB_FALLBACK = (r) => {
  assert.equal(r.ok, false);
  assert.equal(r.relayVerbatim, ES.livekitUnavailable);
  assert.equal(r.next, 'open_web');
};

test('interview: a start that never answers ends within the timeout with the web fallback', async () => {
  fixSignupLanguage('es');
  const { start } = interviewStart({ startSession: () => new Promise(() => {}) });
  WEB_FALLBACK(await start.handler({ disclaimerAcknowledged: true, answerMode: 'own' }, {}));
});

test('interview: a greeting turn-timeout is the web fallback, not a bare reason', async () => {
  fixSignupLanguage('es');
  const { start, disconnects } = interviewStart({ receiveTurn: async () => { throw Object.assign(new Error('t'), { kind: 'turn-timeout' }); } });
  WEB_FALLBACK(await start.handler({ disclaimerAcknowledged: true, answerMode: 'own' }, {}));
  assert.equal(disconnects.length, 1);
});

test('interview: a turn that never answers ends within the timeout with the web fallback', async () => {
  fixSignupLanguage('es');
  const { start, turn } = interviewStart({ sendTurn: () => new Promise(() => {}) });
  const s = await start.handler({ disclaimerAcknowledged: true, answerMode: 'own' }, {});
  WEB_FALLBACK(await turn.handler({ interviewId: s.interviewId, message: 'hola' }));
});

test('interview: in Italian or Portuguese the chat interview is not offered; the web is', async () => {
  for (const lang of ['it', 'pt']) {
    resetSignupLanguage();
    fixSignupLanguage(lang);
    const asked = [];
    const { start } = interviewStart({ lang });
    const r = await start.handler({ disclaimerAcknowledged: false }, { elicitation: true, elicit: async (p) => { asked.push(p); return null; } });
    assert.equal(asked.length, 0, 'no here-or-later question');
    assert.equal(r.ok, false);
    assert.equal(r.relayVerbatim, signupCopy(lang).interviewOnWeb);
    assert.equal(typeof r.relayVerbatim, 'string');
  }
});

async function existingAccount(h) {
  await h.tools.signup_start.handler({ language: 'es' });
  await h.tools.signup_email.handler({ email: 'ada@gmail.com', typed: true });
  await h.tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk });
  await h.tools.signup_create_account.handler({ linkedinUrl: 'https://www.linkedin.com/in/ada', firstName: 'Ada' });
  h.finish({ ok: true, email: 'ada@gmail.com', accountExists: true });
  await tick();
  h.setSession(SESSION);
}

test('existing account: the change list and the update only fill empty fields, never overwrite the rate the talent set', async () => {
  const h = signupHarness();
  await existingAccount(h);
  const ask = await h.tools.update_existing_profile.handler({}, {});
  const block = printed(ask);
  assert.doesNotMatch(block, /45 €\/h/, 'the rate they set is not offered for change');
  assert.ok(block.includes(ES.existingAnnual(ES.existingEmpty, '55.000 €/año')), block);
  assert.doesNotMatch(block, /Disponibilidad: 80/, 'the hours they set are kept');
  await h.tools.update_existing_profile.handler({ answer: ES.existingYes }, {});
  const saved = await h.tools.save_profile_details.handler({
    pricing: { hourlyRate: 50, annualRate: 55000 },
    availability: { available: true, monthlyHours: '120', workModes: ['REMOTE'], country: 'ES', timezone: 'Europe/Madrid' },
    languages: [{ language: 'es', level: 'NATIVE' }],
    workSituation: { situation: 'FREELANCE', changeMotivators: 'FLEXIBILITY' },
  });
  assert.equal(saved.ok, true);
  assert.deepEqual(h.calls.pricing.map((p) => p.pricing), [{
    partTimeProjectSelected: true,
    partTimeProjectPrice: { amount: 45, currency: 'EUR' },
    fullTimeProjectSelected: true,
    fullTimeProjectPrice: { amount: 55000, currency: 'EUR' },
  }]);
  assert.deepEqual(h.calls.availability.map((a) => a.availability), [{ confirmed: true, workModes: ['REMOTE'], country: 'ES' }]);
  assert.deepEqual(h.calls.languages, [], 'languages were already set');
  assert.deepEqual(h.calls.professional, [], 'the work situation cannot be read, so it is never overwritten');
});

test('existing account: keeping the profile saves nothing afterwards', async () => {
  const h = signupHarness();
  await existingAccount(h);
  await h.tools.update_existing_profile.handler({ answer: ES.existingNo }, {});
  await h.tools.save_profile_details.handler({ pricing: { hourlyRate: 50, annualRate: 55000 } });
  assert.deepEqual(h.calls.pricing, []);
});

test('work situation: a missing motivation says exactly what to send instead of failing silently', async () => {
  const h = signupHarness({ session: SESSION });
  const r = await h.tools.save_profile_details.handler({ workSituation: { situation: 'FREELANCE' } });
  assert.equal(r.results.workSituation.reason, 'bad-motivation');
  assert.match(r.results.workSituation.message, /changeMotivators/);
  assert.match(r.message, /save_profile_details again/);
  const schema = h.tools.save_profile_details.inputSchema.properties.workSituation.properties.changeMotivators;
  assert.match(schema.description, /Required when situation is FREELANCE/);
});

test('ai_usage report: no criterion line shows an internal signal name', () => {
  for (const lang of ['es', 'en']) {
    const c = getCatalog(lang).tierAnalysis.criterion;
    const lines = [c.t1Met(1), c.t2Met(1), c.t3Met(1), c.t4Met(1), c.t5Met(true, 1, 1), c.t6Met(2), c.t7Met(1),
      c.t1Blocking(0), c.t2Blocking(0), c.t3Blocking(0), c.t4Blocking(0), c.t5Blocking(false, 0, 0), c.t6Blocking(0), c.t7Blocking(0)];
    for (const line of lines) assert.doesNotMatch(line, /totalDetected|mcpServers|hasAgentic|agentCounts|`\w+ = /, line);
  }
});

// Simulation v8 (real model, 5 runs): what the tools still let through.

test('existing account: a value the profile already had is reported as kept, per field, and the talent gets a fixed line saying so', async () => {
  const h = signupHarness();
  await existingAccount(h);
  await h.tools.update_existing_profile.handler({ answer: ES.existingYes }, {});
  const saved = await h.tools.save_profile_details.handler({
    pricing: { hourlyRate: 60, annualRate: 70000 },
    availability: { monthlyHours: '120' },
    languages: [{ language: 'es', level: 'NATIVE' }],
    workSituation: { situation: 'FREELANCE', changeMotivators: 'FLEXIBILITY' },
    phone: { telephoneCode: '+34', telephoneNumber: '600000001' },
  });
  assert.deepEqual(saved.kept.pricing, { hourlyRate: { kept: 45, requested: 60 } });
  assert.deepEqual(saved.kept.availability, { monthlyHours: { kept: '80', requested: '120' } });
  assert.match(saved.message, /hourlyRate: kept existing value 45 \(not changed, not 60\)/);
  assert.match(saved.message, /monthlyHours: kept existing value 80 \(not changed, not 120\)/);
  assert.doesNotMatch(saved.confirmations.join(' '), /45/, 'a kept rate is not confirmed as saved');
  const next = printed(await usageTool().tool.handler({ lang: 'es' }, {}));
  const line = needle(ES.existingUnchanged([ES.keptLabels.workSituation, `${ES.hourlyRateLabel}: 45 €/h`, `${ES.keptLabels.availability}: ${ES.hours('80')}`, ES.keptLabels.languages, ES.keptLabels.phone]));
  assert.ok(next.startsWith(line), next);
});

test('main role: a main role already set with nothing recommended is not asked again', async () => {
  const { list, set, calls } = roleTools([], undefined, { clusterId: 'backend-developer', name: 'Backend Developer' });
  const r = await list.handler({ waitSeconds: 0 });
  assert.equal(r.mainClusterId, 'backend-developer');
  assert.equal(r.next, 'open_web');
  assert.doesNotMatch(r.message, /Nothing was recommended/);
  const again = await set.handler({ answer: 'Backend Engineer' }, {});
  assert.equal(again.ok, true);
  assert.equal(again.say, undefined, 'no question');
  assert.deepEqual(calls.main, []);
});

test('draft: both rates are required, and only the rates the AI estimated are labelled as its estimate', async () => {
  const { tools } = signupHarness();
  await tools.signup_start.handler({ language: 'es' });
  const missing = await tools.signup_draft.handler({ name: 'Tomás Rivera', role: 'Frontend Developer' });
  assert.equal(missing.reason, 'draft-rates-required');
  assert.match(missing.message, /hourlyRate/);
  assert.match(missing.message, /annualRate/);
  assert.equal((await tools.signup_draft.handler({ name: 'Tomás Rivera', role: 'Frontend Developer', hourlyRate: 40 })).reason, 'draft-rates-required');
  const given = printed(await tools.signup_draft.handler({ ...DRAFT, hourlyRate: 60, annualRate: 70000, ratesFromTalent: true }));
  assert.ok(given.includes(needle(ES.rates(60, 70000, false))), given);
  assert.doesNotMatch(given, /estimación mía/);
  const estimated = printed(await tools.signup_draft.handler({ ...DRAFT, hourlyRate: 45, annualRate: 50000 }));
  assert.ok(estimated.includes(needle(ES.rates(45, 50000, true))));
  assert.match(estimated, /estimación mía/);
});

const CATALOGUE = ['AI Reliability Engineer', 'AI/LLM Engineer', 'AWS Engineer', 'Azure Engineer', 'Backend Developer', 'Data Engineer', 'DevOps Engineer', 'Frontend Developer', 'Node.js Developer', 'QA Engineer']
  .map((name) => ({ clusterId: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, category: 'tech' }));

test('main role: the catalogue shortlist ranks by relevance with its reasons, and always ends with another role', async () => {
  const { set, calls } = roleTools([], CATALOGUE);
  const r = await set.handler({ catalogue: true, answer: 'Backend Engineer', skills: 'Node.js, TypeScript, NestJS, AWS' }, {});
  assert.equal(r.options[0], 'Backend Developer', r.options.join(', '));
  assert.ok(r.options.indexOf('Node.js Developer') > 0 && r.options.indexOf('Node.js Developer') < r.options.indexOf('AI Reliability Engineer') || !r.options.includes('AI Reliability Engineer'), r.options.join(', '));
  assert.equal(r.options.at(-1), needle(ES.mainRoleNotListed));
  assert.ok(r.options.length <= 6);
  const block = printed(r);
  assert.ok(block.includes(needle(ES.catalogueReason.role('Backend'))), block);
  assert.ok(block.includes(needle(ES.catalogueReason.stack('Node.js'))), block);
  const exact = await roleTools([], CATALOGUE).set.handler({ catalogue: true, answer: 'frontend developer' }, {});
  assert.equal(exact.options[0], 'Frontend Developer');
  const other = await set.handler({ catalogue: true, answer: ES.mainRoleNotListed }, {});
  assert.equal(printed(other), needle(ES.mainRoleAsk));
  assert.deepEqual(calls.main, []);
});

test('main role: with nothing recommended the AI\'s guess is only proposed; the role is set when the talent picks it', async () => {
  const { set, calls } = roleTools([], CATALOGUE);
  const proposed = await set.handler({ answer: 'Frontend Developer' }, {});
  assert.deepEqual(calls.main, [], 'not set from the AI\'s own guess');
  assert.equal(proposed.options[0], 'Frontend Developer');
  const picked = await set.handler({ catalogue: true, answer: 'Frontend Developer' }, {});
  assert.equal(picked.ok, true);
  assert.deepEqual(calls, { main: ['frontend-developer'], added: ['frontend-developer'] });
});

test('ai_usage skipped in the sign-up: the skip line rides on the next question block instead of a standalone relay', async () => {
  const declined = await usageTool().tool.handler({ lang: 'es', consent: { granted: false } }, {});
  assert.equal(declined.reason, 'consent-declined');
  assert.equal(declined.relayVerbatim, undefined);
  fixSignupLanguage('es');
  const offer = await interviewStart().start.handler({ disclaimerAcknowledged: false }, {});
  assert.ok(printed(offer).startsWith(`${needle(ES.aiUsageSkipped)}\n\n${ES.interviewWhereQuestion}`), printed(offer));
  const after = await interviewStart().start.handler({ disclaimerAcknowledged: false }, {});
  assert.ok(!printed(after).includes(ES.aiUsageSkipped), 'shown once');
});

test('LinkedIn import failure: its fixed notice rides on the next question block, and the end of the flow still carries an unseen one', async () => {
  const h = signupHarness({ importStatus: async () => ({ ok: true, state: 'done', sources: { linkedin: { state: 'failed', code: 'source.provider_unavailable' } } }) });
  await h.tools.signup_start.handler({ language: 'es' });
  await h.tools.signup_email.handler({ email: 'ada@gmail.com', typed: true });
  await h.tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk });
  await h.tools.signup_create_account.handler({ linkedinUrl: 'https://www.linkedin.com/in/ada', firstName: 'Ada' });
  h.finish({ ok: true, email: 'ada@gmail.com', accountExists: false, claimed: true });
  await tick();
  h.setSession(SESSION);
  const status = await h.tools.signup_status.handler({});
  assert.doesNotMatch(status.message, /Tell the talent/);
  const notice = needle(ES.importFailed([ES.importSources.linkedin]));
  assert.ok(printed(await usageTool().tool.handler({ lang: 'es' }, {})).startsWith(notice));
  await h.tools.signup_status.handler({});
  assert.equal((await h.tools.open_web.handler({})).relayVerbatim, undefined, 'already shown');
  await h.tools.import_profile.handler({ linkedinUrl: 'https://www.linkedin.com/in/ada' });
  const end = await h.tools.open_web.handler({});
  assert.equal(end.relayVerbatim, undefined, 'a source already reported is not reported again');
});

test('it/pt: no text promises the onboarding interview in the chat, since those languages do it on the web', () => {
  for (const lang of ['it', 'pt']) {
    assert.doesNotMatch(legalCopy(lang).signupNotice, /chat/i, lang);
    assert.doesNotMatch(signupCopy(lang).welcome(null), /ora o più tardi|agora ou mais tarde/, lang);
  }
  assert.match(signupCopy('it').welcome(null), /sul sito/);
  assert.match(signupCopy('pt').welcome(null), /na web/);
});

test('CV attach: a path already in the talent\'s answer is read at once instead of asking for the file', async () => {
  const { tools } = signupHarness();
  await tools.signup_start.handler({ language: 'es' });
  const r = await tools.signup_start.handler({ answer: ES.cvAttach, cvPath: '~/Documents/CV_Irene_Calvo.pdf' });
  assert.equal(r.relayVerbatim, undefined);
  assert.equal(r.cvPath, '~/Documents/CV_Irene_Calvo.pdf');
  assert.match(r.message, /read_cv/);
  await tools.signup_start.handler({ language: 'es' });
  const ask = await tools.signup_start.handler({ answer: ES.cvAttach });
  assert.equal(ask.relayVerbatim, needle(ES.cvAttachAsk));
  assert.match(ask.message, /already/);
});

// CodeAnt review threads on !67.

test('existing account: an unselected rate that keeps an old amount counts as empty, so the confirmed rate fills it', async () => {
  const h = signupHarness({ fetchPricingRate: async () => ({ ok: true, pricing: { partTimeSelected: false, partTimePrice: { amount: 30, currency: 'EUR' }, fullTimeSelected: true, fullTimePrice: { amount: 50000, currency: 'EUR' } } }) });
  await existingAccount(h);
  await h.tools.update_existing_profile.handler({ answer: ES.existingYes }, {});
  const saved = await h.tools.save_profile_details.handler({ pricing: { hourlyRate: 60, annualRate: 70000 } });
  assert.deepEqual(h.calls.pricing.map((p) => p.pricing), [{
    partTimeProjectSelected: true,
    partTimeProjectPrice: { amount: 60, currency: 'EUR' },
    fullTimeProjectSelected: true,
    fullTimeProjectPrice: { amount: 50000, currency: 'EUR' },
  }]);
  assert.deepEqual(saved.kept.pricing, { annualRate: { kept: 50000, requested: 70000 } });
});

test('interview start schema: the instructed first call without disclaimerAcknowledged is valid', () => {
  const { start } = interviewStart();
  assert.ok(!(start.inputSchema.required || []).includes('disclaimerAcknowledged'));
});

test('interview turn: a transcript that could not be saved is not reported as saved', async () => {
  fixSignupLanguage('es');
  const { start, turn } = interviewStart({
    sendTurn: async () => { throw Object.assign(new Error('t'), { kind: 'turn-timeout' }); },
    complete: async () => ({ ok: false, reason: 'http-500' }),
  });
  const s = await start.handler({ disclaimerAcknowledged: true, answerMode: 'own' }, {});
  const r = await turn.handler({ interviewId: s.interviewId, message: 'hola' });
  assert.equal(r.saved, false);
  const failed = interviewStart({ sendTurn: async () => { throw Object.assign(new Error('x'), { kind: 'turn-error' }); }, complete: async () => ({ ok: false, reason: 'http-500' }) });
  const s2 = await failed.start.handler({ disclaimerAcknowledged: true, answerMode: 'own' }, {});
  const r2 = await failed.turn.handler({ interviewId: s2.interviewId, message: 'hola' });
  assert.equal(r2.saved, false);
  assert.doesNotMatch(r2.message, /was saved/);
});

test('main role: a role the CV names with an exact catalogue match is offered, never set without the talent picking it', async () => {
  const { set, calls } = roleTools([], CATALOGUE);
  const r = await set.handler({ catalogue: true, answer: 'Backend Developer' }, {});
  assert.deepEqual(calls, { main: [], added: [] });
  assert.equal(r.options[0], 'Backend Developer');
  const dialog = await roleTools([], CATALOGUE).set.handler({ catalogue: true, answer: 'Backend Developer' }, cancelling().ctx);
  assert.equal(dialog.ok, false);
});

test('main role: a second call while the catalogue dialog is open does not break the talent\'s pick', async () => {
  const { set, calls } = roleTools([], CATALOGUE);
  const ctx = { elicitation: true, elicit: async () => { await set.handler({ catalogue: true, answer: 'zzz nothing matches' }, {}); return { action: 'accept', content: { choice: 'Backend Developer' } }; } };
  const r = await set.handler({ catalogue: true, answer: 'Backend Engineer' }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(calls.main, ['backend-developer']);
});

test('CV search: a path the talent gives with the search answer is read as is, not another candidate', async () => {
  const { tools } = signupHarness();
  await tools.signup_start.handler({ language: 'es' });
  const r = await tools.signup_start.handler({ answer: ES.cvSearch, cvPath: '~/Desktop/mi-cv.pdf' });
  assert.equal(r.step, 'cv-given');
  assert.equal(r.cvPath, '~/Desktop/mi-cv.pdf');
  assert.doesNotMatch(r.message, /suggest_register_context/);
});

test('CV path: one given with the first message is kept for the answer call, even if the model drops it', async () => {
  const { tools } = signupHarness();
  await tools.signup_start.handler({ language: 'es', cvPath: '~/Desktop/mi-cv.pdf' });
  const r = await tools.signup_start.handler({ answer: ES.cvSearch });
  assert.equal(r.step, 'cv-given');
  assert.equal(r.cvPath, '~/Desktop/mi-cv.pdf');
  await tools.signup_start.handler({ language: 'es' });
  assert.equal((await tools.signup_start.handler({ answer: ES.cvSearch })).step, 'cv-search', 'a new sign-up forgets it');
});
