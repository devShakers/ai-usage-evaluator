'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeSignupTools, isSignupPending, signupPhase, isPersonalEmail } = require('../src/mcp-signup-tools');
const { signupCopy, legalCopy } = require('../src/signup-copy');
const { resetSignupLanguage } = require('../src/signup-language');
const { takeNotices } = require('../src/mcp-choice');
const { needle } = require('../test-fixtures/copy-needle');

const ES = signupCopy('es');
const SESSION = { accessToken: 'jwt', hubAccessToken: 'jwt', email: 'ada@example.com', expiresAt: '2999-01-01T00:00:00.000Z' };
const DRAFT = { name: 'Ada Lovelace', role: 'Data Engineer', city: 'Madrid', yearsOfExperience: 8, stack: 'Spark, dbt', languages: 'Español nativo, inglés C1', workMode: 'Remoto', monthlyHours: '120-160', hourlyRate: 45, annualRate: 60000 };
const CREATE = {
  linkedinUrl: 'https://www.linkedin.com/in/ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  userQuery: 'Data engineer, 8 years, Spark and dbt.\nWants remote projects.',
};

test.beforeEach(() => { resetSignupLanguage(); takeNotices(); });

function tmpPdf(name = 'ada-cv.pdf', body = '%PDF-1.4 ada') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signup-cv-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

// A loopback window the test drives: it announces its URL and resolves when the test says so.
function fakeWindow() {
  const win = { calls: [], finish: null, options: null };
  win.run = (args, options) => {
    win.calls.push(args);
    win.options = options;
    options.onUrl('http://127.0.0.1:5555/');
    return new Promise((resolve) => { win.finish = resolve; });
  };
  return win;
}

function harness(overrides = {}) {
  const win = fakeWindow();
  const calls = { signup: [], status: [], ott: [], opened: [], saved: [], imports: [] };
  let session = overrides.session || null;
  const flowDeps = {
    loadAuthSession: () => session,
    sessionStatus: (s) => (s ? 'active' : 'none'),
    saveAuthSession: (s) => { calls.saved.push(s); session = { ...s, expiresAt: '2999-01-01T00:00:00.000Z' }; },
    getTalentProfileUrl: () => 'https://works.test/login',
    getImportProfileEndpoint: () => 'https://hub.test/works/me/import-profile',
    requestImportProfile: async (args) => { calls.imports.push(args); return { ok: true, report: { outcome: 'partial', sources: [{ source: 'linkedin', status: 'imported' }, { source: 'cv', status: 'failed', code: 'source.cv_unreadable' }] } }; },
    getProfessionalDetailsEndpoint: () => 'https://hub.test/pd',
    getPricingRateEndpoint: () => 'https://hub.test/pr',
    getSetAvailabilityEndpoint: () => 'https://hub.test/av',
    requestSetProfessionalDetails: async (p) => { calls.professional = p; return { ok: true }; },
    requestSetPricingRate: async (p) => { calls.pricing = p; return { ok: true }; },
    requestSetAvailability: async (p) => { calls.availability = p; return { ok: true }; },
    ...(overrides.flowDeps || {}),
  };
  const deps = {
    lang: 'es',
    flowDeps,
    runLoopbackAuth: win.run,
    requestMcpSignup: async (fields, opts) => { calls.signup.push({ fields, opts }); return overrides.signupResult || { ok: true, claimCode: `CODE-${calls.signup.length}`, claimCodeExpiresAt: 'x' }; },
    requestMyImportStatus: async (args) => { calls.status.push(args); return overrides.importStatus ? overrides.importStatus() : { ok: true, state: 'running', sources: {} }; },
    requestOneTimeToken: async (args) => { calls.ott.push(args); return { ok: true, token: 'OTT' }; },
    getMcpSignupEndpoint: () => 'https://hub.test/works-ai/talents/mcp-signup',
    getMyImportStatusEndpoint: () => 'https://hub.test/works/me/import-profile/status',
    getOneTimeTokenEndpoint: () => 'https://hub.test/auth/one-time-token/generate',
    getOneTimeLoginUrl: (token) => `https://works.test/auth/one-time?token=${token}`,
    getDeviceAuthorizeEndpoint: () => 'https://hub.test/auth/device/code',
    getDeviceTokenEndpoint: () => 'https://hub.test/works/auth/device/token',
    getAuthTokenEndpoint: () => 'https://hub.test/auth/token',
    getCompleteRegistrationEndpoint: () => 'https://hub.test/works/auth/complete-registration',
    checkOnboardingCompleted: async () => false,
    fetchPricingRate: async () => ({ ok: true, pricing: { partTimeSelected: true, partTimePrice: { amount: 40, currency: 'EUR' }, fullTimeSelected: false, fullTimePrice: null } }),
    fetchAvailability: async () => ({ ok: true, availability: { monthlyHours: '80-120' } }),
    fetchLanguages: async () => ({ ok: true, languageCount: 1, languageCodes: ['es'] }),
    openBrowser: (url) => { calls.opened.push(url); },
    sleep: () => new Promise((resolve) => setImmediate(resolve)),
    ...(overrides.deps || {}),
  };
  const tools = Object.fromEntries(makeSignupTools(deps).map((t) => [t.name, t]));
  return { tools, win, calls, setSession: (s) => { session = s; } };
}

