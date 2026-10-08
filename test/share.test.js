'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  loadConsentState,
  saveConsentState,
  getConsentDecision,
  hasTraceContentConsent,
  recordConsent,
  setEmail,
  resetConsent,
  getConsentStatus,
  isValidEmail,
  normalizeEmail,
  isThrottled,
  derivePayload,
  autoShare,
  consentPath,
  SEND_THROTTLE_MS,
} = require('../src/share');
const { saveConfigFile } = require('../src/config');

// talents-ai-score / ADR-007: retires the token/enrollment model in favor of per-run opt-in consent + self-affirmed email identity.

// isolation helpers Every test gets its own throwaway config dir (AI_FOOTPRINT_CONFIG_DIR), so nothing ever touches the real developer machine's ~/.config/ai-footprint/consent.json.

let originalConfigDir;
let originalEndpoint;
let originalEndpointFallback;
let tmpDir;

test.beforeEach(() => {
  originalConfigDir = process.env.AI_FOOTPRINT_CONFIG_DIR;
  originalEndpoint = process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
  originalEndpointFallback = process.env.AI_FOOTPRINT_INGEST_ENDPOINT_FALLBACK;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-test-'));
  process.env.AI_FOOTPRINT_CONFIG_DIR = tmpDir;
  delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
  delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT_FALLBACK;
});

test.afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR;
  else process.env.AI_FOOTPRINT_CONFIG_DIR = originalConfigDir;
  if (originalEndpoint === undefined) delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT;
  else process.env.AI_FOOTPRINT_INGEST_ENDPOINT = originalEndpoint;
  if (originalEndpointFallback === undefined) delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT_FALLBACK;
  else process.env.AI_FOOTPRINT_INGEST_ENDPOINT_FALLBACK = originalEndpointFallback;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function serverUrl(server, pathname = '/reports') {
  const { port } = server.address();
  return `http://127.0.0.1:${port}${pathname}`;
}

const REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-08T00:00:00.000Z',
  anonId: 'anon123',
  platform: 'darwin',
  summary: { totalDetected: 2, categories: ['AGENTIC_CLI'] },
  tools: [{ id: 'claude-code', detected: true, depth: { rules: 1 } }],
};
const MATURITY = { level: 3, name: 'Power user', score: 70 };

// --- email -----------------------------------------------------------------

test('isValidEmail: accepts well-formed addresses', () => {
  assert.equal(isValidEmail('talent@example.com'), true);
  assert.equal(isValidEmail('  talent@example.com  '), true);
});

test('isValidEmail: rejects malformed input', () => {
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('missing@domain'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
});

test('normalizeEmail: trims and lowercases', () => {
  assert.equal(normalizeEmail('  Talent@Example.COM  '), 'talent@example.com');
});

// --- consent state (granted / denied / no-decision) -------------------------

test('loadConsentState: null when no file persisted yet (no-decision)', () => {
  assert.equal(loadConsentState(), null);
  assert.equal(getConsentDecision(loadConsentState()), null);
});

test('recordConsent: granted persists consent + normalized email', () => {
  const state = recordConsent('granted', '  Talent@Example.com  ');
  assert.equal(state.consent, 'granted');
  assert.equal(state.email, 'talent@example.com');
  assert.equal(fs.existsSync(consentPath()), true);
  assert.equal(getConsentDecision(loadConsentState()), 'granted');
});

test('recordConsent: denied persists consent without requiring an email', () => {
  const state = recordConsent('denied');
  assert.equal(state.consent, 'denied');
  assert.equal(getConsentDecision(loadConsentState()), 'denied');
});

test('recordConsent: granted without a valid email throws (never persists a half-decision)', () => {
  assert.throws(() => recordConsent('granted', 'not-an-email'));
  assert.throws(() => recordConsent('granted'));
  assert.equal(loadConsentState(), null);
});

// ADR-028: hasTraceContentConsent Single source of truth for the `traceContentConsent` wire field sent on the 7 gated egress endpoints.

test('hasTraceContentConsent: false with no decision persisted yet', () => {
  assert.equal(hasTraceContentConsent(), false);
});

test('hasTraceContentConsent: true only once consent is granted', () => {
  recordConsent('granted', 'talent@example.com');
  assert.equal(hasTraceContentConsent(), true);
});

test('hasTraceContentConsent: false when consent was explicitly denied', () => {
  recordConsent('denied');
  assert.equal(hasTraceContentConsent(), false);
});

test('hasTraceContentConsent: reads the file FRESH — reflects a decision that changes mid-process', () => {
  assert.equal(hasTraceContentConsent(), false);
  recordConsent('granted', 'talent@example.com');
  assert.equal(hasTraceContentConsent(), true);
  resetConsent();
  assert.equal(hasTraceContentConsent(), false);
});

test('recordConsent: consent file permissions are restricted (600)', () => {
  recordConsent('denied');
  const mode = fs.statSync(consentPath()).mode & 0o777;
  // Windows doesn't honor chmod; only assert strictly on POSIX.
  if (process.platform !== 'win32') assert.equal(mode, 0o600);
});

// --- throttle ----------------------------------------------------------------

test('isThrottled: false with no lastSentAt', () => {
  assert.equal(isThrottled({}), false);
  assert.equal(isThrottled(null), false);
});

test('isThrottled: true within the window, false after it', () => {
  const now = Date.now();
  const recent = { lastSentAt: new Date(now - 1000).toISOString() };
  const old = { lastSentAt: new Date(now - SEND_THROTTLE_MS - 1000).toISOString() };
  assert.equal(isThrottled(recent, now), true);
  assert.equal(isThrottled(old, now), false);
});

// --- derivePayload whitelist (unchanged invariant) ---------------------------

test('derivePayload: whitelist, email is never part of the payload', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.deepEqual(Object.keys(payload).sort(), [
    'anonId', 'categories', 'generatedAt', 'level', 'levelName',
    'platform', 'schemaVersion', 'score', 'tools', 'totalDetected',
    'agents', 'agentCounts', 'technologies', 'agentSynthesis',
    'tier', 'tierKey', 'mcp', 'memory', 'automations', 'browserTools',
    'gitActivity', 'sessions',
    'workStreams', 'steering', 'decisions',
    'detectionEvidence',
  ].sort());
  assert.equal('email' in payload, false);
  // talents-ai-score, issue 022 follow-up (CLI<->backend contract reconciliation): `band` is NOT sent — redundant with `level` (already the 0-4 band).
  assert.equal('band' in payload, false);
});

