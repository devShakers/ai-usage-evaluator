'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeAiUsageResultTool, isClassified, pollClassifiedInventory } = require('../src/mcp-ai-usage-result-tool');

function agent(name, code, method, whatItDoes) {
  return { name, tools: [], model: null, category: null, role: null, level: null, code, whatItDoes: whatItDoes || null, method };
}

function virtualClock() {
  const state = { t: 0 };
  return {
    now: () => state.t,
    sleep: (ms) => { state.t += ms; return Promise.resolve(); },
    state,
  };
}

const activeDeps = (over) => ({
  loadAuthSession: () => ({ accessToken: 'A' }),
  sessionStatus: () => 'active',
  getUsageDiscoveredInventoryEndpoint: () => 'http://svc/usage/discovered-inventory',
  ...over,
});

test('ai_usage_result: session-gated — throws without an active session', async () => {
  const tool = makeAiUsageResultTool(activeDeps({
    sessionStatus: () => 'none',
    requestDiscoveredInventory: async () => { throw new Error('should not be called'); },
  }));
  await assert.rejects(tool.handler({}), /no active Shakers session/);
});

test('ai_usage_result: ready immediately when every agent is already classified (method != floor)', async () => {
  let calls = 0;
  const clock = virtualClock();
  const tool = makeAiUsageResultTool(activeDeps({
    now: clock.now,
    sleep: clock.sleep,
    requestDiscoveredInventory: async () => { calls += 1; return { ok: true, agents: [agent('backend-developer', 'dev-1', 'llm', 'Writes code'), agent('reviewer', 'dev-3', 'deterministic', 'Reviews')] }; },
  }));
  const out = await tool.handler({});
  assert.equal(out.status, 'ready');
  assert.equal(out.reason, 'classified');
  assert.equal(out.agents[0].code, 'dev-1');
  assert.equal(calls, 1, 'no polling needed when already classified');
  assert.equal(clock.state.t, 0);
});

test('ai_usage_result: polls floor(method) until the async listener flips every agent to llm, then ready', async () => {
  const clock = virtualClock();
  const reads = [
    [agent('backend-developer', 'other-1', 'floor'), agent('qa-tester', 'other-1', 'floor')],
    [agent('backend-developer', 'other-1', 'floor'), agent('qa-tester', 'other-1', 'floor')],
    [agent('backend-developer', 'dev-1', 'llm', 'Writes and refactors backend code'), agent('qa-tester', 'dev-2', 'llm', 'Writes tests')],
  ];
  let i = 0;
  const tool = makeAiUsageResultTool(activeDeps({
    now: clock.now,
    sleep: clock.sleep,
    requestDiscoveredInventory: async () => ({ ok: true, agents: reads[Math.min(i++, reads.length - 1)] }),
  }));
  const out = await tool.handler({});
  assert.equal(out.status, 'ready');
  assert.equal(out.reason, 'classified');
  assert.deepEqual(out.agents.map((a) => a.code), ['dev-1', 'dev-2']);
  assert.equal(i, 3, 'polled until the listener finished');
  assert.ok(clock.state.t <= 90000);
});

test('ai_usage_result: a still-floor agent (method floor) at the cap returns PENDING, never a false ready', async () => {
  const clock = virtualClock();
  let calls = 0;
  const tool = makeAiUsageResultTool(activeDeps({
    now: clock.now,
    sleep: clock.sleep,
    requestDiscoveredInventory: async () => { calls += 1; return { ok: true, agents: [agent('a', 'dev-1', 'llm'), agent('b', 'other-1', 'floor')] }; },
  }));
  const out = await tool.handler({});
  assert.equal(out.status, 'pending', 'a floor-method agent means classification is still running');
  assert.equal(out.reason, 'classifying');
  assert.ok(calls <= 20, `bounded read count (${calls})`);
  assert.ok(clock.state.t <= 90000, `elapsed ${clock.state.t}ms stays under the 90s cap (well under Claude's ~4 min)`);
});

test("ai_usage_result: an agent the LLM confirmed as 'other' (code other-1 but method llm) is classified, not pending", async () => {
  const clock = virtualClock();
  const tool = makeAiUsageResultTool(activeDeps({
    now: clock.now,
    sleep: clock.sleep,
    requestDiscoveredInventory: async () => ({ ok: true, agents: [agent('a', 'dev-1', 'llm'), agent('ddd-enforcer', 'other-1', 'llm', 'Undefined')] }),
  }));
  const out = await tool.handler({});
  assert.equal(out.status, 'ready');
  assert.equal(out.reason, 'classified');
});

test('ai_usage_result: fallback when method is absent — ready only when all codes are non-floor', async () => {
  const clock = virtualClock();
  const tool1 = makeAiUsageResultTool(activeDeps({
    now: clock.now, sleep: clock.sleep,
    requestDiscoveredInventory: async () => ({ ok: true, agents: [agent('a', 'dev-1', null), agent('b', 'dev-2', null)] }),
  }));
  assert.equal((await tool1.handler({})).status, 'ready');

  const clock2 = virtualClock();
  const tool2 = makeAiUsageResultTool(activeDeps({
    now: clock2.now, sleep: clock2.sleep,
    requestDiscoveredInventory: async () => ({ ok: true, agents: [agent('a', 'other-1', null), agent('b', 'dev-2', null)] }),
  }));
  assert.equal((await tool2.handler({})).status, 'pending');
});

test('ai_usage_result: a not-yet-ingested inventory (404) keeps polling and returns pending, never a false error', async () => {
  const clock = virtualClock();
  const tool = makeAiUsageResultTool(activeDeps({
    now: clock.now,
    sleep: clock.sleep,
    requestDiscoveredInventory: async () => ({ ok: false, reason: 'no-inventory' }),
  }));
  const out = await tool.handler({});
  assert.equal(out.status, 'pending');
  assert.equal(out.reason, 'classifying');
  assert.match(out.message, /still classifying/i);
  assert.ok(clock.state.t <= 90000);
});

test('ai_usage_result: ready/pending carry a progress message', async () => {
  const readyTool = makeAiUsageResultTool(activeDeps({
    requestDiscoveredInventory: async () => ({ ok: true, agents: [agent('a', 'dev-1', 'llm')] }),
  }));
  const ready = await readyTool.handler({});
  assert.equal(ready.status, 'ready');
  assert.match(ready.message, /finished classifying/i);
});

test('helper isClassified: method wins; code fallback only when method absent', () => {
  assert.equal(isClassified([agent('a', 'dev-1', 'llm')]), true);
  assert.equal(isClassified([agent('a', 'other-1', 'llm')]), true, 'LLM-confirmed other = classified');
  assert.equal(isClassified([agent('a', 'dev-1', 'llm'), agent('b', 'other-1', 'floor')]), false, 'a floor-method agent is not done');
  assert.equal(isClassified([]), false);
  assert.equal(isClassified([agent('a', 'dev-1', null)]), true, 'fallback: real code, no method');
  assert.equal(isClassified([agent('a', 'other-1', null)]), false, 'fallback: floor code, no method');
});