// Welcome, email and a confirmed draft: the state signup_create_account needs.
async function readyToCreate(h, { email = 'ada@gmail.com', lang = 'es' } = {}) {
  await h.tools.signup_start.handler({ language: lang });
  if (email) await h.tools.signup_email.handler({ email, typed: true });
  const c = signupCopy(lang);
  return h.tools.signup_draft.handler({ ...DRAFT, answer: c.draftOk });
}

test('signup_start: the welcome and its one question, word for word in the language of the first message, with nothing sent anywhere', async () => {
  const { tools, calls, win } = harness();
  const r = await tools.signup_start.handler({ language: 'es' });
  assert.equal(r.reason, 'answer-required');
  assert.equal(r.say, [needle(ES.welcome(null)), needle(ES.welcomeQuestion), `1. ${ES.cvSearch}\n2. ${ES.cvAttach}`].join('\n\n'));
  assert.deepEqual(r.options, [ES.cvSearch, ES.cvAttach]);
  assert.equal(r.language, 'es');
  assert.equal(r.say.split('?').length - 1, 1, 'one question only, at the end');
  assert.equal(calls.signup.length, 0);
  assert.equal(win.calls.length, 0);
});

test('signup_start: greets by name when the AI knows it, and the answer leads to the CV search or the attachment', async () => {
  const { tools } = harness();
  const r = await tools.signup_start.handler({ language: 'es', firstName: 'Ada' });
  assert.match(r.say, /^¡Hola, Ada! Gracias por querer unirte a Shakers/);
  const search = await tools.signup_start.handler({ answer: ES.cvSearch });
  assert.equal(search.step, 'cv-search');
  assert.equal(search.cvNotFound, needle(ES.cvNotFound));
  assert.equal(search.linkedinAsk, needle(ES.linkedinAsk));
  assert.match(search.message, /read_cv/);
  assert.match(search.message, /signup_email/);
  const attach = await tools.signup_start.handler({ answer: ES.cvAttach });
  assert.equal(attach.relayVerbatim, needle(ES.cvAttachAsk));
});

test('signup_start: the language of the first message is kept by every later sign-up text, whatever the OS says', async () => {
  const { tools } = harness();
  await tools.signup_start.handler({ language: 'it' });
  const later = await tools.signup_start.handler({ answer: 'nope' });
  assert.ok(later.say.includes(needle(signupCopy('it').welcomeQuestion)));
  assert.equal((await tools.signup_start.handler({ answer: '2' })).step, 'cv-attach', 'the number of an option is that option');
  const email = await tools.signup_email.handler({});
  assert.equal(email.relayVerbatim, needle(signupCopy('it').emailUnknown));
  const pt = harness();
  await pt.tools.signup_start.handler({ language: 'pt-PT' });
  const draft = await pt.tools.signup_draft.handler(DRAFT);
  assert.ok(draft.say.startsWith(needle(signupCopy('pt').draftTitle)));
  assert.ok(draft.say.includes(needle(legalCopy('pt').signupNotice)));
});

