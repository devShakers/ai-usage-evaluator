'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  buildRoadmapSignals,
  buildRoadmapPersonalizationRequest,
  isValidPersonalizedRoadmap,
  requestRoadmapPersonalization,
  mergeRoadmapPersonalization,
} = require('../src/roadmap-personalization');
const { getRoadmapEntry } = require('../src/roadmap-content');

/*
 * talents-ai-score, ADR-015: roadmap personalization client. When a
 * personalization endpoint is configured, the CLI asks the hub for a
 * PROJECT-ADAPTED version of the current tier jump's 4 prose gaps
 * (whatUnlocks/steps/tips/mistakes) — everything else (tier, band, the
 * "upgrade when" criterion, the copyable snippet) is ALWAYS the curated
 * content, never touched by the LLM. Ephemeral: never touches the
 * persistence payload (src/share.js). Only DERIVED signals are sent, never
 * raw file content.
 *
 * Fallback cascade to the curated content verbatim on: no endpoint,
 * non-2xx, timeout, invalid JSON, or a steps/tips/mistakes count mismatch
 * against the curated block — ALL OR NOTHING (never a partial mix).
 */

const CURATED_T1 = getRoadmapEntry('T1', 'es'); // a real jump entry: unlocks/steps/tips/commonMistakes

// --- buildRoadmapSignals: only derived signals, never raw content -----------

test('buildRoadmapSignals: pulls frameworks/toolCategories/mcpCategories/agents/agentCounts/automations from the report, hooks from tier signals', () => {
  const report = {
    technologies: ['React', 'Express'],
    summary: { totalDetected: 2, categories: ['Agentic CLI', 'AI editor'] },
    mcp: { servers: [{ name: 'postgres', category: 'data' }], countsByCategory: { data: 1, comms: 0, dev: 0, browser: 0, other: 0 }, total: 1 },
    agents: [{ name: 'backend-dev', tools: [], model: null, parent: null }],
    agentCounts: { agents: 1, skills: 2, commands: 3, mcpServers: 1, hooks: 0 },
    automations: { scripts: { npm: 1, shell: 0 }, jsonPiping: 0, schedulers: {} },
  };
  const signals = buildRoadmapSignals(report, { hooks: 4 });
  assert.deepEqual(signals.frameworks, ['React', 'Express']);
  assert.deepEqual(signals.toolCategories, ['Agentic CLI', 'AI editor']);
  assert.deepEqual(signals.mcpCategories, { data: 1, comms: 0, dev: 0, browser: 0, other: 0 });
  assert.deepEqual(signals.agents, ['backend-dev']); // NAMES only, never descriptions
  assert.deepEqual(signals.agentCounts, { agents: 1, skills: 2, commands: 3, mcpServers: 1, hooks: 0 });
  assert.equal(signals.hooks, 4); // from tier-engine's signals, the canonical source for the T7 criterion
  assert.deepEqual(signals.automations, report.automations);
});

test('buildRoadmapSignals: never includes agent descriptions or any raw file content', () => {
  const report = {
    technologies: [],
    summary: { categories: [] },
    mcp: { countsByCategory: {} },
    agents: [{ name: 'leaky-agent', tools: [], model: null, parent: null, description: 'SECRET-SHOULD-NEVER-APPEAR' }],
    agentCounts: {},
    automations: {},
  };
  const signals = buildRoadmapSignals(report, { hooks: 0 });
  assert.equal(JSON.stringify(signals).includes('SECRET-SHOULD-NEVER-APPEAR'), false);
  assert.deepEqual(signals.agents, ['leaky-agent']);
});

test('buildRoadmapSignals: degrades to safe defaults on a malformed/missing report, never throws', () => {
  assert.doesNotThrow(() => buildRoadmapSignals({}, {}));
  const signals = buildRoadmapSignals({}, {});
  assert.deepEqual(signals.frameworks, []);
  assert.deepEqual(signals.toolCategories, []);
  assert.deepEqual(signals.agents, []);
  assert.equal(signals.hooks, 0);
});

// --- buildRoadmapPersonalizationRequest: exact wire shape -------------------

test('buildRoadmapPersonalizationRequest: builds {tier, tierKey, curated, signals} with curated field names mapped (unlocks->whatUnlocks, commonMistakes->mistakes)', () => {
  const tierResult = { tier: 1, tierKey: 'T1', signals: { hooks: 0 } };
  const report = { technologies: [], summary: { categories: [] }, mcp: { countsByCategory: {} }, agents: [], agentCounts: {}, automations: {} };
  const body = buildRoadmapPersonalizationRequest(CURATED_T1, tierResult, report);

  assert.equal(body.tier, 1);
  assert.equal(body.tierKey, 'T1');
  assert.equal(body.curated.whatUnlocks, CURATED_T1.unlocks);
  assert.deepEqual(body.curated.steps, CURATED_T1.steps);
  assert.deepEqual(body.curated.tips, CURATED_T1.tips);
  assert.deepEqual(body.curated.mistakes, CURATED_T1.commonMistakes);
  assert.ok(body.signals);
  // NEVER sends title/upgradeWhen/snippet/tierKey-from-curated as part of
  // `curated` — those are client-side-only, always kept from the curated
  // entry regardless of personalization (see mergeRoadmapPersonalization).
  assert.equal(body.curated.title, undefined);
  assert.equal(body.curated.upgradeWhen, undefined);
  assert.equal(body.curated.snippet, undefined);
});