test('derivePayload: detectionEvidence carries vendored + provenance, drops extras (Slice 3 anti-noise)', () => {
  const reportWithEvidence = {
    ...REPORT,
    detectionEvidence: {
      skills: [
        {
          tech: 'React',
          authoredFileCount: 2,
          totalFileCount: 3,
          authorshipKnown: true,
          depth: 0.7,
          vendored: false,
          recencyDays: 6,
          leakedPath: 'should/not/survive', // extra field must be dropped
        },
      ],
      agents: [
        {
          name: 'planner',
          tools: ['Read', 'Edit'],
          model: 'sonnet',
          authoredFileCount: 1,
          totalFileCount: 1,
          authorshipKnown: true,
          depth: 0.4,
          vendored: true,
        },
      ],
      provenance: {
        fork: true,
        forkSignal: 'upstream-remote',
        boilerplate: true,
        boilerplateMarker: 'create-react-app',
        secret: 'dropped',
      },
    },
  };
  const payload = derivePayload(reportWithEvidence, MATURITY);
  const skill = payload.detectionEvidence.skills[0];
  assert.equal(skill.vendored, false);
  assert.equal(skill.recencyDays, 6);
  assert.equal('leakedPath' in skill, false);
  assert.equal(payload.detectionEvidence.agents[0].vendored, true);
  assert.equal(payload.detectionEvidence.agents[0].recencyDays, null);
  assert.deepEqual(payload.detectionEvidence.provenance, {
    fork: true,
    forkSignal: 'upstream-remote',
    boilerplate: true,
    boilerplateMarker: 'create-react-app',
  });
});

test('derivePayload: egress barrier re-scrubs every free-text field, even if the extractor did not (Slice 3)', () => {
  const jwt =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzYXNpZ25hdHVyZXNlY3JldA';
  const pat = `github_pat_${'A'.repeat(22)}_${'b'.repeat(20)}`;
  const conn = 'postgres://admin:s3cretPass@db.host:5432/app';
  const email = 'thirdparty.person@client-company.com';
  const reportWithRawSecrets = {
    ...REPORT,
    // Secrets injected as if a (buggy/older) extractor had NOT scrubbed them.
    steering: {
      steeringTraceCount: 1,
      redactedSteeringExcerpts: [`no, usa el token ${pat} en el deploy`],
    },
    decisions: {
      decisionExchangeCount: 1,
      redactedDecisionExcerpts: [`decidimos conectar a ${conn} para el seed`],
    },
    sessions: {
      toolsSeen: ['claude'],
      sessionCount: 1,
      crossToolLinks: 0,
      filesTouchedCount: 1,
      bashCommandsCount: 1,
      redactedCommandSample: [`curl -H "Authorization: Bearer ${jwt}"`],
    },
    agentSynthesis: {
      agents: [
        {
          name: 'planner',
          symbolicName: 'Planner',
          whatItDoes: `pings ${email} and reads the token`,
        },
      ],
    },
  };

  const payload = derivePayload(reportWithRawSecrets, MATURITY);
  const blob = JSON.stringify(payload);

  assert.equal(blob.includes(pat), false);
  assert.equal(blob.includes('s3cretPass'), false);
  assert.equal(blob.includes(jwt), false);
  assert.equal(blob.includes(email), false);
  assert.ok(payload.steering.redactedSteeringExcerpts[0].includes('[REDACTED]'));
  assert.ok(payload.decisions.redactedDecisionExcerpts[0].includes('[REDACTED]'));
  assert.ok(payload.sessions.redactedCommandSample[0].includes('[REDACTED]'));
  assert.ok(payload.agentSynthesis[0].whatItDoes.includes('[REDACTED]'));
});