test('signup_email: a known personal email is asked with its two options; a company domain adds the work-email hint', async () => {
  const { tools } = harness();
  await tools.signup_start.handler({ language: 'es' });
  const personal = await tools.signup_email.handler({ email: 'ada@gmail.com' });
  assert.equal(personal.say, `${needle(ES.emailKnown('ada@gmail.com'))}\n\n1. ${ES.emailYes}\n2. ${ES.emailOther}`);
  assert.deepEqual(personal.options, [ES.emailYes, ES.emailOther]);
  const work = await tools.signup_email.handler({ email: 'ada@acme-corp.com' });
  assert.ok(work.say.startsWith(`${ES.emailKnown('ada@acme-corp.com')} ${needle(ES.emailWorkHint)}\n\n`));
  assert.doesNotMatch(work.say, /corporativo/i);
  assert.equal(isPersonalEmail('x@outlook.es'), true);
  assert.equal(isPersonalEmail('x@shakersworks.com'), false);
});

test('signup_email: yes keeps it; another one or none asks the open question; a typed email is taken as is', async () => {
  const h = harness();
  await h.tools.signup_start.handler({ language: 'es' });
  const yes = await h.tools.signup_email.handler({ email: 'ada@gmail.com', answer: ES.emailYes });
  assert.equal(yes.email, 'ada@gmail.com');
  const other = await h.tools.signup_email.handler({ email: 'ada@gmail.com', answer: ES.emailOther });
  assert.equal(other.relayVerbatim, needle(ES.emailUnknown));
  const none = await h.tools.signup_email.handler({});
  assert.equal(none.relayVerbatim, needle(ES.emailUnknown));
  const typed = await h.tools.signup_email.handler({ email: 'ada@proton.me', typed: true });
  assert.equal(typed.email, 'ada@proton.me');
  assert.equal((await h.tools.signup_email.handler({ email: 'not-an-email', typed: true })).reason, 'invalid-email');
  await h.tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk });
  await h.tools.signup_create_account.handler(CREATE);
  assert.equal(h.calls.signup[0].fields.email, 'ada@proton.me');
  assert.equal(h.win.calls[0].registerFields.email, 'ada@proton.me');
  h.win.finish({ ok: false, reason: 'cancelled' });
});

test('signup_draft: shows the draft with hourly and annual rates and the data notice, then asks to confirm', async () => {
  const { tools } = harness();
  await tools.signup_start.handler({ language: 'es' });
  const r = await tools.signup_draft.handler(DRAFT);
  const draft = [
    'Esto es lo que he preparado para tu perfil:',
    'Ada Lovelace · Data Engineer · Madrid',
    '8 años de experiencia · Spark, dbt',
    'Español nativo, inglés C1 · Remoto · 120-160 h/mes',
    'Tarifa estimada: 45 €/h · 60.000 €/año (estimación mía, ajústala)',
  ].join('\n');
  assert.equal(r.say, [draft, needle(legalCopy('es').signupNotice), needle(ES.windowNotice), needle(ES.draftQuestion), `1. ${ES.draftOk}\n2. ${ES.draftChange}`].join('\n\n'));
  assert.deepEqual(r.options, [ES.draftOk, ES.draftChange]);
  assert.doesNotMatch(draft, /proyecto/);
});