// --- isValidPersonalizedRoadmap: count-matching validation ------------------

test('isValidPersonalizedRoadmap: valid response (matching counts, non-empty strings) -> true', () => {
  const curated = { steps: CURATED_T1.steps, tips: CURATED_T1.tips, mistakes: CURATED_T1.commonMistakes };
  const response = {
    whatUnlocks: 'Personalized unlock text for your React project.',
    steps: CURATED_T1.steps.map((s) => ({ text: `Personalized: ${s.text}`, estimate: s.estimate })),
    tips: CURATED_T1.tips.map((t) => `Personalized: ${t}`),
    mistakes: CURATED_T1.commonMistakes.map((m) => `Personalized: ${m}`),
  };
  assert.equal(isValidPersonalizedRoadmap(response, curated), true);
});

test('isValidPersonalizedRoadmap: steps/tips/mistakes count mismatch against curated -> false', () => {
  const curated = { steps: CURATED_T1.steps, tips: CURATED_T1.tips, mistakes: CURATED_T1.commonMistakes };
  const responseWrongSteps = {
    whatUnlocks: 'x',
    steps: CURATED_T1.steps.slice(1).map((s) => ({ text: s.text, estimate: s.estimate })), // one fewer
    tips: CURATED_T1.tips,
    mistakes: CURATED_T1.commonMistakes,
  };
  assert.equal(isValidPersonalizedRoadmap(responseWrongSteps, curated), false);

  const responseWrongTips = {
    whatUnlocks: 'x',
    steps: CURATED_T1.steps,
    tips: [...CURATED_T1.tips, 'one extra tip'],
    mistakes: CURATED_T1.commonMistakes,
  };
  assert.equal(isValidPersonalizedRoadmap(responseWrongTips, curated), false);
});

test('isValidPersonalizedRoadmap: missing/empty whatUnlocks -> false', () => {
  const curated = { steps: CURATED_T1.steps, tips: CURATED_T1.tips, mistakes: CURATED_T1.commonMistakes };
  assert.equal(isValidPersonalizedRoadmap({ steps: CURATED_T1.steps, tips: CURATED_T1.tips, mistakes: CURATED_T1.commonMistakes }, curated), false);
  assert.equal(isValidPersonalizedRoadmap({ whatUnlocks: '   ', steps: CURATED_T1.steps, tips: CURATED_T1.tips, mistakes: CURATED_T1.commonMistakes }, curated), false);
});

test('isValidPersonalizedRoadmap: a step missing `text` -> false', () => {
  const curated = { steps: CURATED_T1.steps, tips: CURATED_T1.tips, mistakes: CURATED_T1.commonMistakes };
  const response = {
    whatUnlocks: 'x',
    steps: CURATED_T1.steps.map(() => ({ estimate: '5 min' })), // no text
    tips: CURATED_T1.tips,
    mistakes: CURATED_T1.commonMistakes,
  };
  assert.equal(isValidPersonalizedRoadmap(response, curated), false);
});

test('isValidPersonalizedRoadmap: malformed input (not an object, null, array) -> false, never throws', () => {
  const curated = { steps: [], tips: [], mistakes: [] };
  assert.equal(isValidPersonalizedRoadmap(null, curated), false);
  assert.equal(isValidPersonalizedRoadmap(undefined, curated), false);
  assert.equal(isValidPersonalizedRoadmap('a string', curated), false);
  assert.equal(isValidPersonalizedRoadmap([], curated), false);
});

// --- mergeRoadmapPersonalization: only the 4 prose gaps change -------------

test('mergeRoadmapPersonalization: overrides ONLY unlocks/steps/tips/commonMistakes; title/upgradeWhen/snippet/tierKey untouched', () => {
  const personalized = {
    whatUnlocks: 'Personalized unlocks text.',
    steps: CURATED_T1.steps.map((s) => ({ text: `P: ${s.text}`, estimate: s.estimate })),
    tips: ['P tip 1', 'P tip 2', 'P tip 3'].slice(0, CURATED_T1.tips.length),
    mistakes: CURATED_T1.commonMistakes.map((m) => `P: ${m}`),
  };
  const merged = mergeRoadmapPersonalization(CURATED_T1, personalized);

  assert.equal(merged.unlocks, personalized.whatUnlocks);
  assert.deepEqual(merged.steps, personalized.steps);
  assert.deepEqual(merged.commonMistakes, personalized.mistakes);
  assert.deepEqual(merged.tips, personalized.tips);

  // Untouched, always from curated:
  assert.equal(merged.title, CURATED_T1.title);
  assert.equal(merged.upgradeWhen, CURATED_T1.upgradeWhen);
  assert.deepEqual(merged.snippet, CURATED_T1.snippet);
  assert.equal(merged.tierKey, CURATED_T1.tierKey);
});

