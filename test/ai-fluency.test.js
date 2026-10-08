'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveSetupLevelFromTier,
  deriveUsageLevelFromInteraction,
  deriveAiFluencyCell,
  isAiNative,
  composeAiFluencyMatrix,
} = require('../src/ai-fluency-cell');
const {
  resolveAiProfilePreview,
  normalizeProfile,
} = require('../src/ai-profile-preview');
const {
  renderAiProfileTerminal,
  renderAiProfilePlain,
  renderAiFluencyMatrixHtml,
} = require('../src/render-ai-fluency');
const { detectedTools, detectedToolNames } = require('../src/detected-tools');

test('detected-tools: filters to detected only, tolerates junk, prefers name over id', () => {
  const tools = [
    { id: 'claude-code', name: 'Claude Code', detected: true },
    { id: 'github-copilot', name: 'GitHub Copilot', detected: false },
    { id: 'warp-ai', detected: true },
    null,
    { id: 'aider', name: 'Aider' },
  ];
  assert.equal(detectedTools(tools).length, 2);
  assert.deepEqual(detectedToolNames(tools), ['Claude Code', 'warp-ai']);
  assert.deepEqual(detectedToolNames(null), []);
  assert.deepEqual(detectedToolNames(undefined), []);
});

/* ---------------- mapping (ported from hub + certs, must not diverge) ------- */

test('deriveSetupLevelFromTier matches the hub deriveHubSetupLevelFromTier bands', () => {
  assert.equal(deriveSetupLevelFromTier(null), null);
  assert.equal(deriveSetupLevelFromTier(0), null);
  assert.equal(deriveSetupLevelFromTier(2), 'ASSISTED');
  assert.equal(deriveSetupLevelFromTier(4), 'EXTENDED');
  assert.equal(deriveSetupLevelFromTier(7), 'ORCHESTRATED');
});

test('deriveUsageLevelFromInteraction maps certs vocab to hub usage vocab', () => {
  assert.equal(deriveUsageLevelFromInteraction('reactive'), 'REACTIVE');
  assert.equal(deriveUsageLevelFromInteraction('directive'), 'DELIBERATE');
  assert.equal(deriveUsageLevelFromInteraction('orchestrative'), 'RIGOROUS');
  assert.equal(deriveUsageLevelFromInteraction('nonsense'), null);
});

test('deriveAiFluencyCell / isAiNative match the hub matrix', () => {
  assert.equal(deriveAiFluencyCell('ASSISTED', 'REACTIVE'), 'Explorer');
  assert.equal(deriveAiFluencyCell('ORCHESTRATED', 'RIGOROUS'), 'AI Native');
  assert.equal(deriveAiFluencyCell(null, 'RIGOROUS'), null);
  assert.equal(isAiNative('ORCHESTRATED', 'RIGOROUS'), true);
  assert.equal(isAiNative('EXTENDED', 'RIGOROUS'), false);
});

test('composeAiFluencyMatrix composes tier + interaction into the full band', () => {
  assert.deepEqual(composeAiFluencyMatrix({ tier: 6, interactionLevel: 'orchestrative' }), {
    setupLevel: 'ORCHESTRATED', setupCode: 'S3', usageLevel: 'RIGOROUS', cell: 'AI Native', isAiNative: true,
  });
});

/* ---------------- normalize (tolerant hub -> preview) ---------------------- */

const HUB_PROFILE = {
  setup: { tier: 'T6', level: 'ORCHESTRATED', explanation: 'Deep tooling.' },
  usage: { level: 'RIGOROUS', explanation: 'Rigorous prompting.' },
  cell: 'AI Native',
  isAiNative: true,
  traction: {
    sessions90d: 12, activeDaysPerWeek: 4, agentsDetected: 3, agentsOnProfile: 2,
    tools: [{ id: 'claude-code', name: 'Claude Code', detected: true }],
  },
  vision: { text: 'AI augments craft.', language: 'en', sourceRef: null, writtenAt: null },
  howIWork: { body: 'I pair with agents on every task.', highlights: null },
};

