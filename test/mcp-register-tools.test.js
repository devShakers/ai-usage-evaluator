'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeRegisterTools } = require('../src/mcp-register-tools');

const ACTIVE_SESSION = { accessToken: 'tok', hubAccessToken: 'hub', email: 't@t.com', userId: '11111111-2222-3333-4444-555555555555' };

// A fake InterviewClient (LiveKit): the agent opens with a greeting, then replies per sendTurn.
function fakeClient({ script = null, greeting = 'hola', reply = 'next', endsOnReply = false, failOnConnect = null, failOnSend = null } = {}) {
  const queue = Array.isArray(script) ? script.slice() : null;
  const sent = [];
  let disconnected = false;
  return {
    sent,
    get disconnected() { return disconnected; },
    async connect() { if (failOnConnect) throw Object.assign(new Error('x'), { kind: failOnConnect }); },
    async receiveTurn() {
      if (queue) return queue.length ? queue.shift() : { text: '', ended: true };
      return { text: greeting, ended: false };
    },
    async sendTurn(text) {
      sent.push(text);
      if (failOnSend) throw Object.assign(new Error('x'), { kind: failOnSend });
      if (queue) return queue.length ? queue.shift() : { text: '', ended: true };
      return { text: reply, ended: endsOnReply };
    },
    async disconnect() { disconnected = true; },
  };
}

function flowDeps(overrides = {}) {
  return {
    loadAuthSession: () => ACTIVE_SESSION,
    sessionStatus: () => 'active',
    saveAuthSession: () => {},
    getSignUpEndpoint: () => 'https://hub/api/v1/auth/register/talent/email',
    getLoginEndpoint: () => 'https://certs/api/v1/auth/login/email',
    requestSignUp: async () => ({ ok: true, accountExists: false, accessToken: 'hub-jwt' }),
    requestLogin: async () => ({ ok: true, accessToken: 'certs-tok', hubAccessToken: 'hub-jwt', email: 't@t.com', expiresAt: Date.now() + 3600000 }),
    getImportProfileEndpoint: () => 'https://hub/api/v1/works/me/import-profile',
    getProfessionalDetailsEndpoint: () => 'https://certs/works/me/professional-details',
    getPricingRateEndpoint: () => 'https://certs/works/talents/me/work-details/pricing-rate',
    getOnboardingInterviewsEndpoint: () => 'https://certs/interviews',
    getCompleteOnboardingEndpoint: () => 'https://certs/works/talents/me/complete-onboarding',
    getTalentProfileUrl: () => 'https://shakers.test/talent/profile',
    getUsageDiscoveredInventoryEndpoint: () => 'https://certs/usage/discovered-inventory',
    requestImportProfile: async () => ({ ok: true, jobId: 'job-1', state: 'running' }),
    requestImportStatus: async () => ({ ok: true, state: 'done' }),
    requestSetProfessionalDetails: async () => ({ ok: true }),
    requestSetPricingRate: async () => ({ ok: true }),
    requestCreateOnboardingInterview: async () => ({ ok: true, interviewId: 'iv-1', created: true }),
    requestStartLivekitSession: async () => ({ ok: true, interviewId: 'iv-1', livekitUrl: 'wss://x', token: 't', roomName: 'r', closingMessage: null }),
    requestCompleteLivekitSession: async () => ({ ok: true }),
    makeInterviewClient: () => fakeClient(),
    requestCompleteOnboarding: async () => ({ ok: true, onboardingStatus: 'COMPLETED', registrationLevel: 'ONBOARDING_COMPLETED', completedProfilePercentage: 70 }),
    requestDiscoveredInventory: async () => ({ ok: false, reason: 'no-inventory' }),
    ...overrides,
  };
}

function toolMap(overrides = {}, extra = {}) {
  const tools = makeRegisterTools({ lang: 'es', flowDeps: flowDeps(overrides), ...extra });
  return Object.fromEntries(tools.map((t) => [t.name, t]));
}


test('the register module keeps the CV and interview tools, and no longer exposes the old register path', () => {
  const t = toolMap();
  for (const name of ['suggest_register_context', 'read_cv', 'onboarding_interview_start', 'onboarding_interview_turn', 'onboarding_interview_complete', 'repeat_onboarding_interview', 'onboarding_finish']) {
    assert.ok(t[name], `missing tool ${name}`);
    assert.ok(t[name].inputSchema, `missing schema for ${name}`);
  }
  for (const gone of ['register', 'register_preview', 'register_status']) assert.equal(t[gone], undefined, `${gone} is removed`);
});

