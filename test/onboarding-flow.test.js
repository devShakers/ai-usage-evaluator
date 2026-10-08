'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../src/onboarding-flow');
const { makeIo } = require('../bin/register');

const TALENT_UUID = '11111111-2222-3333-4444-555555555555';
const ACTIVE_SESSION = { accessToken: 'tok', hubAccessToken: 'hub', email: 't@t.com', userId: TALENT_UUID };

// A fake InterviewClient: scripted agent turns, records what the candidate sent.
function fakeClient({ script = null, failOnSend = null, failOnConnect = null } = {}) {
  const queue = Array.isArray(script) ? script.slice() : null;
  const sent = [];
  return {
    sent,
    async connect() { if (failOnConnect) throw Object.assign(new Error('x'), { kind: failOnConnect }); },
    async receiveTurn() {
      if (queue) return queue.length ? queue.shift() : { text: '', ended: true };
      return { text: 'hola', ended: false };
    },
    async sendTurn(text) {
      sent.push(text);
      if (failOnSend) throw Object.assign(new Error('x'), { kind: failOnSend });
      if (queue) return queue.length ? queue.shift() : { text: '', ended: true };
      return { text: 'gracias', ended: true };
    },
    async disconnect() {},
  };
}

function scriptedAsk(answers) {
  const a = answers.slice();
  return async () => (a.length ? a.shift() : '');
}

function collector() {
  let buf = '';
  return { write: (s) => { buf += s; }, get: () => buf };
}

function baseDeps(overrides = {}) {
  return {
    loadAuthSession: () => ACTIVE_SESSION,
    sessionStatus: () => 'active',
    saveAuthSession: () => {},
    getSignUpEndpoint: () => 'https://hub/api/v1/auth/register/talent/email',
    getLoginEndpoint: () => 'https://certs/api/v1/auth/login/email',
    requestSignUp: async () => ({ ok: true, accountExists: false, accessToken: 'hub-jwt' }),
    requestLogin: async () => ({ ok: true, accessToken: 'certs-tok', hubAccessToken: 'hub-jwt', email: 't@t.com', expiresAt: Date.now() + 3600000 }),
    getImportProfileEndpoint: () => 'https://hub/api/v1/works/me/import-profile',
    getProfessionalDetailsEndpoint: () => 'https://certs/api/v1/works/me/professional-details',
    getPricingRateEndpoint: () => 'https://certs/api/v1/works/talents/me/work-details/pricing-rate',
    getSetAvailabilityEndpoint: () => 'https://hub/api/v1/works/talents/me/work-details/availability',
    getOnboardingInterviewsEndpoint: () => 'https://certs/api/v1/interviews',
    getCompleteOnboardingEndpoint: () => 'https://certs/api/v1/works/talents/me/complete-onboarding',
    getTalentProfileUrl: () => 'https://shakers.test/talent/profile',
    getUsageDiscoveredInventoryEndpoint: () => 'https://certs/api/v1/usage/discovered-inventory',
    requestImportProfile: async () => ({ ok: true, jobId: 'job-1', state: 'running' }),
    requestImportStatus: async () => ({ ok: true, state: 'done' }),
    requestSetProfessionalDetails: async () => ({ ok: true }),
    requestSetPricingRate: async () => ({ ok: true }),
    requestSetAvailability: async () => ({ ok: true }),
    requestCreateOnboardingInterview: async () => ({ ok: true, interviewId: 'iv-1', created: true, language: 'es' }),
    requestStartTextSession: async () => ({ ok: true, interviewId: 'iv-1', greeting: 'hola' }),
    requestOnboardingTurn: async () => ({ ok: true, response: 'siguiente', ended: true }),
    requestCompleteTextSession: async () => ({ ok: true, state: 'taken' }),
    requestCompleteOnboarding: async () => ({ ok: true, onboardingStatus: 'COMPLETED', registrationLevel: 'ONBOARDING_COMPLETED', completedProfilePercentage: 80 }),
    requestDiscoveredInventory: async () => ({ ok: false, reason: 'no-inventory' }),
    requestStartLivekitSession: async () => ({ ok: true, interviewId: 'iv-1', livekitUrl: 'wss://lk', token: 'tk', roomName: 'r', closingMessage: null }),
    requestCompleteLivekitSession: async () => ({ ok: true }),
    makeInterviewClient: () => fakeClient(),
    ...overrides,
  };
}

test('normalizeFreelanceType: accepts the enum case-insensitively, rejects the rest', () => {
  assert.equal(flow.normalizeFreelanceType('freelance'), 'FREELANCE');
  assert.equal(flow.normalizeFreelanceType('AGENCY'), 'AGENCY');
  assert.equal(flow.normalizeFreelanceType('contractor'), null);
});

test('freelanceIntentRequired: only EMPLOYEE and POTENTIAL_FREELANCE', () => {
  assert.equal(flow.freelanceIntentRequired('EMPLOYEE'), true);
  assert.equal(flow.freelanceIntentRequired('POTENTIAL_FREELANCE'), true);
  assert.equal(flow.freelanceIntentRequired('FREELANCE'), false);
  assert.equal(flow.freelanceIntentRequired('AGENCY'), false);
});