test('normalizeProfile maps the hub DTO into the render preview (E, F, traction, matrix)', () => {
  const p = normalizeProfile(HUB_PROFILE);
  assert.equal(p.matrix.setupLevel, 'ORCHESTRATED');
  assert.equal(p.matrix.setupCode, 'S3');
  assert.equal(p.matrix.usageLevel, 'RIGOROUS');
  assert.equal(p.matrix.cell, 'AI Native');
  assert.equal(p.matrix.isAiNative, true);
  assert.equal(p.vision, 'AI augments craft.');
  assert.equal(p.howIWork, 'I pair with agents on every task.');
  assert.equal(p.traction.sessions90d, 12);
  assert.equal(p.traction.agentsOnProfile, 2);
  assert.deepEqual(p.traction.tools, [{ id: 'claude-code', name: 'Claude Code', detected: true }]);
});

test('normalizeProfile: absent E/F come back null (never invented)', () => {
  const p = normalizeProfile({ setup: { level: 'ASSISTED' }, usage: {}, cell: null, vision: null, howIWork: null });
  assert.equal(p.vision, null);
  assert.equal(p.howIWork, null);
  assert.equal(p.traction, null);
});

/* ---------------- resolve (poll + fallbacks, mocked hub) ------------------- */

test('resolveAiProfilePreview: no session / no endpoint -> unavailable', async () => {
  const noSess = await resolveAiProfilePreview(
    { session: null, endpoint: 'http://x/ai-profile' },
    { requestAiProfile: async () => assert.fail('must not call the server') },
  );
  assert.deepEqual(noSess, { status: 'unavailable', preview: null });
  const noEndp = await resolveAiProfilePreview(
    { session: { accessToken: 'tok' }, endpoint: null },
    { requestAiProfile: async () => assert.fail('must not call the server') },
  );
  assert.equal(noEndp.status, 'unavailable');
});

test('resolveAiProfilePreview: profile populated -> ready with the full preview', async () => {
  const r = await resolveAiProfilePreview(
    { session: { accessToken: 'tok' }, endpoint: 'http://x/ai-profile', timeoutMs: 1000 },
    { requestAiProfile: async () => ({ ok: true, profile: HUB_PROFILE }) },
  );
  assert.equal(r.status, 'ready');
  assert.equal(r.preview.matrix.cell, 'AI Native');
  assert.equal(r.preview.vision, 'AI augments craft.');
  assert.equal(r.preview.howIWork, 'I pair with agents on every task.');
});

test('resolveAiProfilePreview: 404 / empty profile -> keeps polling, then pending (no hang)', async () => {
  let now = 0;
  let calls = 0;
  const r = await resolveAiProfilePreview(
    { session: { accessToken: 'tok' }, endpoint: 'http://x/ai-profile', timeoutMs: 15000 },
    {
      requestAiProfile: async () => { calls++; return { ok: false, reason: 'not-found' }; },
      now: () => now,
      wait: async (ms) => { now += ms; },
      pollIntervalMs: 2500,
    },
  );
  assert.equal(r.status, 'pending');
  assert.equal(r.preview, null);
  assert.ok(calls >= 2, 'should have polled more than once within the budget');
});

test('resolveAiProfilePreview: server errors -> pending (never throws)', async () => {
  let now = 0;
  const r = await resolveAiProfilePreview(
    { session: { accessToken: 'tok' }, endpoint: 'http://x/ai-profile', timeoutMs: 5000 },
    {
      requestAiProfile: async () => { throw new Error('network down'); },
      now: () => now,
      wait: async (ms) => { now += ms; },
      pollIntervalMs: 2500,
    },
  );
  assert.equal(r.status, 'pending');
});

test('resolveAiProfilePreview: matrix+E ready but howIWork (F) still null -> keeps polling, returns ready once F lands', async () => {
  let now = 0;
  let calls = 0;
  // F lands on the 3rd poll; matrix + E are present from the first.
  const noF = { ...HUB_PROFILE, howIWork: null };
  const r = await resolveAiProfilePreview(
    { session: { accessToken: 'tok' }, endpoint: 'http://x/ai-profile', timeoutMs: 15000 },
    {
      requestAiProfile: async () => {
        calls++;
        return { ok: true, profile: calls >= 3 ? HUB_PROFILE : noF };
      },
      now: () => now,
      wait: async (ms) => { now += ms; },
      pollIntervalMs: 2500,
    },
  );
  assert.equal(r.status, 'ready');
  assert.equal(r.preview.vision, 'AI augments craft.');
  assert.equal(r.preview.howIWork, 'I pair with agents on every task.');
  assert.ok(calls >= 3, 'should keep polling while F is still null and the budget remains');
});