test('derivePayload: redactedCommandSample is capped per command at 200 chars, like steering/decision excerpts', () => {
  const longWords = 'alpha beta gamma delta '.repeat(30);
  const longCommand = `echo ${longWords}`;
  const longSteering = longWords;
  const reportWithLongText = {
    ...REPORT,
    steering: { steeringTraceCount: 1, redactedSteeringExcerpts: [longSteering] },
    sessions: {
      toolsSeen: ['claude'],
      sessionCount: 1,
      crossToolLinks: 0,
      filesTouchedCount: 1,
      bashCommandsCount: 1,
      redactedCommandSample: [longCommand],
    },
  };

  const payload = derivePayload(reportWithLongText, MATURITY);

  assert.equal(payload.sessions.redactedCommandSample[0].length, 200);
  assert.equal(
    payload.sessions.redactedCommandSample[0].length,
    payload.steering.redactedSteeringExcerpts[0].length,
    'command sample uses the same 200-char cap as steering excerpts',
  );
});

// --- tier (talents-ai-score, issue 019/022) -----------------------------

test('derivePayload: includes tier and tierKey from maturity (band is NOT sent, redundant with level)', () => {
  const maturityWithTier = { ...MATURITY, tier: 5, tierKey: 'T5' };
  const payload = derivePayload(REPORT, maturityWithTier);
  assert.equal(payload.tier, 5);
  assert.equal(payload.tierKey, 'T5');
  assert.equal('band' in payload, false);
  assert.equal(payload.level, maturityWithTier.level); // level IS the band, already sent
});

test('derivePayload: missing tier/tierKey on maturity (older shape) defaults gracefully, never throws', () => {
  const payload = derivePayload(REPORT, MATURITY); // MATURITY fixture has no tier/tierKey
  assert.equal(payload.tier, null);
  assert.equal(payload.tierKey, null);
});

// --- mcp: countsByCategory + total ONLY, never individual server names ------

test('derivePayload: mcp payload has ONLY countsByCategory + total — never the individual server names', () => {
  const reportWithMcp = {
    ...REPORT,
    mcp: {
      servers: [{ name: 'postgres', category: 'data' }, { name: 'slack', category: 'comms' }],
      countsByCategory: { data: 1, comms: 1, dev: 0, browser: 0, other: 0 },
      total: 2,
    },
  };
  const payload = derivePayload(reportWithMcp, MATURITY);
  assert.deepEqual(Object.keys(payload.mcp).sort(), ['countsByCategory', 'total'].sort());
  assert.deepEqual(payload.mcp.countsByCategory, { data: 1, comms: 1, dev: 0, browser: 0, other: 0 });
  assert.equal(payload.mcp.total, 2);
  assert.equal(JSON.stringify(payload).includes('postgres'), false);
  assert.equal(JSON.stringify(payload).includes('slack'), false);
});

test('derivePayload: missing report.mcp defaults to zeroed counts, never throws', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.deepEqual(payload.mcp.countsByCategory, { data: 0, comms: 0, dev: 0, browser: 0, other: 0 });
  assert.equal(payload.mcp.total, 0);
});

// --- memory: totalImports/maxDepth/layered ONLY, never per-file details -----

test('derivePayload: memory payload has ONLY totalImports/maxDepth/layered — never file ids or sizes', () => {
  const reportWithMemory = {
    ...REPORT,
    memory: {
      files: [{ id: 'CLAUDE.md', sizeBytes: 1234, sections: 3, imports: 2, depth: 2 }],
      totalImports: 2,
      maxDepth: 2,
      layered: false,
    },
  };
  const payload = derivePayload(reportWithMemory, MATURITY);
  assert.deepEqual(Object.keys(payload.memory).sort(), ['totalImports', 'maxDepth', 'layered'].sort());
  assert.equal(payload.memory.totalImports, 2);
  assert.equal(payload.memory.layered, false);
  assert.equal(JSON.stringify(payload).includes('CLAUDE.md'), false);
  assert.equal(JSON.stringify(payload).includes('sizeBytes'), false);
});

// --- automations: counts/booleans + inspected per scheduler -----------------

test('derivePayload: automations payload mirrors scripts/jsonPiping/schedulers as derived counts+booleans only', () => {
  const reportWithAutomations = {
    ...REPORT,
    automations: {
      scripts: { npm: 2, shell: 1 },
      jsonPiping: 1,
      schedulers: {
        cron: { inspected: true, matches: 1 },
        launchd: { inspected: false, matches: 0 },
        pm2: { inspected: true, matches: 0 },
        systemd: { inspected: false, matches: 0 },
      },
    },
  };
  const payload = derivePayload(reportWithAutomations, MATURITY);
  assert.deepEqual(payload.automations, reportWithAutomations.automations);
});