test('onboarding_interview_start: refuses without an acknowledged disclaimer', async () => {
  const t = toolMap();
  const r = await t.onboarding_interview_start.handler({ disclaimerAcknowledged: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'disclaimers-not-acknowledged');
  assert.equal(r.relayVerbatim.length, 2);
});

test('onboarding_interview_start: with acknowledgement connects LiveKit and returns the agent greeting', async () => {
  const client = fakeClient({ greeting: 'Bienvenida, cuentame de tu trabajo.' });
  const t = toolMap({ makeInterviewClient: () => client });
  const r = await t.onboarding_interview_start.handler({ disclaimerAcknowledged: true, answerMode: 'own' });
  assert.equal(r.ok, true);
  assert.equal(r.interviewId, 'iv-1');
  assert.equal(r.greeting, 'Bienvenida, cuentame de tu trabajo.');
  assert.equal(r.ended, false);
});

test('onboarding interview lifecycle: start holds the room, turn reuses it, complete PATCHes + disconnects + clears', async () => {
  const client = fakeClient({ script: [
    { text: 'Hola, cuentame.', ended: false }, // greeting (receiveTurn)
    { text: 'Genial, algo mas?', ended: false }, // reply to answer #1
    { text: 'Gracias, listo.', ended: true }, // reply to answer #2 -> ends
  ] });
  let completeArgs = null;
  const t = toolMap({
    makeInterviewClient: () => client,
    requestCompleteLivekitSession: async (a) => { completeArgs = a; return { ok: true }; },
  });

  const started = await t.onboarding_interview_start.handler({ disclaimerAcknowledged: true, answerMode: 'own' });
  assert.equal(started.ok, true);
  assert.equal(started.greeting, 'Hola, cuentame.');

  const turn1 = await t.onboarding_interview_turn.handler({ interviewId: 'iv-1', message: 'Construyo APIs' });
  assert.deepEqual({ ok: turn1.ok, response: turn1.response, ended: turn1.ended }, { ok: true, response: 'Genial, algo mas?', ended: false });

  const turn2 = await t.onboarding_interview_turn.handler({ interviewId: 'iv-1', message: 'No mucho mas' });
  assert.equal(turn2.ended, true);
  assert.deepEqual(client.sent, ['Construyo APIs', 'No mucho mas'], 'the SAME live client received both turns');

  const done = await t.onboarding_interview_complete.handler({ interviewId: 'iv-1' });
  assert.deepEqual({ ok: done.ok, state: done.state }, { ok: true, state: 'taken' });
  assert.match(done.message, /Interview complete|Entrevista completada/);
  assert.equal(client.disconnected, true, 'the room is disconnected on complete');
  assert.ok(completeArgs, 'the transcript was PATCHed');
  assert.equal(completeArgs.interviewId, 'iv-1');
  assert.deepEqual(completeArgs.transcripts.map((x) => x.role), ['AGENT', 'USER', 'AGENT', 'USER', 'AGENT']);
  assert.equal(Number.isInteger(completeArgs.durationSeconds), true);

  const again = await t.onboarding_interview_turn.handler({ interviewId: 'iv-1', message: 'hola?' });
  assert.equal(again.reason, 'unknown-interview', 'the session is cleared after complete');
});

test('onboarding_interview_complete: remembers the interview so the main-role step waits for its evaluation', async () => {
  const { completedOnboardingInterview } = require('../src/mcp-register-tools');
  const t = toolMap({ makeInterviewClient: () => fakeClient({ script: [{ text: 'Hola', ended: false }, { text: 'Fin', ended: true }] }) });
  await t.onboarding_interview_start.handler({ disclaimerAcknowledged: true, answerMode: 'own' });
  await t.onboarding_interview_turn.handler({ interviewId: 'iv-1', message: 'APIs' });
  const before = Date.now();
  await t.onboarding_interview_complete.handler({ interviewId: 'iv-1' });
  const done = completedOnboardingInterview();
  assert.equal(done.interviewId, 'iv-1');
  assert.ok(done.completedAt >= before);
  assert.match(t.onboarding_interview_complete.description, /set_main_role/);
});

test('onboarding_interview_turn/complete: unknown interviewId returns a clean restart error, never throws', async () => {
  const t = toolMap();
  const turn = await t.onboarding_interview_turn.handler({ interviewId: 'ghost', message: 'x' });
  assert.equal(turn.ok, false);
  assert.equal(turn.reason, 'unknown-interview');
  assert.match(turn.message, /start again/i);
  const done = await t.onboarding_interview_complete.handler({ interviewId: 'ghost' });
  assert.equal(done.ok, false);
  assert.equal(done.reason, 'unknown-interview');
});

test('onboarding_interview_start: LiveKit that cannot load sends the talent to the web and reports kind, os and arch', async () => {
  const { needle } = require('../test-fixtures/copy-needle');
  for (const kind of ['livekit-not-installed', 'livekit-no-text-streams']) {
    const client = fakeClient({ failOnConnect: kind });
    const reported = [];
    const t = toolMap({ makeInterviewClient: () => client }, { reportLivekitFailure: (k) => reported.push(k) });
    const r = await t.onboarding_interview_start.handler({ disclaimerAcknowledged: true, answerMode: 'own' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, kind);
    assert.equal(r.next, 'open_web');
    assert.equal(r.relayVerbatim, needle(require('../src/signup-copy').signupCopy('es').livekitUnavailable));
    assert.doesNotMatch(r.relayVerbatim, /npm install/, 'no install instructions on the MCP surface');
    assert.deepEqual(reported, [kind]);
    assert.equal(client.disconnected, true, 'the half-open client is cleaned up');
    const turn = await t.onboarding_interview_turn.handler({ interviewId: 'iv-1', message: 'x' });
    assert.equal(turn.reason, 'unknown-interview', 'no session was stored');
  }
});

test('onboarding_interview_start: a room that will not connect also offers the web, without a load report', async () => {
  const reported = [];
  const t = toolMap({ makeInterviewClient: () => fakeClient({ failOnConnect: 'connect-failed' }) }, { reportLivekitFailure: (k) => reported.push(k) });
  const r = await t.onboarding_interview_start.handler({ disclaimerAcknowledged: true, answerMode: 'own' });
  assert.equal(r.next, 'open_web');
  assert.deepEqual(reported, [], 'only load failures are reported');
});

test('onboarding_interview_start: the default LiveKit report goes to stderr with os, arch and node', async () => {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    const t = toolMap({ makeInterviewClient: () => fakeClient({ failOnConnect: 'livekit-not-installed' }) });
    await t.onboarding_interview_start.handler({ disclaimerAcknowledged: true, answerMode: 'own' });
  } finally {
    process.stderr.write = orig;
  }
  const line = lines.find((l) => l.includes('livekit-unavailable'));
  assert.ok(line, 'a livekit-unavailable line is written');
  assert.ok(line.includes(`kind=livekit-not-installed os=${process.platform} arch=${process.arch} node=${process.version}`));
});

test('onboarding_interview_start: an interview begun elsewhere points to the web', async () => {
  const t = toolMap({ requestStartLivekitSession: async () => ({ ok: false, reason: 'interview-already-started' }) });
  const r = await t.onboarding_interview_start.handler({ disclaimerAcknowledged: true, answerMode: 'own' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'interview-already-started');
  assert.equal(r.next, 'open_web');
});

test('onboarding_interview_turn: a dropped room persists the partial transcript, tears down, and asks to restart', async () => {
  const client = fakeClient({ failOnSend: 'turn-timeout' });
  let completeArgs = null;
  const t = toolMap({
    makeInterviewClient: () => client,
    requestCompleteLivekitSession: async (a) => { completeArgs = a; return { ok: true }; },
  });
  await t.onboarding_interview_start.handler({ disclaimerAcknowledged: true, answerMode: 'own' });
  const turn = await t.onboarding_interview_turn.handler({ interviewId: 'iv-1', message: 'my answer' });
  assert.equal(turn.ok, false);
  assert.equal(turn.reason, 'turn-timeout');
  assert.equal(client.disconnected, true, 'the broken room is torn down');
  assert.ok(completeArgs, 'the partial transcript (greeting + the answer) was saved');
  assert.deepEqual(completeArgs.transcripts.map((x) => x.role), ['AGENT', 'USER']);
  const again = await t.onboarding_interview_turn.handler({ interviewId: 'iv-1', message: 'again' });
  assert.equal(again.reason, 'unknown-interview', 'the wedged session is gone');
});

test('onboarding_finish: marks completion and returns the moved metrics + profile URL', async () => {
  const t = toolMap();
  const r = await t.onboarding_finish.handler({});
  assert.equal(r.ok, true);
  assert.equal(r.finalized, true);
  assert.equal(r.onboardingStatus, 'COMPLETED');
  assert.equal(r.registrationLevel, 'ONBOARDING_COMPLETED');
  assert.equal(r.completedProfilePercentage, 70);
  assert.equal(r.profileUrl, 'https://shakers.test/talent/profile');
});

test('onboarding_finish: a precondition failure is a named reason, not a crash', async () => {
  const t = toolMap({ requestCompleteOnboarding: async () => ({ ok: false, reason: 'http-422' }) });
  const r = await t.onboarding_finish.handler({});
  assert.equal(r.ok, false);
  assert.equal(r.finalized, false);
  assert.equal(r.reason, 'http-422');
});