test('signup_draft: a change request asks what; a confirmation leads to the account; an implausible rate or a missing role is refused', async () => {
  const { tools } = harness();
  await tools.signup_start.handler({ language: 'es' });
  const change = await tools.signup_draft.handler({ ...DRAFT, answer: ES.draftChange });
  assert.equal(change.reason, 'draft-change');
  const ok = await tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk });
  assert.equal(ok.ok, true);
  assert.equal(ok.relayVerbatim, undefined, 'the window text comes with the window');
  assert.equal(ok.next, 'signup_create_account');
  assert.equal((await tools.signup_draft.handler({ ...DRAFT, hourlyRate: 3000 })).reason, 'implausible-rate');
  assert.equal((await tools.signup_draft.handler({ name: 'Ada' })).reason, 'draft-incomplete');
});

test('signup_create_account: refused until the talent confirmed the draft; then it opens the window with nothing to print', async () => {
  const h = harness();
  await h.tools.signup_start.handler({ language: 'es' });
  assert.equal((await h.tools.signup_create_account.handler(CREATE)).reason, 'draft-not-confirmed');
  assert.equal(h.calls.signup.length, 0);
  await h.tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk });
  const created = await h.tools.signup_create_account.handler(CREATE);
  assert.equal(created.say, undefined);
  assert.match(created.message, /Say nothing about the window/);
  h.win.finish({ ok: false, reason: 'cancelled' });
});

test('signup_create_account: sends LinkedIn, the PDF, identity and userQuery to hub, opens the window, never returns the claim code', async () => {
  const cvPath = tmpPdf();
  const h = harness();
  await readyToCreate(h);
  const r = await h.tools.signup_create_account.handler({ ...CREATE, cvPath });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'window-open');
  assert.equal(r.next, 'signup_status');
  assert.equal(JSON.stringify(r).includes('CODE-1'), false, 'the claim code stays in memory');
  const sent = h.calls.signup[0].fields;
  assert.equal(sent.linkedinUrl, CREATE.linkedinUrl);
  assert.equal(sent.email, 'ada@gmail.com');
  assert.equal(sent.firstName, 'Ada');
  assert.equal(sent.userQuery, CREATE.userQuery);
  assert.equal(sent.language, 'es');
  assert.equal(sent.cv.data.toString(), '%PDF-1.4 ada');
  assert.equal(h.win.calls[0].mode, 'register');
  assert.equal(h.win.calls[0].lang, 'es');
  assert.equal(h.win.calls[0].registerFields.claimCode(), 'CODE-1');
  assert.equal(isSignupPending(), true);
  assert.equal(signupPhase(), 'waiting');
  h.win.finish({ ok: false, reason: 'browser-timeout' });
});

test('signup_create_account: a non-PDF CV travels as text; no source is named before any request; hub refusals keep their guidance', async () => {
  const docx = harness();
  await readyToCreate(docx);
  const r = await docx.tools.signup_create_account.handler({ ...CREATE, cvPath: tmpPdf('cv.docx', 'PK') });
  assert.equal(docx.calls.signup[0].fields.cv, null);
  assert.match(r.cvNote, /import_profile/);
  docx.win.finish({ ok: false, reason: 'cancelled' });

  const none = harness();
  await readyToCreate(none);
  const missing = await none.tools.signup_create_account.handler({});
  assert.equal(missing.reason, 'missing-source');
  assert.equal(missing.linkedinAsk, needle(ES.linkedinAsk));
  assert.equal((await none.tools.signup_create_account.handler({ cvPath: '/nope/cv.pdf' })).reason, 'cv-not-found');
  for (const linkedinUrl of ['https://www.linkedin.com/in/me/', 'https://www.linkedin.com/feed/']) {
    assert.equal((await none.tools.signup_create_account.handler({ ...CREATE, linkedinUrl })).reason, 'invalid-linkedin-url');
  }
  assert.equal(none.calls.signup.length, 0);

  for (const reason of ['invalid-linkedin-url', 'invalid-cv', 'rate-limited']) {
    const h = harness({ signupResult: { ok: false, reason } });
    await readyToCreate(h);
    const refused = await h.tools.signup_create_account.handler(CREATE);
    assert.equal(refused.reason, reason);
    assert.ok(refused.message.length > 0);
    assert.equal(h.win.calls.length, 0);
  }
});

