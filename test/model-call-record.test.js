'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const net = require('net');

const {
  MODEL_CALL,
  REASON,
  SKIP_REASONS,
  FAILURE_REASONS,
  SUCCESS_REASONS,
  classifyChainError,
  skipped,
  failedLocally,
  reporterFor,
  attachModelCall,
  callFailed,
  callSucceeded,
  callTimedOut,
  modelCall,
} = require('../src/model-call-record');
const { requestAgentSynthesis } = require('../src/agent-synthesis');
const { requestRoadmapPersonalization } = require('../src/roadmap-personalization');
const { getCatalog } = require('../src/i18n');
const { renderTerminal } = require('../src/render-terminal');
const { needle } = require('../test-fixtures/copy-needle');

/* ---------- helpers ---------- */

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function urlOf(server, path = '/agent-synthesis') {
  return `http://127.0.0.1:${server.address().port}${path}`;
}

// A port that is listening but never answers: the ONLY honest way to simulate a timeout.
function startBlackHole() {
  return new Promise((resolve) => {
    const server = net.createServer(() => {
      /* accept the connection and never write a byte */
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// A port nothing is listening on. Bind, read the port, close, and hand back the
// now-dead URL.
function deadUrl() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(`http://127.0.0.1:${port}/agent-synthesis`));
    });
  });
}

const SYNTHESIS_BODY = {
  agents: [{ name: 'backend-developer', description: 'writes backend code', tools: ['Read'], model: 'sonnet', parent: null }],
};

// Collects the single record a call emits.
function collector() {
  const seen = [];
  return { onOutcome: (rec) => seen.push(rec), seen };
}

/* ---------- the vocabulary is exhaustive and partitioned ---------- */

test('every REASON is classified as exactly one of the THREE families', () => {
  // WIDENED (2026-08-03): this used to special-case `ok` as "in neither set".
  for (const value of Object.values(REASON)) {
    const families = [SUCCESS_REASONS.has(value), SKIP_REASONS.has(value), FAILURE_REASONS.has(value)];
    const inCount = families.filter(Boolean).length;
    assert.equal(
      inCount,
      1,
      `${value} must be in exactly one of SUCCESS/SKIP/FAILURE (it is in ${inCount})`,
    );
  }
});

test('a skip is ok:null with no timestamp — never a failure', () => {
  const rec = skipped(REASON.NO_AGENTS);
  assert.equal(rec.ok, null);
  assert.equal(rec.attemptedAt, null, 'nothing was attempted, so there is no attempt time');
  assert.equal(rec.reason, REASON.NO_AGENTS);
  // Control: the predicate the render layer uses must NOT fire on a skip. This
  // is the one assert that stops issue 106's bug from reappearing inverted.
  const report = {};
  attachModelCall(report, MODEL_CALL.SYNTHESIS, rec);
  assert.equal(callFailed(report, MODEL_CALL.SYNTHESIS), false);
  assert.equal(callSucceeded(report, MODEL_CALL.SYNTHESIS), false);
});

test('a local failure has a timestamp and IS a failure', () => {
  const rec = failedLocally();
  assert.equal(rec.ok, false);
  assert.equal(typeof rec.attemptedAt, 'string');
  assert.equal(rec.reason, REASON.LOCAL_ERROR);
});

test('classifyChainError maps the chain kinds, and an untagged error is local — not the network', () => {
  assert.equal(classifyChainError({ kind: 'timeout' }), REASON.TIMEOUT);
  assert.equal(classifyChainError({ kind: 'network-error' }), REASON.NETWORK);
  assert.equal(classifyChainError({ kind: 'invalid-url' }), REASON.INVALID_URL);
  assert.equal(classifyChainError({ kind: 'no-endpoint' }), REASON.NO_ENDPOINT);
  // A plain `new Error()` is a bug in this repo, not a transport failure.
  assert.equal(classifyChainError(new Error('boom')), REASON.LOCAL_ERROR);
  assert.equal(classifyChainError(null), REASON.LOCAL_ERROR);
});