test('derivePayload: missing report.automations defaults to a well-shaped zeroed object, never throws', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.equal(payload.automations.scripts.npm, 0);
  assert.equal(payload.automations.schedulers.cron.inspected, false);
});

// --- browserTools: detected/count/via -----------------------------------------

test('derivePayload: browserTools.via is ORIGIN FLAGS ONLY (booleans) — never the package/MCP names (issue 022 follow-up)', () => {
  const reportWithBrowser = {
    ...REPORT,
    browserTools: { detected: true, count: 2, via: { dependencies: ['playwright'], mcp: ['browserbase'] } },
  };
  const payload = derivePayload(reportWithBrowser, MATURITY);
  assert.equal(payload.browserTools.detected, true);
  assert.equal(payload.browserTools.count, 2);
  assert.deepEqual(payload.browserTools.via, { dependency: true, mcp: true });
  assert.equal(JSON.stringify(payload).includes('playwright'), false);
  assert.equal(JSON.stringify(payload).includes('browserbase'), false);
});

test('derivePayload: browserTools.via flags are false when that origin found nothing', () => {
  const reportWithPartialBrowser = {
    ...REPORT,
    browserTools: { detected: true, count: 1, via: { dependencies: ['playwright'], mcp: [] } },
  };
  const payload = derivePayload(reportWithPartialBrowser, MATURITY);
  assert.deepEqual(payload.browserTools.via, { dependency: true, mcp: false });
});

test('derivePayload: missing report.browserTools defaults gracefully, never throws', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.equal(payload.browserTools.detected, false);
  assert.deepEqual(payload.browserTools.via, { dependency: false, mcp: false });
});

// --- never raw content anywhere in the new fields ----------------------------

test('derivePayload: never leaks raw content across any of the new fields, even if the report carries extra data', () => {
  const secretMarker = 'PROJECT-CODENAME-DO-NOT-LEAK';
  const reportWithEverything = {
    ...REPORT,
    mcp: { servers: [{ name: secretMarker, category: 'other' }], countsByCategory: { data: 0, comms: 0, dev: 0, browser: 0, other: 1 }, total: 1 },
    memory: { files: [{ id: secretMarker, sizeBytes: 1, sections: 1, imports: 0, depth: 1 }], totalImports: 0, maxDepth: 1, layered: false },
    automations: { scripts: { npm: 0, shell: 0 }, jsonPiping: 0, schedulers: { cron: { inspected: false, matches: 0 }, launchd: { inspected: false, matches: 0 }, pm2: { inspected: false, matches: 0 }, systemd: { inspected: false, matches: 0 } } },
    browserTools: { detected: false, count: 0, via: { dependencies: [], mcp: [] } },
  };
  const payload = derivePayload(reportWithEverything, MATURITY);
  assert.equal(JSON.stringify(payload).includes(secretMarker), false);
});

// --- technologies (talents-ai-score, ADR-012) --------------------------------

test('derivePayload: includes technologies detected from dependency manifests', () => {
  const reportWithTech = { ...REPORT, technologies: ['react', 'typescript'] };
  const payload = derivePayload(reportWithTech, MATURITY);
  assert.deepEqual(payload.technologies, ['react', 'typescript']);
});

test('derivePayload: missing report.technologies (older report) defaults to [], never throws', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.deepEqual(payload.technologies, []);
});

// --- agentSynthesis (talents-ai-score, ADR-010/ADR-011) ----------------------