test('mergeRoadmapPersonalization: no personalization (null) -> returns the curated entry verbatim, same reference-equal content', () => {
  const merged = mergeRoadmapPersonalization(CURATED_T1, null);
  assert.deepEqual(merged, CURATED_T1);
});

test('mergeRoadmapPersonalization: a maxTier (T7 terminal) entry is NEVER personalized, even if a personalization object is passed by mistake', () => {
  const t7 = getRoadmapEntry('T7', 'es');
  const merged = mergeRoadmapPersonalization(t7, { whatUnlocks: 'x', steps: [], tips: [], mistakes: [] });
  assert.deepEqual(merged, t7);
});

// --- requestRoadmapPersonalization: network behavior, fallback-friendly ----

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function serverUrl(server) {
  const { port } = server.address();
  return `http://127.0.0.1:${port}/works/ai-footprint/roadmap`;
}

function requestBodyFor(curatedEntry) {
  return buildRoadmapPersonalizationRequest(
    curatedEntry,
    { tier: 1, tierKey: 'T1', signals: { hooks: 0 } },
    { technologies: [], summary: { categories: [] }, mcp: { countsByCategory: {} }, agents: [], agentCounts: {}, automations: {} },
  );
}

test('requestRoadmapPersonalization: happy path returns the validated {whatUnlocks, steps, tips, mistakes}', async () => {
  const body = requestBodyFor(CURATED_T1);
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        whatUnlocks: 'Adapted for your React project.',
        steps: CURATED_T1.steps.map((s) => ({ text: `Adapted: ${s.text}`, estimate: s.estimate })),
        tips: CURATED_T1.tips.map((t) => `Adapted: ${t}`),
        mistakes: CURATED_T1.commonMistakes.map((m) => `Adapted: ${m}`),
      }));
    });
  });
  try {
    const result = await requestRoadmapPersonalization(body, { endpoint: serverUrl(server) });
    assert.ok(result);
    assert.match(result.whatUnlocks, /Adapted for your React project/);
    assert.equal(result.steps.length, CURATED_T1.steps.length);
  } finally {
    server.close();
  }
});

test('requestRoadmapPersonalization: no endpoint configured -> null, no request attempted', async () => {
  let called = false;
  const server = await startServer((req, res) => {
    called = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await requestRoadmapPersonalization(requestBodyFor(CURATED_T1), { endpoint: null });
    assert.equal(result, null);
    assert.equal(called, false);
  } finally {
    server.close();
  }
});

test('requestRoadmapPersonalization: network error -> null, never throws', async () => {
  const result = await requestRoadmapPersonalization(requestBodyFor(CURATED_T1), { endpoint: 'http://127.0.0.1:1/works/ai-footprint/roadmap' });
  assert.equal(result, null);
});

test('requestRoadmapPersonalization: non-2xx response -> null', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    });
  });
  try {
    const result = await requestRoadmapPersonalization(requestBodyFor(CURATED_T1), { endpoint: serverUrl(server) });
    assert.equal(result, null);
  } finally {
    server.close();
  }
});

test('requestRoadmapPersonalization: malformed (non-JSON) response body -> null', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('not json {{{');
    });
  });
  try {
    const result = await requestRoadmapPersonalization(requestBodyFor(CURATED_T1), { endpoint: serverUrl(server) });
    assert.equal(result, null);
  } finally {
    server.close();
  }
});

test('requestRoadmapPersonalization: timeout -> null (never hangs the local report)', async () => {
  const server = await startServer(() => {
    // never responds
  });
  try {
    const result = await requestRoadmapPersonalization(requestBodyFor(CURATED_T1), { endpoint: serverUrl(server), timeoutMs: 50 });
    assert.equal(result, null);
  } finally {
    server.close();
  }
});

test('requestRoadmapPersonalization: steps/tips/mistakes count mismatch vs curated -> null (fallback, all-or-nothing)', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        whatUnlocks: 'Adapted.',
        steps: CURATED_T1.steps.slice(1), // one fewer than curated
        tips: CURATED_T1.tips,
        mistakes: CURATED_T1.commonMistakes,
      }));
    });
  });
  try {
    const result = await requestRoadmapPersonalization(requestBodyFor(CURATED_T1), { endpoint: serverUrl(server) });
    assert.equal(result, null);
  } finally {
    server.close();
  }
});