test('resolveAiProfilePreview: F never arrives within budget -> returns last-ready preview (matrix + E), F null', async () => {
  let now = 0;
  let calls = 0;
  const noF = { ...HUB_PROFILE, howIWork: null };
  const r = await resolveAiProfilePreview(
    { session: { accessToken: 'tok' }, endpoint: 'http://x/ai-profile', timeoutMs: 8000 },
    {
      requestAiProfile: async () => { calls++; return { ok: true, profile: noF }; },
      now: () => now,
      wait: async (ms) => { now += ms; },
      pollIntervalMs: 2500,
    },
  );
  assert.equal(r.status, 'ready');
  assert.equal(r.preview.vision, 'AI augments craft.');
  assert.equal(r.preview.howIWork, null);
  assert.ok(calls >= 2, 'should have polled more than once waiting for F');
});

test('resolveAiProfilePreview: matrix band lags but E/F present -> ready with the partial (never gated on the matrix)', async () => {
  let now = 0;
  // The hourly reconcile gap: E + F are live, the fluency band has not projected yet.
  const noMatrix = { ...HUB_PROFILE, setup: {}, usage: {}, cell: null, isAiNative: false };
  const r = await resolveAiProfilePreview(
    { session: { accessToken: 'tok' }, endpoint: 'http://x/ai-profile', timeoutMs: 8000 },
    {
      requestAiProfile: async () => ({ ok: true, profile: noMatrix }),
      now: () => now,
      wait: async (ms) => { now += ms; },
      pollIntervalMs: 2500,
    },
  );
  assert.equal(r.status, 'ready');
  assert.equal(r.preview.vision, 'AI augments craft.');
  assert.equal(r.preview.howIWork, 'I pair with agents on every task.');
  assert.equal(r.preview.matrix.setupLevel, null, 'matrix genuinely still pending');
});

test('resolveAiProfilePreview: empty on the 1st poll, populated on the 2nd -> ready', async () => {
  let now = 0;
  let calls = 0;
  const r = await resolveAiProfilePreview(
    { session: { accessToken: 'tok' }, endpoint: 'http://x/ai-profile', timeoutMs: 15000 },
    {
      requestAiProfile: async () => {
        calls++;
        return calls === 1 ? { ok: false, reason: 'not-found' } : { ok: true, profile: HUB_PROFILE };
      },
      now: () => now,
      wait: async (ms) => { now += ms; },
      pollIntervalMs: 4000,
    },
  );
  assert.equal(r.status, 'ready');
  assert.equal(r.preview.matrix.cell, 'AI Native');
  assert.equal(calls, 2, 'ready as soon as the 2nd poll lands');
});

test('resolveAiProfilePreview: a 401 refreshes the token and retries with it -> recovers', async () => {
  let now = 0;
  let refreshed = 0;
  const tokensSeen = [];
  const r = await resolveAiProfilePreview(
    { session: { accessToken: 'stale', hubAccessToken: 'stale' }, endpoint: 'http://x/ai-profile', timeoutMs: 15000 },
    {
      requestAiProfile: async ({ hubAccessToken }) => {
        tokensSeen.push(hubAccessToken);
        return hubAccessToken === 'fresh'
          ? { ok: true, profile: HUB_PROFILE }
          : { ok: false, reason: 'http-401' };
      },
      refreshToken: async () => { refreshed++; return { accessToken: 'fresh', hubAccessToken: 'fresh' }; },
      now: () => now,
      wait: async (ms) => { now += ms; },
      pollIntervalMs: 4000,
    },
  );
  assert.equal(r.status, 'ready');
  assert.equal(refreshed, 1, 'the 401 triggered exactly one token refresh');
  assert.deepEqual(tokensSeen, ['stale', 'fresh'], 'retried immediately with the fresh token');
});

/* ---------------- render (terminal preview + matrix HTML) ------------------ */

const READY = { status: 'ready', preview: normalizeProfile(HUB_PROFILE) };