test('a reporter settles exactly once — a later exit cannot overwrite the reason', () => {
  const { onOutcome, seen } = collector();
  const outcome = reporterFor(onOutcome, { timeoutMs: 1234 });
  outcome.fail(REASON.TIMEOUT);
  outcome.fail(REASON.HTTP, { status: 500 });
  outcome.succeed({ status: 200 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reason, REASON.TIMEOUT);
  assert.equal(seen[0].timeoutMs, 1234, 'the budget that was waited on is part of the record');
});

/* ---------- THE FOUR CAUSES, each one real ---------- */

test('cause 1/4 — no endpoint configured: recorded as a SKIP, not an error', async () => {
  const { onOutcome, seen } = collector();
  const out = await requestAgentSynthesis(SYNTHESIS_BODY, { endpoint: null, endpointFallback: null, onOutcome });
  assert.equal(out, null, 'the return contract is unchanged');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reason, REASON.NO_ENDPOINT);
  assert.equal(seen[0].ok, null, 'an unconfigured endpoint is not a failure — nothing was tried');
  assert.equal(seen[0].attemptedAt, null);
  // Controls: it is none of the other three causes.
  assert.notEqual(seen[0].reason, REASON.NETWORK);
  assert.notEqual(seen[0].reason, REASON.TIMEOUT);
  assert.notEqual(seen[0].reason, REASON.UNEXPECTED_SHAPE);
});

test('cause 2/4 — network error (nothing listening): reason network-error, and NOT timeout', async () => {
  const url = await deadUrl();
  const { onOutcome, seen } = collector();
  const out = await requestAgentSynthesis(SYNTHESIS_BODY, { endpoint: url, timeoutMs: 5000, onOutcome });
  assert.equal(out, null);
  assert.equal(seen[0].reason, REASON.NETWORK);
  assert.equal(seen[0].ok, false);
  assert.equal(typeof seen[0].attemptedAt, 'string');
  // Control: the pair this test exists for. A refused connection is NOT a
  // timeout, and it must not be reported as one just because both end in null.
  assert.notEqual(seen[0].reason, REASON.TIMEOUT);
  assert.equal(seen[0].elapsedMs < 5000, true, 'a refused connection fails fast — it does not burn the budget');
  assert.equal(seen[0].hops.length, 1, 'one hop tried');
  assert.equal(seen[0].hops[0].kind, 'network-error');
});

test('cause 3/4 — timeout (server accepts and never answers): reason timeout, and NOT network-error', async () => {
  const hole = await startBlackHole();
  const { onOutcome, seen } = collector();
  const url = `http://127.0.0.1:${hole.address().port}/agent-synthesis`;
  const out = await requestAgentSynthesis(SYNTHESIS_BODY, { endpoint: url, timeoutMs: 150, onOutcome });
  hole.close();
  assert.equal(out, null);
  assert.equal(seen[0].reason, REASON.TIMEOUT);
  assert.equal(seen[0].ok, false);
  assert.equal(seen[0].timeoutMs, 150, 'the record says how long we waited before giving up');
  // Control: the other half of the pair.
  assert.notEqual(seen[0].reason, REASON.NETWORK);
  assert.equal(SKIP_REASONS.has(seen[0].reason), false);
});

test('cause 4/4 — bad shape: 2xx JSON the validator refuses is unexpected-shape, not malformed-json', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ nope: true })); // parses fine, wrong shape
  });
  const { onOutcome, seen } = collector();
  const out = await requestAgentSynthesis(SYNTHESIS_BODY, { endpoint: urlOf(server), onOutcome });
  server.close();
  assert.equal(out, null);
  assert.equal(seen[0].reason, REASON.UNEXPECTED_SHAPE);
  assert.equal(seen[0].status, 200, 'the status is kept: a 200 that we refused is a contract problem, not a transport one');
  // Controls: the two body-level causes must stay apart from each other and
  // from the transport ones.
  assert.notEqual(seen[0].reason, REASON.MALFORMED_JSON);
  assert.notEqual(seen[0].reason, REASON.HTTP);
  assert.notEqual(seen[0].reason, REASON.NETWORK);
});

/* ---------- the causes the issue did not enumerate but the staircase has ---------- */