test('validatePricing: fat upsert sends all four fields; unselected variant defaults', () => {
  const res = flow.validatePricing({ fullTimeSelected: true, fullTimeAmount: 5000, fullTimeCurrency: 'EUR', partTimeSelected: false });
  assert.equal(res.ok, true);
  assert.deepEqual(res.pricing, {
    fullTimeProjectSelected: true,
    fullTimeProjectPrice: { amount: 5000, currency: 'EUR' },
    partTimeProjectSelected: false,
    partTimeProjectPrice: { amount: 0, currency: 'EUR' },
  });
});

test('validatePricing: at least one variant, valid amount range and currency', () => {
  assert.equal(flow.validatePricing({ fullTimeSelected: false, partTimeSelected: false }).reason, 'no-variant');
  assert.equal(flow.validatePricing({ fullTimeSelected: true, fullTimeAmount: -1, fullTimeCurrency: 'EUR' }).reason, 'bad-full-amount');
  assert.equal(flow.validatePricing({ fullTimeSelected: true, fullTimeAmount: 1000000, fullTimeCurrency: 'EUR' }).reason, 'bad-full-amount');
  assert.equal(flow.validatePricing({ fullTimeSelected: true, fullTimeAmount: 100, fullTimeCurrency: 'BTC' }).reason, 'bad-full-currency');
});

test('normalizeAmount: plain numbers ok, thousands separators and >2 decimals rejected', () => {
  assert.equal(flow.normalizeAmount('60000'), 60000);
  assert.equal(flow.normalizeAmount('1500.50'), 1500.5);
  assert.equal(flow.normalizeAmount('85'), 85);
  assert.equal(flow.normalizeAmount('999999.99'), 999999.99);
  assert.equal(flow.normalizeAmount('0'), 0);
  assert.equal(flow.normalizeAmount(60000), 60000);
  assert.equal(flow.normalizeAmount('60.000'), null, '3 decimals is invalid, never 60');
  assert.equal(flow.normalizeAmount('60,000'), null, 'thousands separator invalid');
  assert.equal(flow.normalizeAmount('1,500.50'), null);
  assert.equal(flow.normalizeAmount('1000000'), null, 'above the max');
  assert.equal(flow.normalizeAmount('12.345'), null, 'more than 2 decimals');
  assert.equal(flow.normalizeAmount(60.005), null, 'numeric input with >2 decimals');
  assert.equal(flow.normalizeAmount(''), null);
  assert.equal(flow.normalizeAmount('abc'), null);
});

test('validatePricing: 60.000 is rejected as bad-full-amount, not stored as 60', () => {
  assert.equal(flow.validatePricing({ fullTimeSelected: true, fullTimeAmount: '60.000', fullTimeCurrency: 'EUR' }).reason, 'bad-full-amount');
  assert.equal(flow.validatePricing({ fullTimeSelected: true, fullTimeAmount: '60,000', fullTimeCurrency: 'EUR' }).reason, 'bad-full-amount');
  const ok = flow.validatePricing({ fullTimeSelected: true, fullTimeAmount: '60000', fullTimeCurrency: 'EUR' });
  assert.equal(ok.ok, true);
  assert.equal(ok.pricing.fullTimeProjectPrice.amount, 60000);
});

test('saveWorkSituation: validates situation/participation/opinion/motivation branching (ADR-036)', async () => {
  const deps = baseDeps();
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'nope' })).reason, 'bad-situation');
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'employed' })).reason, 'bad-participation');
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'employed', participation: 'full_time' })).reason, 'bad-opinion');
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'employed', participation: 'full_time', opinion: 'not_interested' })).ok, true);
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'between_jobs' })).reason, 'bad-opinion');
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'between_jobs', opinion: 'not_interested' })).ok, true, 'not_interested never needs motivation');
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'between_jobs', opinion: 'open_to_freelance' })).reason, 'bad-motivation');
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'between_jobs', opinion: 'open_to_freelance', changeMotivators: 'flexibility' })).ok, true);
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'freelance' })).reason, 'bad-motivation');
  assert.equal((await flow.saveWorkSituation(deps, { situation: 'freelance', changeMotivators: 'community' })).ok, true);
});