test('terminal preview (ready): matrix + Setup/Usage (level + why) + vision (E) + howIWork (F); traction moved to Activity', () => {
  const out = renderAiProfileTerminal(READY, { lang: 'en' });
  assert.match(out, /AI Native/);
  assert.match(out, /Explorer/); // full 3x3 grid drawn
  // Setup = tooling maturity, Usage = judgment; each with its own "why".
  assert.match(out, /Setup: S3 Orchestrated — Deep tooling\./);
  assert.match(out, /Usage: Rigorous — Rigorous prompting\./);
  assert.match(out, /My vision on AI/);
  assert.match(out, /AI augments craft\./);
  assert.match(out, /How I work with AI/);
  assert.match(out, /pair with agents/);
  // Traction now lives in the Activity section, NOT in this block.
  assert.doesNotMatch(out, /sessions \(90d\)/);
});

test('terminal preview: any of the four texts null is omitted cleanly (no header, no invented text)', () => {
  const preview = normalizeProfile({
    ...HUB_PROFILE,
    usage: { level: 'RIGOROUS', explanation: null },
    vision: null,
    howIWork: null,
  });
  const out = renderAiProfileTerminal({ status: 'ready', preview }, { lang: 'en' });
  assert.doesNotMatch(out, /My vision on AI/, 'absent E omitted, no header');
  assert.doesNotMatch(out, /How I work with AI/, 'absent F omitted, no header');
  assert.doesNotMatch(out, /after the onboarding interview/, 'no placeholder text');
  assert.doesNotMatch(out, /null/, 'never prints null');
  // A null per-axis explanation drops just the "why", keeps the level.
  assert.match(out, /Usage: Rigorous/);
  assert.doesNotMatch(out, /Usage: Rigorous —/);
  // Setup (level + why) survives untouched.
  assert.match(out, /Setup: S3 Orchestrated — Deep tooling\./);
});

test('terminal preview (matrix band lagging): degrades to an "updating" note, still shows E + F', () => {
  const preview = normalizeProfile({ ...HUB_PROFILE, setup: {}, usage: {}, cell: null, isAiNative: false });
  const out = renderAiProfileTerminal({ status: 'ready', preview }, { lang: 'en' });
  assert.match(out, /Setup x Usage matrix is updating/, 'matrix swapped for a short note');
  assert.doesNotMatch(out, /Explorer/, 'no fake 3x3 grid when the band is absent');
  assert.match(out, /My vision on AI/);
  assert.match(out, /AI augments craft\./);
  assert.match(out, /How I work with AI/);
  assert.match(out, /pair with agents/);
});

test('terminal preview (pending / unavailable): note, not a fake band', () => {
  assert.match(renderAiProfileTerminal({ status: 'pending', preview: null }, { lang: 'en' }), /being evaluated/i);
  assert.doesNotMatch(renderAiProfileTerminal({ status: 'pending', preview: null }, { lang: 'en' }), /AI Native/);
  assert.match(renderAiProfileTerminal({ status: 'unavailable', preview: null }, { lang: 'es' }), /perfil/);
});

/* ---------------- plain render (MCP: no ANSI, fenced grid, all sections) ---- */

test('renderAiProfilePlain (ready): matrix + Setup/Usage + E + F + traction + agents, NO ANSI', () => {
  const out = renderAiProfilePlain(READY, {
    lang: 'en',
    agents: [{ name: 'claude-code', category: 'Development', role: 'Backend Developer' }],
  });
  assert.doesNotMatch(out, /\x1b/, 'no ANSI escape codes in the MCP report');
  assert.match(out, /```[\s\S]*Explorer[\s\S]*AI Native[\s\S]*```/, 'matrix grid inside a fenced code block');
  assert.match(out, /\[AI Native\]/, 'current cell marked with brackets, not color');
  // Setup = tooling maturity, Usage = judgment; each level carries its own "why".
  assert.match(out, /Setup: S3 Orchestrated — Deep tooling\./);
  assert.match(out, /Usage: Rigorous — Rigorous prompting\./);
  assert.match(out, /My vision on AI/);
  assert.match(out, /AI augments craft\./);
  assert.match(out, /How I work with AI/);
  assert.match(out, /pair with agents/);
  assert.match(out, /Traction:.*sessions \(90d\)/);
  assert.match(out, /claude-code — Development · Backend Developer/);
  assert.doesNotMatch(out, /→/, 'no recap summary line');
});