test('a body that is not JSON at all is malformed-json (distinct from a wrong shape)', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('<html>gateway</html>');
  });
  const { onOutcome, seen } = collector();
  await requestAgentSynthesis(SYNTHESIS_BODY, { endpoint: urlOf(server), onOutcome });
  server.close();
  assert.equal(seen[0].reason, REASON.MALFORMED_JSON);
  assert.notEqual(seen[0].reason, REASON.UNEXPECTED_SHAPE);
});

test('a 401 is http-error with the status kept — the record does not claim whose fault it is', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Unauthorized' }));
  });
  const { onOutcome, seen } = collector();
  await requestAgentSynthesis(SYNTHESIS_BODY, { endpoint: urlOf(server), onOutcome });
  server.close();
  assert.equal(seen[0].reason, REASON.HTTP);
  assert.equal(seen[0].status, 401);
  assert.equal(seen[0].backend, 'primary');
});

// ADR-042 — WHAT REPLACED "the trace names WHICH hop failed".
test('ADR-042: a PERSISTED two-hop record from before the retirement is still read correctly', () => {
  const report = baseReport();
  attachModelCall(report, MODEL_CALL.SYNTHESIS, {
    attemptedAt: '2026-08-04T10:08:46.557Z',
    ok: false,
    reason: REASON.HTTP,
    status: 404,
    backend: 'fallback',
    elapsedMs: 8099,
    timeoutMs: 8000,
    hops: [
      { backend: 'primary', status: null, kind: 'timeout' },
      { backend: 'fallback', status: 404, kind: null },
    ],
    omitted: [],
  });

  // The trap, restated: `reason` says http-error, the truth is in `hops`.
  assert.equal(modelCall(report, MODEL_CALL.SYNTHESIS).reason, REASON.HTTP);
  assert.notEqual(modelCall(report, MODEL_CALL.SYNTHESIS).reason, REASON.TIMEOUT);
  assert.equal(callTimedOut(report, MODEL_CALL.SYNTHESIS), true);
  assert.equal(callFailed(report, MODEL_CALL.SYNTHESIS), true);
});

test('ADR-042: a record written NOW has one hop, and reason and that hop agree', async () => {
  // The single-backend shape: one attempt, so the disagreement the predicate
  // exists to survive can no longer arise in a fresh record.
  const hole = await startBlackHole();
  const { onOutcome, seen } = collector();
  const out = await requestAgentSynthesis(SYNTHESIS_BODY, {
    endpoint: `http://127.0.0.1:${hole.address().port}/agent-synthesis`,
    timeoutMs: 150,
    onOutcome,
  });
  hole.close();
  assert.equal(out, null);
  assert.equal(seen[0].ok, false);
  assert.equal(seen[0].hops.length, 1, 'one backend, one attempt, one hop');
  assert.equal(seen[0].hops[0].backend, 'primary');
  assert.equal(seen[0].hops[0].kind, 'timeout');
  // The cause is now the cause — no dead fallback relabelling it as a 404.
  assert.equal(seen[0].reason, REASON.TIMEOUT);
  assert.equal(seen[0].status, null);
});

test('success records ok:true with the status and the backend that answered', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents: [{ name: 'backend-developer' }], edges: [] }));
  });
  const { onOutcome, seen } = collector();
  const out = await requestAgentSynthesis(SYNTHESIS_BODY, { endpoint: urlOf(server), onOutcome });
  server.close();
  assert.ok(out);
  assert.equal(seen[0].ok, true);
  assert.equal(seen[0].reason, REASON.OK);
  assert.equal(seen[0].status, 200);
  assert.equal(seen[0].backend, 'primary');
});

test('the roadmap client records the same vocabulary (one mechanism, not three)', async () => {
  const server = await startServer((req, res) => {
    res.writeHead(503);
    res.end('down');
  });
  const { onOutcome, seen } = collector();
  const curated = { whatUnlocks: 'x', steps: [{ text: 'a', estimate: '1h' }], tips: ['t'], mistakes: ['m'] };
  const out = await requestRoadmapPersonalization({ curated }, { endpoint: urlOf(server, '/roadmap'), onOutcome });
  server.close();
  assert.equal(out, null);
  // 503 on the LAST hop of the chain is returned, not thrown, so the client
  // sees it as an http-error — the same reason the synthesis client records.
  assert.equal(seen[0].reason, REASON.HTTP);
  assert.equal(seen[0].status, 503);
});

