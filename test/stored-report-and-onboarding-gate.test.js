'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { renderUsageReportText } = require('../src/render-usage-report-text');
const { runStored } = require('../bin/report-html');
const { makeReportTools } = require('../src/mcp-report-tools');
const { makeRegisterTools } = require('../src/mcp-register-tools');
const { createMcpServer } = require('../src/mcp-server');
const onboarding = require('../bin/onboarding');

const activeSession = () => ({ accessToken: 't', expiresAt: new Date(Date.now() + 3600000).toISOString() });

const view = {
  report: {
    platform: 'darwin',
    level: 3,
    levelName: 'Advanced',
    score: 72,
    tierKey: 'T3',
    tier: 3,
    totalDetected: 12,
    categories: ['agents', 'mcp'],
    tools: [{ id: 'claude' }],
    technologies: ['TypeScript'],
    agents: [{ name: 'refactorer', role: 'dev' }],
    mcp: { count: 2 },
    sessions: { sessionCount: 5, subagentRunCount: 3, activeHours: 4, crossToolLinks: 1, filesTouchedCount: 20, bashCommandsCount: 15, planningSignalCount: 6 },
    gitActivity: { authoredCommitCount: 9 },
    steeringTraceCount: 7,
    decisionExchangeCount: 2,
    generatedAt: '2026-08-31T10:00:00.000Z',
  },
  fluency: { level: 'deliberate', veracity: 'inconclusive' },
  interactionQuality: { level: 'directive', veracity: 'inconclusive' },
};

test('renderUsageReportText includes inventory, activity, fluency and interaction', () => {
  const text = renderUsageReportText(view, { lang: 'en' });
  assert.match(text, /Advanced/);
  assert.match(text, /refactorer — dev/);
  assert.match(text, /Planning signals: 6/);
  assert.match(text, /AI fluency level: deliberate/);
  assert.match(text, /Interaction \(prompting\) level: directive/);
});

test('CLI report --stored and MCP report{stored:true} return the SAME rendered text (parity)', async () => {
  const fetchReport = async () => ({ ok: true, ...view });

  let cliOut = '';
  await runStored('en', {
    session: activeSession(),
    endpoint: 'https://certs.example/api/v1/usage/report',
    fetchReport,
    out: (s) => { cliOut += s; },
  });

  const [reportTool] = makeReportTools({
    loadAuthSession: () => activeSession(),
    sessionStatus: () => 'active',
    getUsageReportEndpoint: () => 'https://certs.example/api/v1/usage/report',
    requestUsageReport: fetchReport,
    detectFlowLang: () => 'en',
  });
  const mcpResult = await reportTool.handler({ stored: true, lang: 'en' });

  assert.equal(mcpResult.ok, true);
  assert.equal(mcpResult.hasReport, true);
  assert.equal(cliOut, mcpResult.text);
});

test('stored report says so cleanly when none is stored (no crash) — CLI and MCP', async () => {
  const fetchReport = async () => ({ ok: true, report: null, fluency: null, interactionQuality: null });

  let cliOut = '';
  const cli = await runStored('en', { session: activeSession(), endpoint: 'https://x/report', fetchReport, out: (s) => { cliOut += s; } });
  assert.equal(cli.ok, true);
  assert.equal(cli.hasReport, false);
  assert.match(cliOut, /No stored report/i);

  const [reportTool] = makeReportTools({
    loadAuthSession: () => activeSession(),
    sessionStatus: () => 'active',
    getUsageReportEndpoint: () => 'https://x/report',
    requestUsageReport: fetchReport,
    detectFlowLang: () => 'en',
  });
  const mcp = await reportTool.handler({ stored: true });
  assert.equal(mcp.ok, true);
  assert.equal(mcp.hasReport, false);
});

test('MCP onboarding_interview_start is HIDDEN from tools/list when onboarding is completed', async () => {
  const tools = makeRegisterTools({ lang: 'en', checkOnboardingCompleted: async () => true });
  const server = createMcpServer({ tools });
  const listed = await server.listAvailableTools();
  const names = listed.tools.map((t) => t.name);
  assert.ok(!names.includes('onboarding_interview_start'), 'should be hidden when completed');
  assert.ok(names.includes('onboarding_interview_turn'), 'other tools still listed');
});

test('MCP onboarding_interview_start is SHOWN when onboarding is not completed', async () => {
  const tools = makeRegisterTools({ lang: 'en', checkOnboardingCompleted: async () => false });
  const server = createMcpServer({ tools });
  const listed = await server.listAvailableTools();
  assert.ok(listed.tools.map((t) => t.name).includes('onboarding_interview_start'));
});

test('MCP onboarding_interview_start REFUSES when completed and confirmRepeat is not set', async () => {
  const tools = makeRegisterTools({ lang: 'en', checkOnboardingCompleted: async () => true });
  const start = tools.find((t) => t.name === 'onboarding_interview_start');
  const res = await start.handler({ disclaimerAcknowledged: true });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'onboarding-already-completed');
  assert.equal(res.alreadyCompleted, true);
});

test('CLI onboarding: non-interactive + completed + no --confirm-repeat exits 1 asking for the flag', async () => {
  process.exitCode = 0;
  let err = '';
  const origErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { err += s; return true; };
  try {
    await onboarding.run(['--lang', 'en'], {
      stdinIsTTY: false,
      session: activeSession(),
      checkCompleted: async () => true,
      out: () => {},
    });
  } finally {
    process.stderr.write = origErr;
  }
  assert.match(err, /already completed/i);
  assert.match(err, /--confirm-repeat/);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('CLI onboarding: interactive + completed, answering NO aborts cleanly without running the interview', async () => {
  let ran = false;
  const deps = {};
  let out = '';
  const result = await onboarding.run(['--lang', 'en'], {
    stdinIsTTY: true,
    session: activeSession(),
    checkCompleted: async () => true,
    ask: async () => 'n',
    deps,
    out: (s) => { out += s; },
  });
  assert.match(out, /not repeating/i);
  assert.equal(ran, false);
  assert.equal(result, undefined);
});