test('deriveCurrentEmploymentStatus / deriveFreelanceIntent: match works-frontend answers.ts byte-for-byte', () => {
  assert.equal(flow.deriveCurrentEmploymentStatus({ situation: 'FREELANCE' }), 'FREELANCE');
  assert.equal(flow.deriveCurrentEmploymentStatus({ situation: 'EMPLOYED', participation: 'FULL_TIME' }), 'IN_HOUSE_FULL_TIME');
  assert.equal(flow.deriveCurrentEmploymentStatus({ situation: 'EMPLOYED', participation: 'PART_TIME' }), 'IN_HOUSE_PART_TIME');
  assert.equal(flow.deriveCurrentEmploymentStatus({ situation: 'EMPLOYED' }), null, 'no participation yet');
  assert.equal(flow.deriveFreelanceIntent({ situation: 'FREELANCE' }), 'ALREADY_FREELANCE');
  assert.equal(flow.deriveFreelanceIntent({ situation: 'STUDYING', opinion: 'WAS_FREELANCE_BEFORE' }), 'WAS_FREELANCE_BEFORE');
  assert.equal(flow.showsFreelanceOpinion('FREELANCE'), false);
  assert.equal(flow.showsFreelanceOpinion('OTHER'), true);
  assert.equal(flow.showsChangeMotivators('ALREADY_FREELANCE'), true);
  assert.equal(flow.showsChangeMotivators('OPEN_TO_FREELANCE'), true);
  assert.equal(flow.showsChangeMotivators('WAS_FREELANCE_BEFORE'), true);
  assert.equal(flow.showsChangeMotivators('NOT_INTERESTED'), false);
});