test('a client with no onOutcome behaves exactly as before (instrumentation is optional)', async () => {
  const url = await deadUrl();
  const out = await requestAgentSynthesis(SYNTHESIS_BODY, { endpoint: url, timeoutMs: 500 });
  assert.equal(out, null, 'no callback, no throw, same null');
});

/* ---------- what the talent SEES (the notices) ---------- */
// Fed by the record shape the real clients emit (asserted above), not by an invented one: the same object that came out of `onOutcome` is what the render layer is handed here.

function baseReport(extra = {}) {
  return {
    generatedAt: '2026-08-03T10:00:00.000Z',
    tools: [],
    technologies: [],
    agents: [{ name: 'backend-developer', tools: ['Read'], model: 'sonnet', parent: null }],
    skills: [],
    commands: [],
    hooks: [],
    mcp: { servers: [] },
    automations: [],
    ...extra,
  };
}

test('terminal: a FAILED synthesis says NOTHING about it (the removed note) -- never jargon from the record either', () => {
  const report = baseReport();
  attachModelCall(report, MODEL_CALL.SYNTHESIS, { attemptedAt: '2026-08-03T10:00:00.000Z', ok: false, reason: REASON.TIMEOUT, status: null, backend: null, elapsedMs: 8001, timeoutMs: 8000, hops: [] });
  const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, 'es', { showRoadmap: false });
  assert.equal(/timeout|network-error|http-error/.test(out), false);
  assert.equal(out.includes('organigrama'), false);
});

test('terminal: a SKIPPED synthesis says nothing at all (control) -- same as a failed one, no distinction any more', () => {
  const report = baseReport();
  attachModelCall(report, MODEL_CALL.SYNTHESIS, skipped(REASON.NO_ENDPOINT));
  const failedReport = baseReport();
  attachModelCall(failedReport, MODEL_CALL.SYNTHESIS, { attemptedAt: '2026-08-03T10:00:00.000Z', ok: false, reason: REASON.TIMEOUT, status: null, backend: null, elapsedMs: 8001, timeoutMs: 8000, hops: [] });
  const outSkipped = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, 'es', { showRoadmap: false });
  const outFailed = renderTerminal(failedReport, { level: 'basic', tierKey: 'T2' }, 'es', { showRoadmap: false });
  assert.equal(outSkipped, outFailed, 'a failed synthesis call must render byte-identically to a skipped one now');
});

for (const lang of ['es', 'en']) {
  test(`terminal [${lang}]: a FAILED roadmap personalization says you are reading the generic one`, () => {
    const t = getCatalog(lang);
    const report = baseReport();
    attachModelCall(report, MODEL_CALL.ROADMAP, { attemptedAt: '2026-08-03T10:00:00.000Z', ok: false, reason: REASON.NETWORK, status: null, backend: null, elapsedMs: 12, timeoutMs: 8000, hops: [] });
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: true });
    assert.equal(out.includes(t.html.roadmapNotPersonalizedNotice.slice(0, 40)), true);
    assert.equal(out.includes(t.html.roadmapPersonalizedNotice), false, 'never both notices');
  });

  test(`terminal [${lang}]: a SUCCESSFUL personalization says the content IS adapted`, () => {
    const t = getCatalog(lang);
    const report = baseReport({
      roadmapPersonalization: {
        whatUnlocks: 'Algo adaptado',
        steps: [],
        tips: [],
        mistakes: [],
      },
    });
    attachModelCall(report, MODEL_CALL.ROADMAP, { attemptedAt: '2026-08-03T10:00:00.000Z', ok: true, reason: REASON.OK, status: 200, backend: 'primary', elapsedMs: 900, timeoutMs: 8000, hops: [] });
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: true });
    assert.equal(out.includes(t.html.roadmapPersonalizedNotice), true);
    assert.equal(out.includes(t.html.roadmapNotPersonalizedNotice.slice(0, 40)), false);
  });

  test(`terminal [${lang}]: a SKIPPED personalization says neither (control)`, () => {
    const t = getCatalog(lang);
    const report = baseReport();
    attachModelCall(report, MODEL_CALL.ROADMAP, skipped(REASON.MAX_TIER));
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: true });
    assert.equal(out.includes(t.html.roadmapNotPersonalizedNotice.slice(0, 40)), false);
    assert.equal(out.includes(t.html.roadmapPersonalizedNotice), false);
  });
}