test('renderAiProfilePlain: null texts are omitted cleanly (no header, no null, per-axis why optional)', () => {
  const preview = normalizeProfile({
    ...HUB_PROFILE,
    setup: { tier: 'T6', level: 'ORCHESTRATED', explanation: null },
    vision: null,
    howIWork: null,
  });
  const out = renderAiProfilePlain({ status: 'ready', preview }, { lang: 'en' });
  assert.doesNotMatch(out, /My vision on AI/, 'absent E omitted, no header');
  assert.doesNotMatch(out, /How I work with AI/, 'absent F omitted, no header');
  assert.doesNotMatch(out, /after the onboarding interview/, 'no placeholder text');
  assert.doesNotMatch(out, /null/, 'never prints null');
  // A null Setup explanation keeps the level line, drops only the "— why".
  assert.match(out, /Setup: S3 Orchestrated/);
  assert.doesNotMatch(out, /Setup: S3 Orchestrated —/);
  // Usage keeps both level and why.
  assert.match(out, /Usage: Rigorous — Rigorous prompting\./);
});

test('renderAiProfilePlain (matrix band lagging): "updating" note instead of the fenced grid, keeps E + F', () => {
  const preview = normalizeProfile({ ...HUB_PROFILE, setup: {}, usage: {}, cell: null, isAiNative: false });
  const out = renderAiProfilePlain({ status: 'ready', preview }, { lang: 'en' });
  assert.doesNotMatch(out, /```/, 'no fenced 3x3 grid when the band is absent');
  assert.match(out, /Setup x Usage matrix is updating/);
  assert.match(out, /My vision on AI/);
  assert.match(out, /AI augments craft\./);
  assert.match(out, /How I work with AI/);
  assert.match(out, /pair with agents/);
});

test('renderAiProfilePlain (pending / unavailable): plain note, no matrix, no ANSI', () => {
  const pending = renderAiProfilePlain({ status: 'pending', preview: null }, { lang: 'en' });
  assert.doesNotMatch(pending, /\x1b/);
  assert.match(pending, /being evaluated/i);
  assert.doesNotMatch(pending, /```/);
  const unavailable = renderAiProfilePlain({ status: 'unavailable', preview: null }, { lang: 'es' });
  assert.match(unavailable, /perfil/);
});

test('renderAiProfilePlain: the tools line lists ONLY detected tools, never the catalog', () => {
  const DETECTED = ['claude-code', 'cursor', 'windsurf', 'codex-cli', 'codeium', 'warp-ai'];
  const NOT_DETECTED = ['github-copilot', 'aider', 'gemini-cli', 'cline', 'continue',
    'cody', 'zed', 'tabnine', 'amazon-q-developer', 'supermaven', 'pieces', 'trae'];
  const tools = [
    ...DETECTED.map((id) => ({ id, name: id, detected: true })),
    ...NOT_DETECTED.map((id) => ({ id, name: id, detected: false })),
  ];
  const preview = normalizeProfile({ ...HUB_PROFILE, traction: { ...HUB_PROFILE.traction, tools } });
  const out = renderAiProfilePlain({ status: 'ready', preview }, { lang: 'en' });
  const tractionLine = out.split('\n').find((l) => /Traction/.test(l));
  assert.ok(tractionLine, 'traction line present');
  for (const id of DETECTED) assert.ok(tractionLine.includes(id), `${id} listed`);
  for (const id of NOT_DETECTED) assert.ok(!tractionLine.includes(id), `${id} must NOT appear`);
  assert.match(tractionLine, /tools: claude-code, cursor, windsurf, codex-cli, codeium, warp-ai/);
});

test('matrix HTML (kept for render-sheet): marks current cell; pending is a note', () => {
  const html = renderAiFluencyMatrixHtml(
    { status: 'ready', usage: READY.preview.matrix },
    { lang: 'en' },
  );
  assert.match(html, /ai-fluency-matrix/);
  assert.match(html, /is-current/);
  const pending = renderAiFluencyMatrixHtml({ status: 'pending', usage: null }, { lang: 'en' });
  assert.match(pending, /ai-fluency-note/);
  assert.doesNotMatch(pending, /ai-fluency-matrix/);
});