test('validateLanguageRows: validates level enum, rejects empty/duplicate rows', () => {
  assert.equal(flow.validateLanguageRows([]).reason, 'no-languages');
  assert.equal(flow.validateLanguageRows([{ language: 'es', level: 'nope' }]).reason, 'bad-level');
  assert.equal(flow.validateLanguageRows([{ language: '', level: 'NATIVE' }]).reason, 'bad-language');
  assert.equal(flow.validateLanguageRows([{ language: 'es', level: 'native' }, { language: 'es', level: 'advanced' }]).reason, 'duplicate-language');
  const ok = flow.validateLanguageRows([{ language: 'ES', level: 'native' }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.rows, [{ language: 'es', level: 'NATIVE' }]);
});

test('validatePhone: requires both fields, caps length', () => {
  assert.equal(flow.validatePhone({}).reason, 'missing-phone');
  assert.equal(flow.validatePhone({ telephoneCode: '+34' }).reason, 'missing-phone');
  assert.equal(flow.validatePhone({ telephoneCode: '+34', telephoneNumber: '600111222' }).ok, true);
  assert.equal(flow.validatePhone({ telephoneCode: 'x'.repeat(11), telephoneNumber: '600111222' }).reason, 'bad-telephone-code');
});

test('every step gates on an active session', async () => {
  const deps = baseDeps({ sessionStatus: () => 'expired' });
  assert.equal((await flow.startProfileImport(deps, { linkedinUrl: 'x' })).reason, 'no-session');
  assert.equal((await flow.savePricing(deps, { fullTimeSelected: true, fullTimeAmount: 1, fullTimeCurrency: 'EUR' })).reason, 'no-session');
  assert.equal((await flow.createOnboardingInterview(deps, {})).reason, 'no-session');
});

test('detectPriorUsage: 404 inventory -> hasEvidence false; populated -> true; error -> null', async () => {
  assert.equal((await flow.detectPriorUsage(baseDeps())).hasEvidence, false);
  const withEvidence = baseDeps({ requestDiscoveredInventory: async () => ({ ok: true, skills: [{ skillId: 1 }], agents: [] }) });
  assert.equal((await flow.detectPriorUsage(withEvidence)).hasEvidence, true);
  const errored = baseDeps({ requestDiscoveredInventory: async () => ({ ok: false, reason: 'network-error' }) });
  assert.equal((await flow.detectPriorUsage(errored)).hasEvidence, null);
});

test('createOnboardingInterview: candidateId is the talent UUID, never the email', async () => {
  let seen = null;
  const deps = baseDeps({ requestCreateOnboardingInterview: async ({ candidateId }) => { seen = candidateId; return { ok: true, interviewId: 'iv' }; } });
  await flow.createOnboardingInterview(deps, {});
  assert.equal(seen, TALENT_UUID);
});

test('createOnboardingInterview: falls back to the JWT sub when no userId is persisted', async () => {
  let seen = null;
  const payload = Buffer.from(JSON.stringify({ sub: '99999999-8888-7777-6666-555555555555' })).toString('base64url');
  const deps = baseDeps({
    loadAuthSession: () => ({ accessToken: `h.${payload}.s`, hubAccessToken: 'hub', email: 't@t.com' }),
    requestCreateOnboardingInterview: async ({ candidateId }) => { seen = candidateId; return { ok: true, interviewId: 'iv' }; },
  });
  await flow.createOnboardingInterview(deps, {});
  assert.equal(seen, '99999999-8888-7777-6666-555555555555');
});

test('createOnboardingInterview: an email override is ignored (server needs a UUID)', async () => {
  let seen = null;
  const deps = baseDeps({ requestCreateOnboardingInterview: async ({ candidateId }) => { seen = candidateId; return { ok: true, interviewId: 'iv' }; } });
  await flow.createOnboardingInterview(deps, { candidateId: 'someone@example.com' });
  assert.equal(seen, TALENT_UUID);
});

function scriptedIo(answers, confirms) {
  const a = answers.slice();
  const c = confirms.slice();
  return {
    lang: 'es',
    notes: [],
    disclaimers: [],
    section() {},
    notify(t) { this.notes.push(t); },
    error(t) { this.notes.push(t); },
    warn(t) { this.notes.push(t); },
    disclaimer(info, goal) { this.disclaimers.push([info, goal]); },
    async ask() { return a.shift() ?? ''; },
    async confirm() { return c.shift() ?? false; },
    async askSignUp() { return { name: 'Ada', lastName: 'Lovelace', email: 't@t.com', password: 'password123', newsletterConsent: false, freelanceType: 'FREELANCE' }; },
    async login() { this.loggedIn = true; return true; },
    async askWorkSituation() { this.askedWorkSituation = true; return { situation: 'FREELANCE', changeMotivators: 'HIGHER_RATE' }; },
    async askPricing() { return { fullTimeSelected: true, fullTimeAmount: 5000, fullTimeCurrency: 'EUR', partTimeSelected: false }; },
    async askAvailability() { this.askedAvailability = true; return { available: true, monthlyHours: '80', workModes: ['REMOTE', 'HYBRID'], country: 'es', timezone: 'Europe/Madrid', longFullTimeProjects: true }; },
    async askLanguages() { this.askedLanguages = true; return [{ language: 'es', level: 'NATIVE' }]; },
    async runUsage() { this.ranUsage = true; },
    async interviewLoop({ open, turn }) { const s = await open(); this.greeting = s.greeting; await turn('respuesta'); return { ok: true }; },
  };
}

test('reattachConsentIdentity (A): re-anchors consent to the session email as a verified grant', () => {
  const calls = [];
  const deps = baseDeps({
    loadAuthSession: () => ({ email: 'nuevo@talent.com', accessToken: 'a', hubAccessToken: 'h' }),
    sessionStatus: () => 'active',
    recordConsent: (decision, email, opts) => { calls.push([decision, email, opts]); },
  });
  const res = flow.reattachConsentIdentity(deps);
  assert.equal(res.ok, true);
  assert.equal(res.email, 'nuevo@talent.com');
  assert.deepEqual(calls, [['granted', 'nuevo@talent.com', { verified: true }]]);
});

test('reattachConsentIdentity (A): no-ops safely without a session email or the recordConsent dep', () => {
  assert.equal(flow.reattachConsentIdentity(baseDeps({ loadAuthSession: () => ({ email: '' }), recordConsent: () => {} })).reason, 'no-session-email');
  assert.equal(flow.reattachConsentIdentity(baseDeps({ sessionStatus: () => 'expired', recordConsent: () => {} })).reason, 'no-session');
  assert.equal(flow.reattachConsentIdentity(baseDeps({ recordConsent: undefined })).reason, 'unsupported');
});

test('completeOnboardingRegistration: gates on session, needs an endpoint, echoes status', async () => {
  assert.equal((await flow.completeOnboardingRegistration(baseDeps({ sessionStatus: () => 'expired' }))).reason, 'no-session');
  assert.equal((await flow.completeOnboardingRegistration(baseDeps({ getCompleteOnboardingEndpoint: () => null }))).reason, 'no-endpoint');
  const res = await flow.completeOnboardingRegistration(baseDeps());
  assert.equal(res.ok, true);
  assert.equal(res.registrationLevel, 'ONBOARDING_COMPLETED');
});

test('MONTHLY_HOURS: mirrors the hub AvailabilityMonthlyHours VO in full (40/60/80/100/120/160/> 160)', () => {
  assert.deepEqual(flow.MONTHLY_HOURS, ['40', '60', '80', '100', '120', '160', '> 160']);
});

test('normalizeMonthlyHours: accepts every hub enum string incl. 60/100/> 160, rejects ints and unknowns', () => {
  assert.equal(flow.normalizeMonthlyHours('80'), '80');
  assert.equal(flow.normalizeMonthlyHours('160'), '160');
  assert.equal(flow.normalizeMonthlyHours(' 40 '), '40');
  assert.equal(flow.normalizeMonthlyHours('60'), '60', 'the hub VO accepts 60');
  assert.equal(flow.normalizeMonthlyHours('100'), '100', 'the hub VO accepts 100');
  assert.equal(flow.normalizeMonthlyHours('> 160'), '> 160', 'the hub VO accepts the "> 160" bucket verbatim (with the space)');
  assert.equal(flow.normalizeMonthlyHours(' > 160 '), '> 160', 'outer whitespace trimmed, inner space preserved');
  assert.equal(flow.normalizeMonthlyHours(80), null, 'an int is not the enum');
  assert.equal(flow.normalizeMonthlyHours('50'), null, 'an unknown bucket is rejected');
});

test('normalizeCountry: normalizes to 2 uppercase letters, rejects the rest', () => {
  assert.equal(flow.normalizeCountry('es'), 'ES');
  assert.equal(flow.normalizeCountry(' Gb '), 'GB');
  assert.equal(flow.normalizeCountry('ESP'), null, '3 letters rejected');
  assert.equal(flow.normalizeCountry('E1'), null);
  assert.equal(flow.normalizeCountry(''), null);
});

test('validateAvailability: fat-optional body carries only given fields, always confirmed:true', () => {
  const res = flow.validateAvailability({ available: true, monthlyHours: '80', workModes: ['REMOTE', 'hybrid'], country: 'es', timezone: 'Europe/Madrid', longFullTimeProjects: true });
  assert.deepEqual(res.availability, {
    confirmed: true, available: true, monthlyHours: '80', workModes: ['REMOTE', 'HYBRID'], country: 'ES', timezone: 'Europe/Madrid', longFullTimeProjects: true,
  });
  assert.deepEqual(flow.validateAvailability({}).availability, { confirmed: true }, 'nothing given -> only confirmed:true');
  assert.equal(flow.validateAvailability({ monthlyHours: '50' }).reason, 'bad-monthly-hours');
  assert.equal(flow.validateAvailability({ monthlyHours: 80 }).reason, 'bad-monthly-hours');
  assert.equal(flow.validateAvailability({ country: 'ESP' }).reason, 'bad-country');
  // workModes: multi-value, deduped, enum-validated; onlyRemote is no longer emitted.
  assert.deepEqual(flow.validateAvailability({ workModes: ['REMOTE', 'REMOTE'] }).availability, { confirmed: true, workModes: ['REMOTE'] });
  assert.equal(flow.validateAvailability({ workModes: ['REMOTE', 'NOPE'] }).reason, 'bad-work-modes');
  assert.equal(flow.validateAvailability({ workModes: 'REMOTE' }).reason, 'bad-work-modes');
  assert.equal(flow.validateAvailability({ workModes: [] }).availability.workModes, undefined, 'empty array sends no workModes');
});

test('validateAvailability: the "> 160" bucket passes through verbatim (with the space)', () => {
  const res = flow.validateAvailability({ monthlyHours: '> 160' });
  assert.equal(res.ok, true);
  assert.equal(res.availability.monthlyHours, '> 160');
});

test('saveAvailability: gates on session, needs an endpoint, PUTs the validated body', async () => {
  assert.equal((await flow.saveAvailability(baseDeps({ sessionStatus: () => 'expired' }), {})).reason, 'no-session');
  assert.equal((await flow.saveAvailability(baseDeps({ getSetAvailabilityEndpoint: () => null }), {})).reason, 'no-endpoint');
  let sent = null;
  const deps = baseDeps({ requestSetAvailability: async ({ availability }) => { sent = availability; return { ok: true }; } });
  const res = await flow.saveAvailability(deps, { available: true, monthlyHours: '120', country: 'us' });
  assert.equal(res.ok, true);
  assert.deepEqual(sent, { confirmed: true, available: true, monthlyHours: '120', country: 'US' });
});

test('runOnboarding: accepting the availability step sends the collected fields (confirmed:true, ISO-2 country)', async () => {
  let sent = null;
  const deps = baseDeps({ requestSetAvailability: async ({ availability }) => { sent = availability; return { ok: true }; } });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [true, false, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.equal(io.askedAvailability, true);
  assert.deepEqual(sent, { confirmed: true, available: true, monthlyHours: '80', workModes: ['REMOTE', 'HYBRID'], country: 'ES', timezone: 'Europe/Madrid', longFullTimeProjects: true });
});

test('runOnboarding: declining the availability step sends nothing', async () => {
  let called = false;
  const deps = baseDeps({ requestSetAvailability: async () => { called = true; return { ok: true }; } });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, false, false]);
  await flow.runOnboarding(io, deps);
  assert.equal(called, false, 'no availability write when the step is skipped');
  assert.notEqual(io.askedAvailability, true);
});