// ISSUE 116: THE ONE FAILURE STATE THAT SAID NOTHING.
for (const lang of ['es', 'en']) {
  test(`terminal [${lang}]: a TIMED-OUT evaluation says so AND says it scales with the agent count`, () => {
    const t = getCatalog(lang);
    const report = baseReport();
    attachModelCall(report, MODEL_CALL.EVALUATION, { attemptedAt: '2026-08-04T09:32:29.000Z', ok: false, reason: REASON.TIMEOUT, status: null, backend: null, elapsedMs: 150035, timeoutMs: 150000, hops: [] });
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: false });

    const timedOut = needle(t.classification.agentsEvalTimedOut(1), `${lang} agentsEvalTimedOut`);
    // Compared on the first 40 chars because the renderer wraps long prose.
    assert.equal(out.includes(timedOut.slice(0, 40)), true);
    // The count is the DETECTED agent count (baseReport has exactly one), not a
    // guess and not the number the model happened to return.
    assert.equal(out.includes(String(report.agents.length)), true);
    // Never both: the generic retry advice must not appear for a timeout.
    assert.equal(out.includes(needle(t.classification.agentsEvalMissing, `${lang} agentsEvalMissing`).slice(0, 40)), false);
    // And no record jargon leaks to the talent (same bar as the synthesis notice).
    assert.equal(/timeout|network-error|http-error|150035/.test(out), false);
  });

  test(`terminal [${lang}]: a failure we CANNOT name gets the generic notice, which does advise retrying`, () => {
    // Issue 116 wrote this with `reason: NETWORK`, because at the time there were only two notices: deadline, and everything else.
    const t = getCatalog(lang);
    const report = baseReport();
    attachModelCall(report, MODEL_CALL.EVALUATION, { attemptedAt: '2026-08-04T09:32:29.000Z', ok: false, reason: REASON.MALFORMED_JSON, status: 200, backend: 'primary', elapsedMs: 12, timeoutMs: 150000, hops: [] });
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: false });

    assert.equal(out.includes(needle(t.classification.agentsEvalMissing, `${lang} agentsEvalMissing`).slice(0, 40)), true);
    assert.equal(out.includes(needle(t.classification.agentsEvalTimedOut(1), `${lang} agentsEvalTimedOut`).slice(0, 40)), false);
    assert.equal(out.includes(needle(t.classification.agentsEvalUnreachable, `${lang} unreachable`).slice(0, 40)), false);
    assert.equal(out.includes(needle(t.classification.agentsEvalErrored, `${lang} errored`).slice(0, 40)), false);
  });

  test(`terminal [${lang}]: a SKIPPED evaluation says nothing at all (control)`, () => {
    const t = getCatalog(lang);
    const report = baseReport();
    attachModelCall(report, MODEL_CALL.EVALUATION, skipped(REASON.NO_ENDPOINT));
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: false });
    assert.equal(out.includes(needle(t.classification.agentsEvalMissing, `${lang} agentsEvalMissing`).slice(0, 40)), false);
    assert.equal(out.includes(needle(t.classification.agentsEvalTimedOut(1), `${lang} agentsEvalTimedOut`).slice(0, 40)), false);
  });

  test(`terminal [${lang}]: a SUCCESSFUL evaluation says nothing either (control)`, () => {
    const t = getCatalog(lang);
    const report = baseReport({
      agentEvaluation: {
        evaluations: [{
          name: 'backend-developer',
          rationale: 'Clear scope.',
          description: 'Implements server-side features.',
          classification: { catalogId: 'dev-1', category: 'developer', role: 'AI-Assisted Code Writer', level: 'L1', method: 'llm' },
          improvements: [],
        }],
      },
    });
    attachModelCall(report, MODEL_CALL.EVALUATION, { attemptedAt: '2026-08-04T09:36:05.000Z', ok: true, reason: REASON.OK, status: 200, backend: 'primary', elapsedMs: 32000, timeoutMs: 150000, hops: [] });
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: false });
    assert.equal(out.includes(needle(t.classification.agentsEvalMissing, `${lang} agentsEvalMissing`).slice(0, 40)), false);
    assert.equal(out.includes(needle(t.classification.agentsEvalTimedOut(1), `${lang} agentsEvalTimedOut`).slice(0, 40)), false);
  });
}

