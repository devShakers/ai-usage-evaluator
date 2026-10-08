'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');
const { runRepeatOnboardingInterview } = require('../src/onboarding-flow');
const { makeRegisterTools } = require('../src/mcp-register-tools');

const catalog = getCatalog('en');

function fakeIo({ pick = null } = {}) {
  const out = [];
  return {
    lang: 'en',
    out,
    section: (t) => out.push(`section:${t}`),
    notify: (t) => out.push(`notify:${t}`),
    success: (t) => out.push(`success:${t}`),
    warn: (t) => out.push(`warn:${t}`),
    error: (t) => out.push(`error:${t}`),
    disclaimer: () => {},
    withProgress: (_l, task) => task(),
    select: async ({ items }) => (pick == null ? null : items[pick]),
  };
}

function baseDeps(over = {}) {
  return {
    ensureFreshSession: async () => ({ accessToken: 'A', hubAccessToken: 'H' }),
    loadAuthSession: () => ({ accessToken: 'A', hubAccessToken: 'H' }),
    sessionStatus: () => 'active',
    getOnboardingRestartEndpoint: () => 'https://certs/interviews/onboarding/restart',
    requestRestartOnboardingInterview: async () => ({ ok: true, interviewId: 'iv1', language: 'EN' }),
    // conductLivekitInterview path: make it a soft failure so no LiveKit is needed.
    getOnboardingInterviewsEndpoint: () => 'https://certs/interviews',
    requestCreateOnboardingInterview: async () => ({ ok: true, interviewId: 'iv1' }),
    requestStartLivekitSession: async () => ({ ok: false, reason: 'livekit-not-installed' }),
    makeInterviewClient: () => ({ connect: async () => {}, disconnect: async () => {} }),
    // main-role step is a no-op here.
    runMainRoleStep: async () => ({ ok: true, chosen: null }),
    makeRolesDeps: () => ({}),
    ...over,
  };
}

test('repeat: declining the confirmation aborts with no restart call', async () => {
  let restarted = false;
  const io = fakeIo({ pick: 1 }); // "No"
  const deps = baseDeps({ requestRestartOnboardingInterview: async () => { restarted = true; return { ok: true }; } });
  const res = await runRepeatOnboardingInterview(io, deps);
  assert.equal(res.repeated, false);
  assert.equal(restarted, false);
  assert.ok(io.out.some((l) => l.includes(catalog.onboarding.repeatWarnBody)), 'the overwrite warning is shown');
  assert.ok(io.out.some((l) => l.includes(catalog.onboarding.repeatAborted)));
});

test('repeat: confirming restarts then runs the interview ONLY (no main-role — that is a register step)', async () => {
  const calls = [];
  let mainRan = false;
  const io = fakeIo({ pick: 0 }); // "Yes"
  const deps = baseDeps({
    requestRestartOnboardingInterview: async () => { calls.push('restart'); return { ok: true, interviewId: 'iv1', language: 'EN' }; },
    runMainRoleStep: async () => { mainRan = true; return { ok: true }; },
  });
  const res = await runRepeatOnboardingInterview(io, deps);
  assert.equal(res.repeated, true);
  assert.deepEqual(calls, ['restart']);
  assert.equal(mainRan, false, 'standalone repeat never runs the main-role step');
  assert.ok(io.out.some((l) => l.includes(catalog.onboarding.repeatRestarted)));
});

test('repeat: --yes (confirmed) skips the selector', async () => {
  let asked = false;
  const io = { ...fakeIo(), select: async () => { asked = true; return null; } };
  const deps = baseDeps();
  const res = await runRepeatOnboardingInterview(io, deps, { confirmed: true });
  assert.equal(res.repeated, true);
  assert.equal(asked, false, 'no selector when already confirmed');
});

test('repeat: 404 onboarding-not-found gives an actionable message, no interview', async () => {
  const io = fakeIo({ pick: 0 });
  const deps = baseDeps({ requestRestartOnboardingInterview: async () => ({ ok: false, reason: 'onboarding-not-found', status: 404 }) });
  const res = await runRepeatOnboardingInterview(io, deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'onboarding-not-found');
  assert.ok(io.out.some((l) => l.includes('error:') && l.includes(catalog.onboarding.repeatNotFound)));
});

test('repeat: 401/403 surfaces the auth message', async () => {
  const io = fakeIo({ pick: 0 });
  const deps = baseDeps({ requestRestartOnboardingInterview: async () => ({ ok: false, reason: 'http-403', status: 403 }) });
  const res = await runRepeatOnboardingInterview(io, deps);
  assert.equal(res.ok, false);
  assert.ok(io.out.some((l) => l.includes(catalog.onboarding.repeatAuthError)));
});

test('MCP repeat_onboarding_interview: restarts and points to the interview flow', async () => {
  const tools = makeRegisterTools({
    lang: 'en',
    flowDeps: {
      loadAuthSession: () => ({ accessToken: 'A', hubAccessToken: 'H' }),
      sessionStatus: () => 'active',
      ensureFreshSession: async () => ({ accessToken: 'A', hubAccessToken: 'H' }),
      getOnboardingRestartEndpoint: () => 'https://certs/interviews/onboarding/restart',
      requestRestartOnboardingInterview: async () => ({ ok: true, interviewId: 'iv1', language: 'EN' }),
    },
  });
  const tool = tools.find((t) => t.name === 'repeat_onboarding_interview');
  assert.ok(tool, 'the tool is registered');
  const res = await tool.handler({});
  assert.equal(res.ok, true);
  assert.equal(res.interviewId, 'iv1');
  assert.equal(res.next, 'onboarding_interview_start');
});

test('MCP repeat_onboarding_interview: 404 -> onboarding-not-found with guidance', async () => {
  const tools = makeRegisterTools({
    lang: 'en',
    flowDeps: {
      loadAuthSession: () => ({ accessToken: 'A', hubAccessToken: 'H' }),
      sessionStatus: () => 'active',
      ensureFreshSession: async () => ({ accessToken: 'A', hubAccessToken: 'H' }),
      getOnboardingRestartEndpoint: () => 'https://certs/interviews/onboarding/restart',
      requestRestartOnboardingInterview: async () => ({ ok: false, reason: 'onboarding-not-found', status: 404 }),
    },
  });
  const tool = tools.find((t) => t.name === 'repeat_onboarding_interview');
  const res = await tool.handler({});
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'onboarding-not-found');
  assert.match(res.message, /onboarding/i);
});