test('runOnboarding: a completed interview still ends on the profile link, and opens it', async () => {
  const opened = [];
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, true, true]);
  const res = await flow.runOnboarding(io, baseDeps(), { openProfile: (url) => opened.push(url) });
  assert.equal(res.completed, 'interview');
  assert.equal(res.profileUrl, 'https://shakers.test/talent/profile');
  assert.ok(io.notes.some((n) => n.includes('https://shakers.test/talent/profile')), 'the link is printed');
  assert.deepEqual(opened, ['https://shakers.test/talent/profile']);
});

test('runOnboarding: without openProfile the link is only printed', async () => {
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, false, false]);
  const res = await flow.runOnboarding(io, baseDeps());
  assert.equal(res.completed, 'skipped-interview');
  assert.ok(io.notes.some((n) => n.includes('https://shakers.test/talent/profile')));
});

test('runOnboarding: a failed availability write is fail-soft (warns, does not abort the alta)', async () => {
  let finalizeCalls = 0;
  const deps = baseDeps({
    requestSetAvailability: async () => ({ ok: false, reason: 'http-500' }),
    requestCompleteOnboarding: async () => { finalizeCalls += 1; return { ok: true }; },
  });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [true, false, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true, 'a failed availability write does not abort registration');
  assert.equal(finalizeCalls, 1);
});