test('signup_create_account: a machine already signed in goes to import_profile; a second call reuses the open window', async () => {
  const signed = harness({ session: SESSION });
  await readyToCreate(signed);
  assert.equal((await signed.tools.signup_create_account.handler(CREATE)).reason, 'already-signed-in');

  const h = harness();
  await readyToCreate(h);
  await h.tools.signup_create_account.handler(CREATE);
  const again = await h.tools.signup_create_account.handler({ ...CREATE, linkedinUrl: 'https://www.linkedin.com/in/ada-l' });
  assert.equal(again.ok, true);
  assert.equal(h.win.calls.length, 1);
  assert.equal(h.win.calls[0].registerFields.claimCode(), 'CODE-2');
  h.win.finish({ ok: false, reason: 'cancelled' });
});

test('signup_status: waits for the account, then the import from the session, saving the draft, the AI-usage step, the interview, the main role and the web, in that order', async () => {
  const h = harness({ deps: { checkOnboardingCompleted: async () => true }, importStatus: () => ({ ok: true, state: 'done', sources: { linkedin: { state: 'done' } } }) });
  await readyToCreate(h);
  await h.tools.signup_create_account.handler(CREATE);
  const before = await h.tools.signup_status.handler({});
  assert.equal(before.account.state, 'waiting');
  assert.equal(before.import.state, 'none', 'no import status without a session');
  assert.equal(h.calls.status.length, 0);
  const pending = h.tools.signup_status.handler({ waitSeconds: 20 });
  setImmediate(() => h.win.finish({ ok: true, email: 'ada@gmail.com', accountExists: false, claimed: true }));
  h.setSession(SESSION);
  const r = await pending;
  assert.deepEqual(r.account, { state: 'created', via: 'email', email: 'ada@gmail.com', claimed: true });
  assert.deepEqual(r.import, { state: 'done', sources: { linkedin: { state: 'done' } } });
  assert.equal(h.calls.status.at(-1).hubAccessToken, 'jwt');
  assert.deepEqual(r.onboardingInterview, { completed: true });
  const order = ['save_profile_details', 'ai_usage', 'onboarding_interview_start', 'set_main_role', 'open_web'].map((t) => r.message.indexOf(t));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), r.message);
  assert.match(r.message, /no scan happens before a yes/);
  assert.equal(signupPhase(), 'account');
});

test('signup_status: a failed LinkedIn import queues its fixed line once, then says to retry once and ask for another source, never with codes', async () => {
  const h = harness({ session: null, importStatus: () => ({ ok: true, state: 'done', sources: { linkedin: { state: 'failed', code: 'source.not_found' } } }) });
  await readyToCreate(h);
  await h.tools.signup_create_account.handler(CREATE);
  h.win.finish({ ok: true, email: 'ada@gmail.com', accountExists: false, claimed: true });
  h.setSession(SESSION);
  await new Promise((resolve) => setImmediate(resolve));
  const r = await h.tools.signup_status.handler({});
  assert.match(r.message, /retry once/i);
  assert.match(r.message, /website or GitHub/);
  assert.match(r.message, /never with codes/);
  assert.deepEqual(takeNotices(), [ES.importFailed([ES.importSources.linkedin])]);
});

test('signup_status: the window link only when the talent says it did not open, as fixed text', async () => {
  const h = harness();
  await readyToCreate(h);
  await h.tools.signup_create_account.handler(CREATE);
  assert.equal((await h.tools.signup_status.handler({})).relayVerbatim, undefined);
  const r = await h.tools.signup_status.handler({ windowLink: true });
  assert.equal(r.relayVerbatim, ES.windowLink('http://127.0.0.1:5555/'));
  h.win.finish({ ok: false, reason: 'cancelled' });
});