test('derivePayload: includes the agent-synthesis RESULT, never the raw description sent to the endpoint', () => {
  const reportWithSynthesis = {
    ...REPORT,
    agentSynthesis: {
      agents: [{ name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' }],
      edges: [{ from: 'orchestrator', to: 'backend-developer' }],
    },
  };
  const payload = derivePayload(reportWithSynthesis, MATURITY);
  assert.deepEqual(payload.agentSynthesis, [
    { name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' },
  ]);
  // Edges are a rendering concern only — never persisted.
  assert.equal('edges' in payload, false);
});

test('derivePayload: re-applies the whitelist per synthesized agent — an unexpected extra field (e.g. raw description) never reaches the payload', () => {
  const reportWithLeakySynthesis = {
    ...REPORT,
    agentSynthesis: {
      agents: [{
        name: 'leaky-agent',
        symbolicName: 'X',
        whatItDoes: 'Y',
        description: 'raw prompt text that must never be persisted',
      }],
    },
  };
  const payload = derivePayload(reportWithLeakySynthesis, MATURITY);
  assert.deepEqual(Object.keys(payload.agentSynthesis[0]).sort(), ['name', 'symbolicName', 'whatItDoes'].sort());
  assert.equal(JSON.stringify(payload).includes('raw prompt text'), false);
});

test('derivePayload: no agentSynthesis attached (fallback run, synthesis failed) -> empty array', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.deepEqual(payload.agentSynthesis, []);
});

// --- agent org chart (talents-ai-score, ADR-009) -----------------------------

test('derivePayload: includes the agent org chart with the exact shape {name, tools[], model, parent, catalogId}', () => {
  const reportWithAgents = {
    ...REPORT,
    agents: [{ name: 'backend-developer', tools: ['Read', 'Bash'], model: 'sonnet', parent: null }],
    agentCounts: { agents: 1, skills: 2, commands: 3, mcpServers: 1, hooks: 0 },
  };
  const payload = derivePayload(reportWithAgents, MATURITY);
  // issue 115: `catalogId` joined the shape; null here because this fixture
  // carries no agentEvaluation (the honest "we don't know").
  assert.deepEqual(payload.agents, [
    { name: 'backend-developer', tools: ['Read', 'Bash'], model: 'sonnet', parent: null, catalogId: null },
  ]);
  assert.deepEqual(payload.agentCounts, { agents: 1, skills: 2, commands: 3, mcpServers: 1, hooks: 0 });
});

test('derivePayload: never leaks extra agent fields (e.g. a description slipped onto the object) — re-applies the whitelist per agent', () => {
  const reportWithLeakyAgent = {
    ...REPORT,
    agents: [{
      name: 'leaky-agent',
      tools: ['Read'],
      model: 'sonnet',
      parent: null,
      description: 'this must never leave the machine',
    }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  };
  const payload = derivePayload(reportWithLeakyAgent, MATURITY);
  assert.deepEqual(Object.keys(payload.agents[0]).sort(), ['catalogId', 'model', 'name', 'parent', 'tools'].sort());
  assert.equal(JSON.stringify(payload).includes('this must never leave the machine'), false);
});

// issue 115: the classification cable (catalogId only) `derivePayload` now collects the catalog id the `agent-evaluation` call already resolved this run.

test('derivePayload: collects catalogId from report.agentEvaluation — the cable issue 115 connected', () => {
  const reportWithEvaluation = {
    ...REPORT,
    agents: [
      { name: 'seo-writer', tools: ['Read'], model: 'sonnet', parent: null },
      { name: 'cfo', tools: ['Read'], model: null, parent: null },
    ],
    agentCounts: { agents: 2, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    agentEvaluation: {
      promptVersion: 'agent-eval-v4',
      evaluations: [
        { name: 'seo-writer', classification: { catalogId: 'mkt-2', category: 'marketing', role: 'SEO Optimizer', level: 'L2', method: 'llm' } },
        { name: 'cfo', classification: { catalogId: 'data-4', category: 'data', role: 'Report Synthesizer', level: null, method: 'llm' } },
      ],
    },
  };
  const payload = derivePayload(reportWithEvaluation, MATURITY);
  assert.deepEqual(payload.agents.map((a) => [a.name, a.catalogId]), [
    ['seo-writer', 'mkt-2'],
    ['cfo', 'data-4'],
  ]);
});

test('derivePayload: sends catalogId and NOTHING else from the classification — category/role/level are the server\'s to reconstruct (ADR-025)', () => {
  const reportWithEvaluation = {
    ...REPORT,
    agents: [{ name: 'seo-writer', tools: ['Read'], model: 'sonnet', parent: null }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    agentEvaluation: {
      promptVersion: 'agent-eval-v4',
      evaluations: [{
        name: 'seo-writer',
        classification: { catalogId: 'mkt-2', category: 'marketing', role: 'SEO Optimizer VERBATIM', level: 'L2', method: 'llm' },
        rationale: 'MODEL PROSE about the talent own agent',
        description: 'ANOTHER MODEL SENTENCE',
        improvements: ['A TIP THAT STAYS LOCAL'],
      }],
    },
  };
  const payload = derivePayload(reportWithEvaluation, MATURITY);
  assert.deepEqual(Object.keys(payload.agents[0]).sort(), ['catalogId', 'model', 'name', 'parent', 'tools'].sort());
  assert.equal(payload.agents[0].catalogId, 'mkt-2');
  // The whole payload, not just the agent object: agentEvaluation must not
  // have grown a top-level home either.
  assert.equal('agentEvaluation' in payload, false);
  const wire = JSON.stringify(payload);
  for (const forbidden of [
    'SEO Optimizer VERBATIM',
    'MODEL PROSE about the talent own agent',
    'ANOTHER MODEL SENTENCE',
    'A TIP THAT STAYS LOCAL',
    'marketing',
    'L2',
    'llm',
  ]) {
    assert.equal(wire.includes(forbidden), false, `leaked: ${forbidden}`);
  }
});

test('derivePayload: an unclassified evaluation (catalogId null) sends null, never a guessed id', () => {
  const reportWithUnclassified = {
    ...REPORT,
    agents: [{ name: 'fullstack-dev', tools: ['Read'], model: null, parent: null }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    agentEvaluation: {
      evaluations: [{ name: 'fullstack-dev', classification: { catalogId: null, category: null, role: null, level: null, method: 'unclassified' } }],
    },
  };
  const payload = derivePayload(reportWithUnclassified, MATURITY);
  assert.equal(payload.agents[0].catalogId, null);
});

test('derivePayload: an agent the evaluation OMITTED (issue 113 partial success) sends null, not a neighbour id', () => {
  const reportPartial = {
    ...REPORT,
    agents: [
      { name: 'answered', tools: [], model: null, parent: null },
      { name: 'omitted', tools: [], model: null, parent: null },
    ],
    agentCounts: { agents: 2, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    agentEvaluation: {
      evaluations: [{ name: 'answered', classification: { catalogId: 'dev-1', category: 'developer', role: 'X', level: 'L1', method: 'llm' } }],
      omittedAgentNames: ['omitted'],
    },
  };
  const payload = derivePayload(reportPartial, MATURITY);
  assert.deepEqual(payload.agents.map((a) => [a.name, a.catalogId]), [
    ['answered', 'dev-1'],
    ['omitted', null],
  ]);
});

test('derivePayload: an evaluation for a name we never scanned can NEVER invent an agent in the payload', () => {
  const reportWithGhost = {
    ...REPORT,
    agents: [{ name: 'real-agent', tools: [], model: null, parent: null }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    agentEvaluation: {
      evaluations: [
        { name: 'real-agent', classification: { catalogId: 'dev-3', category: 'developer', role: 'X', level: 'L1', method: 'llm' } },
        { name: 'GHOST-AGENT-FROM-THE-WIRE', classification: { catalogId: 'des-5', category: 'designer', role: 'Y', level: 'L3', method: 'llm' } },
      ],
    },
  };
  const payload = derivePayload(reportWithGhost, MATURITY);
  assert.equal(payload.agents.length, 1);
  assert.equal(payload.agents[0].catalogId, 'dev-3');
  assert.equal(JSON.stringify(payload).includes('GHOST-AGENT-FROM-THE-WIRE'), false);
  assert.equal(JSON.stringify(payload).includes('des-5'), false);
});

test('derivePayload: idempotent — the same report derives a byte-identical payload, duplicate evaluation names resolve first-wins', () => {
  const reportWithDuplicates = {
    ...REPORT,
    agents: [{ name: 'dup', tools: [], model: null, parent: null }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    agentEvaluation: {
      evaluations: [
        { name: 'dup', classification: { catalogId: 'dev-1', category: 'developer', role: 'X', level: 'L1', method: 'llm' } },
        { name: 'dup', classification: { catalogId: 'mkt-1', category: 'marketing', role: 'Y', level: 'L1', method: 'llm' } },
      ],
    },
  };
  const first = derivePayload(reportWithDuplicates, MATURITY);
  const second = derivePayload(reportWithDuplicates, MATURITY);
  assert.equal(first.agents[0].catalogId, 'dev-1');
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('derivePayload: a malformed agentEvaluation (wrong types, no classification) degrades to null and never throws', () => {
  for (const agentEvaluation of [
    null,
    {},
    { evaluations: null },
    { evaluations: 'not-an-array' },
    { evaluations: [{ name: 'a' }] },
    { evaluations: [{ name: 'a', classification: null }] },
    { evaluations: [{ name: 'a', classification: { catalogId: 42 } }] },
    { evaluations: [{ name: 'a', classification: { catalogId: '' } }] },
    { evaluations: [null, undefined, { name: null }] },
  ]) {
    const payload = derivePayload({
      ...REPORT,
      agents: [{ name: 'a', tools: [], model: null, parent: null }],
      agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
      agentEvaluation,
    }, MATURITY);
    assert.equal(payload.agents[0].catalogId, null, `shape: ${JSON.stringify(agentEvaluation)}`);
  }
});

test('derivePayload: report.agentDescriptions (raw frontmatter text, local-display-only) never reaches the persistence payload', () => {
  const reportWithRawDescriptions = {
    ...REPORT,
    agents: [{ name: 'leaky-agent', tools: ['Read'], model: 'sonnet', parent: null }],
    agentDescriptions: [{ name: 'leaky-agent', description: 'CONFIDENTIAL raw frontmatter text that must never be persisted' }],
  };
  const payload = derivePayload(reportWithRawDescriptions, MATURITY);
  assert.equal('agentDescriptions' in payload, false);
  assert.equal(JSON.stringify(payload).includes('CONFIDENTIAL raw frontmatter text'), false);
});

test('derivePayload: missing agents/agentCounts (report predating ADR-009) defaults gracefully, never throws', () => {
  const payload = derivePayload(REPORT, MATURITY);
  assert.deepEqual(payload.agents, []);
  assert.deepEqual(payload.agentCounts, { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 });
});

// THE `requestJson` TEST WAS DELETED HERE (issue 093's sweep), not skipped.

// --- autoShare: skip reasons --------------------------------------------------

test('autoShare: no decision persisted -> skipped, reason no-decision, nothing sent', async () => {
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'no-decision');
});

test('autoShare: consent denied -> skipped, reason consent-denied', async () => {
  recordConsent('denied');
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'consent-denied');
});

test('autoShare: granted but no endpoint configured -> skipped, reason no-endpoint-configured', async () => {
  recordConsent('granted', 'talent@example.com');
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'no-endpoint-configured');
});

// --- ADR-006 (re-prompt bug fix): the emailVerified send-gate ---------------

test('autoShare: granted but emailVerified:false -> skipped, reason email-unverified (never sends under an unverified email)', async () => {
  recordConsent('granted', 'talent@example.com', { verified: false });
  // Endpoint IS configured — the block must come from the unverified email,
  // not from a missing endpoint.
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'email-unverified');
});

test('autoShare: a verified grant (recordConsent verified:true) passes the email-unverified gate', async () => {
  recordConsent('granted', 'talent@example.com', { verified: true });
  // Past the gate; with a dead endpoint it fails at the network layer
  // (network-error), NOT at the email-unverified gate.
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.notEqual(r.reason, 'email-unverified');
  assert.equal(r.reason, 'network-error');
});

test('autoShare: legacy granted state with no emailVerified field still sends (no regression for pre-fix grants)', async () => {
  // A grant persisted before this fix has no emailVerified field (undefined), which was verified under the old model to reach `granted` — must not be blocked as unverified.
  saveConsentState({ consent: 'granted', email: 'talent@example.com', lastSentAt: null });
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.notEqual(r.reason, 'email-unverified');
  assert.equal(r.reason, 'network-error');
});

// ADR-058 refinement (dueño, 2026-08-12): the `email-unverified` gate is TALENT-ONLY.
test('autoShare: profile:"external" -- emailVerified:false does NOT block sending (past the gate, fails at network layer instead)', async () => {
  saveConfigFile({ profile: 'external' }, { AI_FOOTPRINT_CONFIG_DIR: tmpDir });
  recordConsent('granted', 'lead@example.com', { verified: false });
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.notEqual(r.reason, 'email-unverified');
  assert.equal(r.reason, 'network-error');
});

test('autoShare: profile:"talent" (explicit) -- emailVerified:false STILL blocks, exactly as before this change', async () => {
  saveConfigFile({ profile: 'talent' }, { AI_FOOTPRINT_CONFIG_DIR: tmpDir });
  recordConsent('granted', 'talent@example.com', { verified: false });
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'email-unverified');
});

test('autoShare: no `profile` key at all in config.json -- defaults to talent, emailVerified:false STILL blocks (regression guard)', async () => {
  // No config.json written at all — the same "absent key" case every real pre-ADR-058 install is in.
  recordConsent('granted', 'talent@example.com', { verified: false });
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.reason, 'email-unverified');
});

test('recordConsent {verified}: the emailVerified flag and getConsentStatus reflect verification state', () => {
  recordConsent('granted', 'talent@example.com', { verified: false });
  assert.equal(loadConsentState().emailVerified, false);
  assert.equal(getConsentStatus().emailVerified, false);
  recordConsent('granted', 'talent@example.com', { verified: true });
  assert.equal(loadConsentState().emailVerified, true);
  assert.equal(getConsentStatus().emailVerified, true);
});

test('setEmail: changing the email resets emailVerified to false (new address is unverified, ADR-006)', () => {
  recordConsent('granted', 'talent@example.com', { verified: true });
  setEmail('new@example.com');
  const state = loadConsentState();
  assert.equal(state.email, 'new@example.com');
  assert.equal(state.emailVerified, false);
});

test('resetConsent: clears both the decision and the emailVerified flag (a re-grant re-verifies from scratch)', () => {
  recordConsent('granted', 'talent@example.com', { verified: true });
  resetConsent();
  const state = loadConsentState();
  assert.equal('consent' in state, false);
  assert.equal('emailVerified' in state, false);
});

test('getConsentStatus: a legacy grant with no emailVerified field reads as verified (true)', () => {
  saveConsentState({ consent: 'granted', email: 'talent@example.com', lastSentAt: null });
  assert.equal(getConsentStatus().emailVerified, true);
});

test('autoShare: granted + throttled (recent lastSentAt) -> skipped, reason throttled', async () => {
  recordConsent('granted', 'talent@example.com');
  const state = loadConsentState();
  state.lastSentAt = new Date().toISOString();
  saveConsentState(state);
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'throttled');
});

test('autoShare: granted + network error -> resiliently fails, never throws, local report unaffected', async () => {
  recordConsent('granted', 'talent@example.com');
  // Port 1 is a privileged/closed port: connection refused immediately.
  process.env.AI_FOOTPRINT_INGEST_ENDPOINT = 'http://127.0.0.1:1/reports';
  const r = await autoShare(REPORT, MATURITY);
  assert.equal(r.ok, false);
  assert.equal(r.skipped, false);
  assert.equal(r.reason, 'network-error');
});

// issue 115 / ADR-010-011: the consent gate holds for the NEW field too.
test('autoShare: no consent (no-decision, then denied) -> a real server receives ZERO requests, catalogId included', async () => {
  const hits = [];
  const server = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      hits.push(raw);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const reportWithClassification = {
    ...REPORT,
    agents: [{ name: 'seo-writer', tools: ['Read'], model: 'sonnet', parent: null }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    agentEvaluation: {
      evaluations: [{ name: 'seo-writer', classification: { catalogId: 'mkt-2', category: 'marketing', role: 'SEO Optimizer', level: 'L2', method: 'llm' } }],
    },
  };
  try {
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);

    // The catalogId IS derivable — otherwise this test proves nothing.
    assert.equal(derivePayload(reportWithClassification, MATURITY).agents[0].catalogId, 'mkt-2');

    const noDecision = await autoShare(reportWithClassification, MATURITY);
    assert.equal(noDecision.reason, 'no-decision');

    recordConsent('denied');
    const denied = await autoShare(reportWithClassification, MATURITY);
    assert.equal(denied.reason, 'consent-denied');

    assert.deepEqual(hits, []);
    // CONTROL: the same report DOES reach the server once consent is granted,
    // so the emptiness above is the gate and not a broken fixture.
    recordConsent('granted', 'talent@example.com', { verified: true });
    const granted = await autoShare(reportWithClassification, MATURITY);
    assert.equal(granted.ok, true);
    assert.equal(hits.length, 1);
    assert.equal(JSON.parse(hits[0]).payload.agents[0].catalogId, 'mkt-2');
  } finally {
    server.close();
  }
});

test('autoShare: granted + happy path -> sends {email, payload}, persists lastSentAt', async () => {
  let receivedBody;
  let receivedHeaders;
  const server = await startServer((req, res) => {
    receivedHeaders = req.headers;
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      receivedBody = JSON.parse(raw);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);

    const r = await autoShare(REPORT, MATURITY);

    assert.equal(r.ok, true);
    assert.equal('authorization' in receivedHeaders, false);
    assert.equal(receivedBody.email, 'talent@example.com');
    assert.deepEqual(receivedBody.payload, derivePayload(REPORT, MATURITY));

    const persisted = loadConsentState();
    assert.ok(persisted.lastSentAt);
  } finally {
    server.close();
  }
});

// talents-ai-score, ADR-020/021: autoShare now sends across the PRIMARY -> FALLBACK chain.

// ADR-042: the test that used to sit here — "primary network error, fallback succeeds" — is DELETED, not adapted.

test('autoShare: primary 403 (business rejection) -> surfaces as-is, fallback NEVER called', async () => {
  const primary = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not-a-registered-talent' }));
    });
  });
  let fallbackCalls = 0;
  const fallback = await startServer((req, res) => {
    fallbackCalls++;
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(primary);
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT_FALLBACK = serverUrl(fallback);

    const r = await autoShare(REPORT, MATURITY);

    assert.equal(r.ok, false);
    assert.equal(r.reason, 'http-403');
    assert.equal(fallbackCalls, 0, 'a 4xx from the primary must never be retried against the fallback');
  } finally {
    primary.close();
    fallback.close();
    delete process.env.AI_FOOTPRINT_INGEST_ENDPOINT_FALLBACK;
  }
});

test('autoShare: server 429 -> rate-limited, does not update lastSentAt', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate limit' }));
    });
  });
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);
    const r = await autoShare(REPORT, MATURITY);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'rate-limited');
    assert.equal(loadConsentState().lastSentAt, null);
  } finally {
    server.close();
  }
});

test('autoShare: server 503 (kill switch off) -> service-unavailable, resolves without throwing', async () => {
  const server = await startServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ingest disabled' }));
    });
  });
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);
    const r = await autoShare(REPORT, MATURITY);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'service-unavailable');
  } finally {
    server.close();
  }
});

// ADR-042: this used to assert the SAME key reached the primary AND the fallback attempt of one submission (ADR-021's split-persistence risk).
test('autoShare: sends an Idempotency-Key header on the single backend attempt', async () => {
  const seenKeys = [];
  const server = await startServer((req, res) => {
    seenKeys.push(req.headers['idempotency-key']);
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); });
  });
  try {
    recordConsent('granted', 'talent@example.com');
    process.env.AI_FOOTPRINT_INGEST_ENDPOINT = serverUrl(server);
    const r = await autoShare(REPORT, MATURITY);
    assert.equal(r.ok, true);
    assert.equal(r.backend, 'primary');
    assert.equal(seenKeys.length, 1, 'exactly one attempt, so exactly one key');
    assert.ok(seenKeys[0], 'a key must be sent');
  } finally {
    server.close();
  }
});