test('runOnboarding: happy path — no prior evidence, usage accepted, interview taken, THEN finalized', async () => {
  let finalizeCalls = 0;
  const deps = baseDeps({ requestCompleteOnboarding: async () => { finalizeCalls += 1; return { ok: true, completedProfilePercentage: 90 }; } });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, true, true]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.equal(res.completed, 'interview');
  assert.equal(res.finalized, true);
  assert.equal(finalizeCalls, 1, 'onboarding is marked complete on the interview path');
  assert.equal(io.ranUsage, true);
  assert.equal(io.disclaimers.length, 2, 'both step-4 and step-5 disclaimers shown separately');
});

test('runOnboarding: step-5 runs over LiveKit; a missing @livekit/rtc-node prints the hint, finalizes the alta, ends clean', async () => {
  let finalizeCalls = 0;
  const deps = baseDeps({
    requestCompleteOnboarding: async () => { finalizeCalls += 1; return { ok: true, completedProfilePercentage: 70 }; },
    makeInterviewClient: () => fakeClient({ failOnConnect: 'livekit-not-installed' }),
  });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, true, true]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true, 'a missing native dep must not abort registration');
  assert.equal(res.completed, 'interview-unavailable');
  assert.equal(res.reason, 'livekit-not-installed');
  assert.equal(res.finalized, true);
  assert.equal(finalizeCalls, 1, 'the alta is still finalized when the interview cannot run');
  assert.equal(res.profileUrl, 'https://shakers.test/talent/profile');
  assert.ok(io.notes.some((n) => /npm install --omit=dev --prefix .* @livekit\/rtc-node/.test(n)), 'the actionable install hint is shown');
});

test('runOnboarding: skipping the interview STILL finalizes and returns the profile URL', async () => {
  let finalizeCalls = 0;
  const deps = baseDeps({ requestCompleteOnboarding: async () => { finalizeCalls += 1; return { ok: true, completedProfilePercentage: 60 }; } });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.equal(res.completed, 'skipped-interview');
  assert.equal(res.finalized, true);
  assert.equal(finalizeCalls, 1, 'the skip-interview terminal path also marks onboarding complete');
  assert.equal(res.profileUrl, 'https://shakers.test/talent/profile');
});

test('runOnboarding: a failing finalization warns but does not crash a finished onboarding', async () => {
  const deps = baseDeps({ requestCompleteOnboarding: async () => ({ ok: false, reason: 'http-422' }) });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.equal(res.finalized, false);
  assert.ok(io.notes.some((n) => /http-422/.test(n)), 'the finalize failure is surfaced to the talent');
});

test('runOnboarding: prior evidence skips the usage step (offer only the interview)', async () => {
  const deps = baseDeps({ requestDiscoveredInventory: async () => ({ ok: true, skills: [{ skillId: 1 }], agents: [] }) });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.notEqual(io.ranUsage, true);
  assert.equal(io.disclaimers.length, 1, 'only the interview disclaimer is shown when usage is skipped by evidence');
});

test('runOnboarding: the work-situation step is mandatory and saved before pricing', async () => {
  let sent = null;
  const deps = baseDeps({ requestSetProfessionalDetails: async (args) => { sent = args; return { ok: true }; } });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.equal(io.askedWorkSituation, true);
  assert.equal(sent.currentEmploymentStatus, 'FREELANCE');
  assert.equal(sent.freelanceIntent, 'ALREADY_FREELANCE');
  assert.equal(sent.changeMotivators, 'HIGHER_RATE');
});

test('runOnboarding: a rejected work-situation aborts before pricing', async () => {
  const deps = baseDeps();
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, false, false, false]);
  io.askWorkSituation = async () => ({ situation: 'nope' });
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'bad-situation');
  assert.equal(res.step, 'work-situation');
});