// THE TWO-HOP CHAIN HIDES A TIMEOUT BEHIND THE FALLBACK'S 404 (issue 116).
const REAL_CHAIN_TIMEOUT = Object.freeze({
  attemptedAt: '2026-08-04T10:08:54.624Z',
  ok: false,
  reason: REASON.HTTP,
  status: 404,
  backend: 'fallback',
  elapsedMs: 150038,
  timeoutMs: 150000,
  hops: [
    { backend: 'primary', status: null, kind: 'timeout' },
    { backend: 'fallback', status: 404, kind: null },
  ],
  omitted: [],
});

test('callTimedOut: sees the primary hop timeout that `reason` hides behind the fallback 404', () => {
  const report = baseReport();
  attachModelCall(report, MODEL_CALL.EVALUATION, { ...REAL_CHAIN_TIMEOUT });
  // The trap, asserted explicitly so nobody "simplifies" the predicate back.
  assert.notEqual(modelCall(report, MODEL_CALL.EVALUATION).reason, REASON.TIMEOUT);
  assert.equal(callTimedOut(report, MODEL_CALL.EVALUATION), true);
});

test('callTimedOut: single-hop timeout (no fallback configured) is still a timeout', () => {
  const report = baseReport();
  attachModelCall(report, MODEL_CALL.EVALUATION, {
    attemptedAt: '2026-08-04T10:00:00.000Z', ok: false, reason: REASON.TIMEOUT, status: null,
    backend: null, elapsedMs: 150035, timeoutMs: 150000, hops: [{ backend: 'primary', status: null, kind: 'timeout' }],
  });
  assert.equal(callTimedOut(report, MODEL_CALL.EVALUATION), true);
});

test('callTimedOut: false for a failure with no deadline involved, and for success/skip (controls)', () => {
  const httpOnly = baseReport();
  attachModelCall(httpOnly, MODEL_CALL.EVALUATION, {
    attemptedAt: '2026-08-04T10:00:00.000Z', ok: false, reason: REASON.HTTP, status: 500,
    backend: 'fallback', elapsedMs: 40, timeoutMs: 150000,
    hops: [{ backend: 'primary', status: 500, kind: null }, { backend: 'fallback', status: 500, kind: null }],
  });
  assert.equal(callTimedOut(httpOnly, MODEL_CALL.EVALUATION), false);

  const skippedReport = baseReport();
  attachModelCall(skippedReport, MODEL_CALL.EVALUATION, skipped(REASON.NO_ENDPOINT));
  assert.equal(callTimedOut(skippedReport, MODEL_CALL.EVALUATION), false);

  const okReport = baseReport();
  attachModelCall(okReport, MODEL_CALL.EVALUATION, {
    attemptedAt: '2026-08-04T10:00:00.000Z', ok: true, reason: REASON.OK, status: 200,
    backend: 'primary', elapsedMs: 73379, timeoutMs: 150000, hops: [],
  });
  assert.equal(callTimedOut(okReport, MODEL_CALL.EVALUATION), false);

  // No record at all (an older report shape) must not throw.
  assert.equal(callTimedOut(baseReport(), MODEL_CALL.EVALUATION), false);
});

