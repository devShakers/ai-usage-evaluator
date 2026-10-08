'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeAiUsageTool } = require('../src/mcp-ai-usage-tool');

function signupUsage(overrides) {
  return makeAiUsageTool({
    signupPhase: () => 'account',
    scanUsage: async () => ({ report: {}, maturity: {} }),
    persistFootprint: () => {},
    loadAuthSession: () => ({ email: 'ada@gmail.com' }),
    sessionStatus: () => 'active',
    isValidEmail: () => true,
    recordConsent: () => {},
    autoShare: async () => ({ ok: true }),
    ...overrides,
  });
}

async function unhandledRejectionsDuring(run) {
  const seen = [];
  const listener = (reason) => seen.push(reason);
  process.on('unhandledRejection', listener);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.off('unhandledRejection', listener);
  }
  return seen;
}

for (const [name, overrides] of [
  ['recording the consent throws', { recordConsent: () => { throw new Error('EACCES: consent file'); } }],
  ['the upload rejects', { autoShare: async () => { throw new Error('EACCES: report file'); } }],
]) {
  test(`ai_usage in the sign-up: when ${name} in the background, the MCP process survives and the scan reads as failed`, async () => {
    const usage = signupUsage(overrides);
    let answer;
    const unhandled = await unhandledRejectionsDuring(async () => {
      answer = await usage.handler({ consent: { granted: true } });
    });
    assert.equal(answer.background, true);
    assert.deepEqual(unhandled, []);
    const again = await usage.handler({ consent: { granted: true } });
    assert.equal(again.send.ok, false);
  });
}