test('runOnboarding: accepting the languages step upserts the collected rows', async () => {
  let sent = null;
  const deps = baseDeps({
    getLanguagesCatalogEndpoint: () => 'https://hub/api/v1/static-data/languages',
    getLanguagesEndpoint: () => 'https://hub/api/v1/works/talents/me/work-details/languages',
    requestLanguagesCatalog: async () => ({ ok: true, languages: [{ numId: 1, name: 'Spanish', code: 'es' }] }),
    requestSetLanguages: async ({ languages }) => { sent = languages; return { ok: true }; },
  });
  const io = scriptedIo(['https://linkedin/in/me', '', '', '', 'FREELANCE'], [false, true, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.equal(io.askedLanguages, true);
  assert.deepEqual(sent, [{ id: 1, level: 'NATIVE' }]);
});

test('signUp: no longer asks/validates freelanceType; sends a transient default, still gates on password', async () => {
  let sent = null;
  const deps = baseDeps({ requestSignUp: async (f) => { sent = f; return { ok: true }; } });
  // weak password still blocks before the network
  assert.equal((await flow.signUp(deps, { name: 'A', lastName: 'B', email: 'e@e.com', password: 'short' })).reason, 'weak-password');
  assert.equal(sent, null, 'no request is made when validation fails');
  // no freelanceType supplied: signUp sends the transient default POTENTIAL_FREELANCE
  assert.equal((await flow.signUp(deps, { name: 'A', lastName: 'B', email: 'e@e.com', password: 'password123' })).ok, true);
  assert.equal(sent.freelanceType, 'POTENTIAL_FREELANCE');
});

test('signUp: an already-existing email surfaces accountExists', async () => {
  const deps = baseDeps({ requestSignUp: async () => ({ ok: true, accountExists: true }) });
  const r = await flow.signUp(deps, { name: 'A', lastName: 'B', email: 'e@e.com', password: 'password123' });
  assert.equal(r.accountExists, true);
});

test('establishSessionFromCredentials: logs in and persists the dual-token session', async () => {
  let saved = null;
  const deps = baseDeps({ saveAuthSession: (s) => { saved = s; } });
  const r = await flow.establishSessionFromCredentials(deps, { email: 't@t.com', password: 'password123' });
  assert.equal(r.ok, true);
  assert.equal(saved.accessToken, 'certs-tok');
  assert.equal(saved.hubAccessToken, 'hub-jwt');
});

test('runOnboarding: sign-up creates the account then continues (no prior login required)', async () => {
  let signedUp = false;
  const deps = baseDeps({ requestSignUp: async () => { signedUp = true; return { ok: true, accountExists: false, accessToken: 'hub-jwt' }; } });
  const io = scriptedIo(['https://linkedin/in/me', '', '', ''], [false, false, true, true]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.equal(signedUp, true);
  assert.equal(res.completed, 'interview');
});

test('runOnboarding: an existing (email) account signs in and STOPS — no onboarding wizard re-run', async () => {
  const deps = baseDeps({ requestSignUp: async () => ({ ok: true, accountExists: true }) });
  const io = scriptedIo(['https://linkedin/in/me', '', '', ''], [false, false, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true);
  assert.equal(res.alreadyRegistered, true, 'the result flags that the account already existed');
  assert.equal(io.loggedIn, true, 'the account-exists path runs login');
  assert.equal(io.askedWorkSituation, undefined, 'the wizard (work-situation/pricing/...) is never reached');
  assert.equal(io.ranUsage, undefined, 'the usage scan is never reached');
});

test('runOnboarding: an existing (Google) account signs in and STOPS — no onboarding wizard re-run', async () => {
  const deps = baseDeps({
    getDeviceAuthorizeEndpoint: () => 'https://h/auth/device/code',
    getDeviceTokenEndpoint: () => 'https://h/works/auth/device/token',
    getAuthTokenEndpoint: () => 'https://h/auth/token',
    getCompleteRegistrationEndpoint: () => 'https://h/works/auth/complete-registration',
    buildRegistrationContext: require('../src/signup-client').buildRegistrationContext,
    // The device flow signed an EXISTING account in (isNewUser false).
    runDeviceLogin: async () => ({ ok: true, token: 'JWT', sessionToken: 'SESS', isNewUser: false, email: 'g@x.com' }),
  });
  const io = scriptedIo(['https://linkedin/in/me', '', '', ''], [false, false, false, false]);
  io.askGoogleSignUp = async () => ({});
  const res = await flow.runOnboarding(io, deps, { method: 'google' });
  assert.equal(res.ok, true);
  assert.equal(res.alreadyRegistered, true);
  assert.equal(io.askedWorkSituation, undefined, 'the wizard is never reached for an existing Google account');
});

test('runOnboarding: a failed import is fail-soft — warns and continues to complete-onboarding', async () => {
  let finalizeCalls = 0;
  const deps = baseDeps({
    requestImportProfile: async () => ({ ok: false, reason: 'http-500' }),
    requestCompleteOnboarding: async () => { finalizeCalls += 1; return { ok: true, completedProfilePercentage: 40 }; },
  });
  const io = scriptedIo(['https://linkedin/in/me', '', '', ''], [false, false, false, false]);
  const res = await flow.runOnboarding(io, deps);
  assert.equal(res.ok, true, 'the import failure does not abort register');
  assert.equal(finalizeCalls, 1, 'complete-onboarding still runs');
  const { getCatalog } = require('../src/i18n');
  assert.ok(io.notes.includes(getCatalog('es').onboarding.importUnavailable), 'the talent is warned the import was skipped');
});

test('runOnboardingInterview: gates on session', async () => {
  const io = scriptedIo([], []);
  const res = await flow.runOnboardingInterview(io, baseDeps({ sessionStatus: () => 'expired' }));
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-session');
});

test('runOnboardingInterview: interview-only happy path reuses the shared loop, never finalizes registration', async () => {
  let finalizeCalls = 0;
  const deps = baseDeps({ requestCompleteOnboarding: async () => { finalizeCalls += 1; return { ok: true }; } });
  const io = scriptedIo([], [true]);
  const res = await flow.runOnboardingInterview(io, deps);
  assert.equal(res.ok, true);
  assert.equal(res.completed, 'interview');
  assert.equal(io.greeting, 'hola');
  assert.equal(finalizeCalls, 0, 'the interview-only command must not call complete-onboarding');
  assert.equal(io.disclaimers.length, 1, 'the interview disclaimer is shown before starting');
});

test('runOnboardingInterview: declining shows the profile URL and does not start an interview', async () => {
  const io = scriptedIo([], [false]);
  const res = await flow.runOnboardingInterview(io, baseDeps());
  assert.equal(res.ok, true);
  assert.equal(res.completed, 'skipped');
  assert.notEqual(io.greeting, 'hola');
});

test('runOnboarding: aborts without a LinkedIn URL', async () => {
  const io = scriptedIo(['', '', '', '', 'FREELANCE'], []);
  const res = await flow.runOnboarding(io, baseDeps());
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-linkedin');
});

// conductLivekitInterview: the onboarding interview over LiveKit text, driven
// through the real makeIo presentation loop against a fake InterviewClient.
function livekitIo(answers) {
  const out = collector();
  const io = makeIo({ ask: scriptedAsk(answers), lang: 'en', out: out.write, acceptDisclaimer: true, stdinIsTTY: false });
  return { io, out };
}

test('conductLivekitInterview: a livekit-not-installed connect failure surfaces the actionable install hint', async () => {
  const { io, out } = livekitIo([]);
  const deps = baseDeps({ makeInterviewClient: () => fakeClient({ failOnConnect: 'livekit-not-installed' }) });
  const res = await flow.conductLivekitInterview(io, deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'livekit-not-installed');
  assert.equal(res.step, 'interview');
  assert.match(out.get(), /npm install --omit=dev --prefix .* @livekit\/rtc-node/);
});

test('conductLivekitInterview: a failed start (create/session) returns the reason and never connects', async () => {
  const { io } = livekitIo([]);
  let connected = false;
  const deps = baseDeps({
    requestStartLivekitSession: async () => ({ ok: false, reason: 'no-session' }),
    makeInterviewClient: () => ({ async connect() { connected = true; }, async disconnect() {} }),
  });
  const res = await flow.conductLivekitInterview(io, deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-session');
  assert.equal(connected, false);
});

test('conductLivekitInterview: happy path PATCHes /complete with the buffered transcript (greeting+closing, roles, monotonic timeInCallSecs)', async () => {
  const { io } = livekitIo(['I build APIs', 'not really']);
  let completeArgs = null;
  let completeOpts = null;
  const deps = baseDeps({
    requestStartLivekitSession: async () => ({ ok: true, interviewId: 'iv-1', livekitUrl: 'wss://x', token: 't', roomName: 'r' }),
    requestCompleteLivekitSession: async (args, opts) => { completeArgs = args; completeOpts = opts; return { ok: true }; },
    makeInterviewClient: () => fakeClient({ script: [
      { text: 'Welcome! Tell me about your work.', ended: false }, // greeting
      { text: 'Great, anything else?', ended: false },
      { text: 'Thanks, all done.', ended: true }, // closing
    ] }),
  });
  const res = await flow.conductLivekitInterview(io, deps);
  assert.deepEqual(res, { ok: true, completed: 'interview', interviewId: 'iv-1' });

  assert.ok(completeArgs, 'complete was called');
  assert.equal(completeArgs.interviewId, 'iv-1');
  assert.equal(completeOpts.base, 'https://certs/api/v1/interviews');
  assert.equal(Number.isInteger(completeArgs.durationSeconds), true);
  const t = completeArgs.transcripts;
  assert.equal(t.length, 5, 'greeting + 2 answers + 2 agent replies');
  assert.deepEqual(t.map((x) => x.role), ['AGENT', 'USER', 'AGENT', 'USER', 'AGENT']);
  assert.equal(t[0].message, 'Welcome! Tell me about your work.'); // greeting counted
  assert.equal(t[t.length - 1].message, 'Thanks, all done.'); // closing counted
  assert.equal(t[0].timeInCallSecs, 0);
  for (let i = 1; i < t.length; i++) assert.ok(t[i].timeInCallSecs >= t[i - 1].timeInCallSecs);
});

test('conductLivekitInterview: an interrupted turn still persists the turns captured so far and returns the reason', async () => {
  const { io } = livekitIo(['my answer']);
  let completeArgs = null;
  const deps = baseDeps({
    requestCompleteLivekitSession: async (args) => { completeArgs = args; return { ok: true }; },
    makeInterviewClient: () => fakeClient({ script: [{ text: 'Opening?', ended: false }], failOnSend: 'turn-timeout' }),
  });
  const res = await flow.conductLivekitInterview(io, deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'turn-timeout');
  assert.ok(completeArgs, 'transcript persisted despite interruption');
  assert.deepEqual(completeArgs.transcripts.map((x) => x.role), ['AGENT', 'USER']);
});

test('conductLivekitInterview: a failed /complete warns but does not crash the finished interview', async () => {
  const { io, out } = livekitIo(['an answer']);
  const deps = baseDeps({
    requestCompleteLivekitSession: async () => ({ ok: false, reason: 'http-500' }),
    makeInterviewClient: () => fakeClient({ script: [
      { text: 'Opening?', ended: false },
      { text: 'Done.', ended: true },
    ] }),
  });
  const res = await flow.conductLivekitInterview(io, deps);
  assert.equal(res.ok, true);
  assert.equal(res.completed, 'interview');
  assert.match(out.get(), /could not save the interview transcript \(http-500\)/);
});