for (const lang of ['es', 'en']) {
  test(`terminal [${lang}]: the REAL chain-timeout record gets the scale notice, not the retry one`, () => {
    const t = getCatalog(lang);
    const report = baseReport();
    attachModelCall(report, MODEL_CALL.EVALUATION, { ...REAL_CHAIN_TIMEOUT });
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: false });
    assert.equal(out.includes(needle(t.classification.agentsEvalTimedOut(1), `${lang} timedOut`).slice(0, 40)), true);
    assert.equal(out.includes(needle(t.classification.agentsEvalMissing, `${lang} missing`).slice(0, 40)), false);
    // And still no wire jargon for the talent.
    assert.equal(/http-error|404|150038/.test(out), false);
  });
}

const REAL_FAILURES = Object.freeze({
  timeout: { reason: REASON.TIMEOUT, status: null, elapsedMs: 150002, hops: [{ backend: 'primary', status: null, kind: 'timeout' }] },
  unreachable: { reason: REASON.NETWORK, status: null, elapsedMs: 0, hops: [{ backend: 'primary', status: null, kind: 'network-error' }] },
  errored: { reason: REASON.HTTP, status: 503, elapsedMs: 1, hops: [{ backend: 'primary', status: 503, kind: null }] },
  other: { reason: REASON.MALFORMED_JSON, status: 200, elapsedMs: 5, hops: [{ backend: 'primary', status: 200, kind: null }] },
});

for (const lang of ['es', 'en']) {
  test(`125 [${lang}]: each real failure cause produces its OWN notice, and they never overlap`, () => {
    const cls = getCatalog(lang).classification;
    const expected = {
      timeout: needle(cls.agentsEvalTimedOut(1), `${lang} timedOut`),
      unreachable: needle(cls.agentsEvalUnreachable, `${lang} unreachable`),
      errored: needle(cls.agentsEvalErrored, `${lang} errored`),
      other: needle(cls.agentsEvalMissing, `${lang} missing`),
    };
    // Non-vacuous: four DISTINCT strings, or the test below proves nothing.
    assert.equal(new Set(Object.values(expected)).size, 4, 'the four notices must differ');

    for (const [name, rec] of Object.entries(REAL_FAILURES)) {
      const report = baseReport();
      attachModelCall(report, MODEL_CALL.EVALUATION, {
        attemptedAt: '2026-08-04T00:00:00.000Z', ok: false, backend: null, timeoutMs: 150000, ...rec,
      });
      const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: false })
        .replace(/\x1b\[[0-9;]*m/g, '');
      // The expected notice is present...
      assert.ok(out.includes(expected[name].slice(0, 40)), `${name}: its own notice is missing`);
      // ...and none of the other three is.
      for (const [otherName, text] of Object.entries(expected)) {
        if (otherName === name) continue;
        assert.equal(out.includes(text.slice(0, 40)), false, `${name}: also showed the ${otherName} notice`);
      }
      // And no wire jargon reaches the talent, in any of the four.
      assert.equal(/http-error|network-error|malformed-json|503|150002/.test(out), false, `${name}: leaked jargon`);
    }
  });

  test(`125 [${lang}]: a PERSISTED pre-ADR-042 record still gets the DEADLINE notice, not the error one`, () => {
    // The regression this guards is subtle and is the whole reason `callTimedOut` survived the retirement.
    const cls = getCatalog(lang).classification;
    const report = baseReport();
    attachModelCall(report, MODEL_CALL.EVALUATION, {
      attemptedAt: '2026-08-04T10:08:54.624Z', ok: false, reason: REASON.HTTP, status: 404,
      backend: 'fallback', elapsedMs: 150038, timeoutMs: 150000,
      hops: [{ backend: 'primary', status: null, kind: 'timeout' }, { backend: 'fallback', status: 404, kind: null }],
    });
    const out = renderTerminal(report, { level: 'basic', tierKey: 'T2' }, lang, { showRoadmap: false })
      .replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(out.includes(needle(cls.agentsEvalTimedOut(1), 'timedOut').slice(0, 40)));
    assert.equal(out.includes(needle(cls.agentsEvalErrored, 'errored').slice(0, 40)), false,
      'the masked 404 was taken at face value');
  });
}