test('signup_status: an existing account the talent signed in to goes to update_existing_profile, not to a silent save', async () => {
  const h = harness();
  await readyToCreate(h);
  await h.tools.signup_create_account.handler(CREATE);
  h.win.finish({ ok: true, email: 'ada@gmail.com', accountExists: true });
  h.setSession(SESSION);
  await new Promise((resolve) => setImmediate(resolve));
  const r = await h.tools.signup_status.handler({});
  assert.equal(r.account.state, 'existing');
  assert.deepEqual(r.import, { state: 'none' }, 'the old import of an existing account is not reported as this sign-up\'s');
  assert.match(r.message, /update_existing_profile/);
  assert.doesNotMatch(r.message, /without asking: save_profile_details/);
});

test('signup_status: unclaimed account, closed window and nothing started each get their guidance', async () => {
  const h = harness();
  await readyToCreate(h);
  await h.tools.signup_create_account.handler(CREATE);
  h.win.finish({ ok: true, email: 'other@example.com', accountExists: false, claimed: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match((await h.tools.signup_status.handler({})).message, /import_profile/);

  const closed = harness();
  await readyToCreate(closed);
  await closed.tools.signup_create_account.handler(CREATE);
  closed.win.finish({ ok: false, reason: 'browser-timeout' });
  await new Promise((resolve) => setImmediate(resolve));
  const failed = await closed.tools.signup_status.handler({});
  assert.deepEqual(failed.account, { state: 'failed', reason: 'browser-timeout' });
  assert.match(failed.message, /signup_create_account reopens/);

  assert.equal((await harness().tools.signup_status.handler({})).reason, 'no-signup');
});

test('update_existing_profile: shows only what the draft would fill in empty fields and, on yes, re-imports filling only empty fields', async () => {
  const cvPath = tmpPdf();
  const h = harness();
  await readyToCreate(h);
  await h.tools.signup_create_account.handler({ ...CREATE, cvPath });
  h.win.finish({ ok: true, email: 'ada@gmail.com', accountExists: true });
  h.setSession(SESSION);
  const ask = await h.tools.update_existing_profile.handler({});
  assert.equal(ask.say.split('\n\n1. ')[0], [
    needle(ES.existingTitle),
    '',
    '· Tarifa anual: sin indicar → 60.000 €/año',
    `· ${needle(ES.existingLists)}`,
  ].join('\n'));
  assert.deepEqual(ask.options, [ES.existingYes, ES.existingNo]);
  const yes = await h.tools.update_existing_profile.handler({ answer: ES.existingYes });
  assert.equal(yes.updated, true);
  assert.equal(h.calls.imports[0].fillEmptyOnly, true);
  assert.equal(h.calls.imports[0].linkedinUrl, CREATE.linkedinUrl);
  assert.equal(h.calls.imports[0].cvPath, cvPath);
  assert.match(yes.message, /save_profile_details/);
});

test('update_existing_profile: no keeps the profile untouched and says so', async () => {
  const h = harness({ session: SESSION });
  await readyToCreate(h);
  const no = await h.tools.update_existing_profile.handler({ answer: ES.existingNo });
  assert.equal(no.updated, false);
  assert.equal(no.relayVerbatim, needle(ES.existingKept));
  assert.equal(h.calls.imports.length, 0);
  assert.equal((await harness().tools.update_existing_profile.handler({})).reason, 'no-session');
});

test('Google in the window: device flow in the background, claim code on complete-registration, session kept for the web link', async () => {
  const polls = [{ status: 'pending' }, { status: 'authorized', accessToken: 'SESS-G', isNewUser: true, email: 'ada@gmail.com' }];
  let finalizeArgs = null;
  const h = harness({
    deps: {
      startDeviceLogin: async () => ({ ok: true, deviceCode: 'DEV', userCode: 'ABCD', verificationUriComplete: 'https://works.test/cli-login?user_code=ABCD', interval: 1, expiresIn: 600 }),
      pollDeviceToken: async () => polls.shift(),
      finalizeDeviceSession: async (args) => { finalizeArgs = args; return { ok: true, token: 'JWT-G', claimed: true }; },
    },
  });
  await readyToCreate(h, { email: null });
  await h.tools.signup_create_account.handler(CREATE);
  const redirect = await h.win.options.onGoogle();
  assert.deepEqual(redirect, { ok: true, url: 'https://works.test/cli-login?user_code=ABCD&provider=google' });
  h.win.finish({ ok: true, viaSocial: true, provider: 'google' });
  const r = await h.tools.signup_status.handler({ waitSeconds: 20 });
  assert.deepEqual(r.account, { state: 'created', via: 'google', email: 'ada@gmail.com', claimed: true });
  assert.equal(finalizeArgs.claimCode, 'CODE-1');
  assert.equal(finalizeArgs.registrationContext.preferredLanguage, 'ES');
  assert.equal(JSON.stringify(h.calls.saved).includes('SESS-G'), false, 'the device session token is never written to disk');
  const web = await h.tools.open_web.handler({});
  assert.deepEqual(h.calls.ott[0], { cookie: null, sessionToken: 'SESS-G' });
  assert.equal(web.loggedIn, true);
  assert.deepEqual(h.calls.opened, ['https://works.test/auth/one-time?token=OTT']);
});

test('Google in the window: an existing Google account is signed in without claiming and goes to update_existing_profile', async () => {
  let finalizeArgs = null;
  const h = harness({
    deps: {
      startDeviceLogin: async () => ({ ok: true, deviceCode: 'DEV', verificationUriComplete: 'https://works.test/cli-login', interval: 1, expiresIn: 600 }),
      pollDeviceToken: async () => ({ status: 'authorized', accessToken: 'S', isNewUser: false, email: 'ada@gmail.com' }),
      finalizeDeviceSession: async (args) => { finalizeArgs = args; return { ok: true, token: 'JWT' }; },
    },
  });
  await readyToCreate(h);
  await h.tools.signup_create_account.handler(CREATE);
  await h.win.options.onGoogle();
  const r = await h.tools.signup_status.handler({ waitSeconds: 20 });
  assert.equal(r.account.state, 'existing');
  assert.equal(finalizeArgs.claimCode, null);
  assert.match(r.message, /update_existing_profile/);
});

test('import_profile: fills only empty fields, names the failed source without its code, and waits while the window is open', async () => {
  const cvPath = tmpPdf();
  const signed = harness({ session: SESSION });
  const r = await signed.tools.import_profile.handler({ linkedinUrl: CREATE.linkedinUrl, cvPath, userQuery: 'x' });
  assert.equal(signed.calls.imports[0].fillEmptyOnly, true);
  assert.equal(signed.calls.imports[0].hubAccessToken, 'jwt');
  assert.match(r.message, /except: cv\./);
  assert.doesNotMatch(r.message, /cv_unreadable/);

  const h = harness();
  await readyToCreate(h);
  await h.tools.signup_create_account.handler(CREATE);
  assert.equal((await h.tools.import_profile.handler({ linkedinUrl: CREATE.linkedinUrl })).reason, 'signup-pending');
  h.win.finish({ ok: false, reason: 'cancelled' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await h.tools.import_profile.handler({ linkedinUrl: CREATE.linkedinUrl })).reason, 'no-session');
});

test('save_profile_details: writes each confirmed section with canonical codes and confirms it in the talent\'s language', async () => {
  const h = harness({ session: SESSION });
  await h.tools.signup_start.handler({ language: 'it' });
  const r = await h.tools.save_profile_details.handler({
    workSituation: { situation: 'EMPLOYED', participation: 'FULL_TIME', opinion: 'OPEN_TO_FREELANCE', changeMotivators: 'FLEXIBILITY' },
    pricing: { hourlyRate: 45, annualRate: 60000 },
    availability: { available: true, monthlyHours: '> 160', workModes: ['REMOTE'], country: 'ES', timezone: 'Europe/Madrid' },
  });
  assert.equal(r.ok, true);
  assert.equal(h.calls.professional.currentEmploymentStatus, 'IN_HOUSE_FULL_TIME');
  assert.equal(h.calls.availability.availability.monthlyHours, '> 160');
  assert.deepEqual(h.calls.pricing.pricing, {
    partTimeProjectSelected: true,
    partTimeProjectPrice: { amount: 45, currency: 'EUR' },
    fullTimeProjectSelected: true,
    fullTimeProjectPrice: { amount: 60000, currency: 'EUR' },
  });
  const it = signupCopy('it');
  assert.deepEqual(r.confirmations, [it.saved.workSituation, it.ratesSaved([`${it.hourlyRateLabel}: 45 €/h`, `${it.annualRateLabel}: 60.000 €/anno`]), it.saved.availability]);
});

test('save_profile_details: implausible rates and invalid sections fail alone; without a session nothing is written', async () => {
  const h = harness({ session: SESSION });
  const hourly = await h.tools.save_profile_details.handler({ pricing: { hourlyRate: 2500, annualRate: 4500 } });
  assert.equal(hourly.results.pricing.reason, 'implausible-rate');
  assert.equal(h.calls.pricing, undefined);
  const mixed = await h.tools.save_profile_details.handler({ workSituation: { situation: 'NOT_A_SITUATION' }, pricing: { hourlyRate: 45 } });
  assert.equal(mixed.results.workSituation.reason, 'bad-situation');
  assert.match(mixed.results.workSituation.message, /enum/);
  assert.deepEqual(mixed.results.pricing, { ok: true });
  assert.equal((await harness().tools.save_profile_details.handler({ pricing: { hourlyRate: 45 } })).reason, 'no-session');
  const props = h.tools.save_profile_details.inputSchema.properties;
  assert.deepEqual(Object.keys(props.pricing.properties).sort(), ['annualRate', 'hourlyRate']);
  assert.doesNotMatch(JSON.stringify(props), /per-project|PROJECT price/i);
});

test('open_web: an email session mints the one-time link with its cookie; without a session it falls back to the sign-in page', async () => {
  const withCookie = harness({ session: { ...SESSION, cookie: 'better-auth.session_token=abc.sig' } });
  const signedIn = await withCookie.tools.open_web.handler({ open: false });
  assert.deepEqual(withCookie.calls.ott[0], { cookie: 'better-auth.session_token=abc.sig', sessionToken: null });
  assert.equal(signedIn.link, 'https://works.test/auth/one-time?token=OTT');
  const anonymous = harness();
  const fallback = await anonymous.tools.open_web.handler({});
  assert.deepEqual(anonymous.calls.opened, ['https://works.test/login']);
  assert.equal(fallback.loggedIn, false);
});

test('open_linkedin_profile: only when the talent does not know where to find it, after the warning, and relays the copy-paste line', async () => {
  const { tools, calls } = harness();
  await tools.signup_start.handler({ language: 'es' });
  const r = await tools.open_linkedin_profile.handler({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.opened, ['https://www.linkedin.com/in/me/']);
  assert.equal(r.relayVerbatim, needle(ES.linkedinOpened));
  assert.match(tools.open_linkedin_profile.description, /ONLY when the talent says they do not know where to find/);
  assert.match(tools.open_linkedin_profile.description, /linkedinOpening/);
});

test('mcpb manifest: lists only tools the server registers, the new sign-up steps included', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'packaging/mcpb/manifest.json'), 'utf8'));
  const list = await require('../bin/mcp').buildServer().handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  const names = new Set(list.result.tools.map((t) => t.name));
  for (const t of manifest.tools) assert.ok(names.has(t.name), t.name);
  for (const name of ['signup_start', 'signup_email', 'signup_draft', 'signup_create_account', 'update_existing_profile']) {
    assert.ok(manifest.tools.some((t) => t.name === name), name);
  }
});
