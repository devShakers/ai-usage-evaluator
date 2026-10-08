'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { buildAgentEvaluationRequest, requestAgentEvaluation, normalizeOmittedAgentNames } = require('../src/agent-evaluation');
const { MODEL_CALL, REASON, SUCCESS_REASONS, SKIP_REASONS, FAILURE_REASONS, attachModelCall, callFailed, callSucceeded, callPartial, omittedByCall } = require('../src/model-call-record');
const { buildFootprintDrawer } = require('../src/graph-scan');
const { renderTerminal } = require('../src/render-terminal');
const { renderSheet } = require('../src/render-sheet');
const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { parseAgentDescriptions } = require('../src/agent-org-chart');
const { getCatalog } = require('../src/i18n');

// A PARTIAL SUCCESS IS NOT A SUCCESS (2026-08-03, from a real incident).

/* ---------- 1. the client ---------- */

function startServer(payload, { status = 200 } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const NINE = ['cfo', 'content-creator', 'crm-manager', 'fullstack-dev', 'growth-manager', 'product-manager', 'project-manager', 'seo-writer', 'ux-ui-designer'];

function agentsFor(names) {
  return names.map((name) => ({ name, tools: ['Read'], model: 'sonnet', parent: null }));
}
function definitionsFor(names) {
  return names.map((name) => ({ name, definition: `Definition of ${name}. It does things.` }));
}
function evaluationFor(name, { category = 'developer' } = {}) {
  return {
    name,
    rationale: 'r',
    description: `${name} does things`,
    classification: { catalogId: `cat-${name}`, category, role: 'Role', level: 'L2', method: 'llm' },
    improvements: [],
  };
}

test('the client reports the omitted names the service declares', async () => {
  // The reported incident, to scale: 9 sent, 1 answered.
  const server = await startServer({
    evaluations: [evaluationFor('cfo')],
    omittedAgentNames: NINE.slice(1),
  });
  const body = buildAgentEvaluationRequest(agentsFor(NINE), definitionsFor(NINE), 'es', false);
  const out = await requestAgentEvaluation(body, { endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation` });
  server.close();
  assert.equal(out.evaluations.length, 1);
  assert.deepEqual(out.omittedAgentNames, NINE.slice(1));
});

test('THE LIST IS NOT TAKEN ON TRUST: an omission the service does NOT declare is still caught', async () => {
  // The half that cannot be wrong.
  const server = await startServer({
    evaluations: [evaluationFor('cfo'), evaluationFor('seo-writer')],
    omittedAgentNames: [], // the service claims a complete run
  });
  const body = buildAgentEvaluationRequest(agentsFor(NINE), definitionsFor(NINE), 'es', false);
  const out = await requestAgentEvaluation(body, { endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation` });
  server.close();
  assert.equal(out.omittedAgentNames.length, 7, 'seven agents were sent and never came back');
  assert.equal(out.omittedAgentNames.includes('cfo'), false);
  assert.equal(out.omittedAgentNames.includes('seo-writer'), false);
});

test('a name we never sent is ignored, even if the service names it', () => {
  // Not the Talent's agent → must never reach a surface.
  const requested = { agents: agentsFor(['a', 'b']) };
  const got = normalizeOmittedAgentNames({ omittedAgentNames: ['b', 'ghost-agent'] }, requested, [{ name: 'a' }]);
  assert.deepEqual(got, ['b']);
});

test('a complete run reports an empty list, not a missing field', async () => {
  const server = await startServer({
    evaluations: NINE.map((n) => evaluationFor(n)),
    omittedAgentNames: [],
  });
  const body = buildAgentEvaluationRequest(agentsFor(NINE), definitionsFor(NINE), 'es', false);
  const out = await requestAgentEvaluation(body, { endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation` });
  server.close();
  assert.deepEqual(out.omittedAgentNames, [], '[] is a statement, not an absence');
});

/* ---------- 2. the record ---------- */

test("THE RECORD: a partial run is ok:true with reason 'ok-partial' and the names", async () => {
  const server = await startServer({ evaluations: [evaluationFor('cfo')], omittedAgentNames: NINE.slice(1) });
  const body = buildAgentEvaluationRequest(agentsFor(NINE), definitionsFor(NINE), 'es', false);
  let rec = null;
  await requestAgentEvaluation(body, {
    endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation`,
    onOutcome: (r) => { rec = r; },
  });
  server.close();

  assert.equal(rec.ok, true, 'the answer WAS used — the agents that came back are shown');
  assert.equal(rec.reason, REASON.OK_PARTIAL, 'and the run was not clean');
  assert.deepEqual(rec.omitted, NINE.slice(1));
  assert.equal(rec.status, 200);

  // The three predicates, which must not overlap: this is a success, it is not a
  // failure, and it IS partial.
  const report = {};
  attachModelCall(report, MODEL_CALL.EVALUATION, rec);
  assert.equal(callSucceeded(report, MODEL_CALL.EVALUATION), true);
  assert.equal(callFailed(report, MODEL_CALL.EVALUATION), false, 'a partial run must NOT fire the "what you lost" notice');
  assert.equal(callPartial(report, MODEL_CALL.EVALUATION), true);
  assert.deepEqual(omittedByCall(report, MODEL_CALL.EVALUATION), NINE.slice(1));
});

test("a COMPLETE run stays reason 'ok' and is not partial", async () => {
  const server = await startServer({ evaluations: NINE.map((n) => evaluationFor(n)), omittedAgentNames: [] });
  const body = buildAgentEvaluationRequest(agentsFor(NINE), definitionsFor(NINE), 'es', false);
  let rec = null;
  await requestAgentEvaluation(body, {
    endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation`,
    onOutcome: (r) => { rec = r; },
  });
  server.close();
  assert.equal(rec.reason, REASON.OK);
  assert.deepEqual(rec.omitted, []);
  const report = {};
  attachModelCall(report, MODEL_CALL.EVALUATION, rec);
  assert.equal(callPartial(report, MODEL_CALL.EVALUATION), false);
});

test('the reason vocabulary is partitioned into exactly THREE families', () => {
  // Extends issue 109's guard: `ok` used to be the single special case, and now
  // there are two success reasons. A new reason has to be classified or this fails.
  for (const value of Object.values(REASON)) {
    const inSets = [SUCCESS_REASONS.has(value), SKIP_REASONS.has(value), FAILURE_REASONS.has(value)].filter(Boolean).length;
    assert.equal(inSets, 1, `${value} must be in exactly one family (it is in ${inSets})`);
  }
  assert.equal(SUCCESS_REASONS.has(REASON.OK_PARTIAL), true);
});

/* ---------- 3. the surfaces, fed by the real client ---------- */

function unesc(html) {
  return String(html).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

// THE ROW LABEL, ON ITS OWN LINE — and this precision came from the control run.
function hasRowLabel(terminalOut, label) {
  return terminalOut
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .some((line) => line.trim() === label);
}

let tmpRoot;
let tmpHome;
let originalHome;

// A real project with three real agent files, so the surfaces are fed by the object
// the real scan produces (the rule in AGENTS.md, learnt in issue 106).
test('setup: a real project with three agents, HOME isolated', () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-partial-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-partial-home-'));
  originalHome = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
  fs.mkdirSync(path.join(tmpRoot, '.claude', 'agents'), { recursive: true });
  for (const name of ['alpha', 'beta', 'gamma']) {
    fs.writeFileSync(
      path.join(tmpRoot, '.claude', 'agents', `${name}.md`),
      ['---', `name: ${name}`, `description: The ${name} agent`, 'tools: Read', 'model: sonnet', '---', 'Body.'].join('\n'),
    );
  }
});

// alpha classified, beta unclassified, gamma OMITTED — the three interesting states
// on one screen, produced by the real client against a local server.
async function partialReport() {
  const report = scan({ root: tmpRoot });
  report.agentDescriptions = parseAgentDescriptions(tmpRoot);
  const server = await startServer({
    evaluations: [
      evaluationFor('alpha'),
      { name: 'beta', rationale: 'r', description: 'beta', classification: null, improvements: [] },
    ],
    omittedAgentNames: ['gamma'],
  });
  let rec = null;
  const body = buildAgentEvaluationRequest(report.agents, parseAgentDescriptions(tmpRoot).map((d) => ({ name: d.name, definition: d.description })), 'es', false);
  report.agentEvaluation = await requestAgentEvaluation(body, {
    endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation`,
    onOutcome: (r) => { rec = r; },
  });
  server.close();
  attachModelCall(report, MODEL_CALL.EVALUATION, rec);
  return { report, maturity: classify(report), rec };
}

test('the shared shaping layer resolves FOUR distinct states, once', async () => {
  const { report, maturity } = await partialReport();
  const drawer = buildFootprintDrawer(report, maturity, getCatalog('es'));
  const byName = Object.fromEntries(drawer.agents.map((a) => [a.name, a.evaluationState]));
  assert.equal(byName.alpha, 'classified');
  assert.equal(byName.beta, 'unclassified');
  assert.equal(byName.gamma, 'omitted');
  // And the fourth: a report with no evaluation at all.
  const bare = scan({ root: tmpRoot });
  bare.agentDescriptions = parseAgentDescriptions(tmpRoot);
  const bareDrawer = buildFootprintDrawer(bare, classify(bare), getCatalog('es'));
  assert.equal(bareDrawer.agents[0].evaluationState, 'not-evaluated');
});

for (const lang of ['es', 'en']) {
  test(`terminal [${lang}]: the omitted agent is marked in place, and the notice NAMES it`, async () => {
    const t = getCatalog(lang);
    const { report, maturity } = await partialReport();
    const out = renderTerminal(report, maturity, lang, { showRoadmap: false });
    const flat = out.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ');

    assert.ok(hasRowLabel(out, t.classification.agentEvalOmitted), 'the row label for the omitted agent is missing');
    // Named, not counted — the actionable half.
    assert.ok(flat.includes(t.classification.agentsEvalPartial('gamma', 1).replace(/\s+/g, ' ')), 'the notice does not name the omitted agent');
    // The other two states still read as themselves.
    assert.ok(out.includes(t.classification.categories.developer), 'alpha keeps its category');
    assert.ok(out.includes(t.classification.noCategory), 'beta still reads "no category"');
    assert.equal(out.includes('organigrama'), false);
    assert.equal(out.includes('org chart'), false);
  });

  test(`shared report [${lang}]: same four states, same words`, async () => {
    const t = getCatalog(lang);
    const { report, maturity } = await partialReport();
    const html = renderSheet({
      root: tmpRoot,
      footprint: { report, maturity },
      certifications: {},
      agentCertifications: {},
      backendAcceptance: {},
    }, lang);

    assert.ok(html.includes(t.classification.agentEvalOmitted), 'the omitted state is missing from the shared report');
    assert.ok(unesc(html).includes(t.classification.agentsEvalPartial('gamma', 1)), 'the notice does not name it');
    assert.ok(html.includes(t.classification.categories.developer));
    // NOT the "nobody was evaluated" notice: two agents were.
    assert.equal(html.includes(t.sheet.agentsEvalMissing), false, 'the 106 notice must not fire on a PARTIAL run');
    // NOT "not assessed" either: that is the state for a run that never happened.
    assert.equal(html.includes(t.sheet.agentNotEvaluated), false);
  });
}

test('CONTROL: a COMPLETE run says none of it', async () => {
  // Without this, every assertion above could be passing because the notices are always on.
  const t = getCatalog('es');
  const report = scan({ root: tmpRoot });
  report.agentDescriptions = parseAgentDescriptions(tmpRoot);
  const server = await startServer({
    evaluations: ['alpha', 'beta', 'gamma'].map((n) => evaluationFor(n)),
    omittedAgentNames: [],
  });
  let rec = null;
  const body = buildAgentEvaluationRequest(report.agents, definitionsFor(['alpha', 'beta', 'gamma']), 'es', false);
  report.agentEvaluation = await requestAgentEvaluation(body, {
    endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation`,
    onOutcome: (r) => { rec = r; },
  });
  server.close();
  attachModelCall(report, MODEL_CALL.EVALUATION, rec);
  const maturity = classify(report);

  const out = renderTerminal(report, maturity, 'es', { showRoadmap: false });
  const html = renderSheet({ root: tmpRoot, footprint: { report, maturity }, certifications: {}, agentCertifications: {}, backendAcceptance: {} }, 'es');
  for (const [surface, text] of Object.entries({ terminal: out, sheet: html })) {
    assert.equal(text.includes(t.classification.agentEvalOmitted), false, `${surface} marks an omitted agent on a complete run`);
    // (safe as a whole-document check HERE: on a complete run neither the row label
    // nor the notice may appear, so there is no sibling copy to satisfy it.)
    assert.equal(text.includes('se quedaron fuera de esta ejecución'), false, `${surface} shows the partial notice on a complete run`);
    assert.equal(text.includes('se quedó fuera de esta ejecución'), false, `${surface} shows the singular partial notice on a complete run`);
  }
  assert.equal(rec.reason, REASON.OK);
});

test('a report persisted BEFORE this field keeps painting its three states', () => {
  // THE REACHABLE CASE, which is not the one this test first checked.
  const t = getCatalog('es');
  const report = scan({ root: tmpRoot });
  report.agentDescriptions = parseAgentDescriptions(tmpRoot);
  // An old-shape evaluation: entries, no `omittedAgentNames` field at all.
  report.agentEvaluation = {
    promptVersion: 'agent-eval-v1',
    evaluations: [{ name: 'alpha', rationale: 'r', description: 'a', classification: { catalogId: 'x', category: 'developer', role: 'R', level: 'L2', method: 'llm' }, improvements: [] }],
  };
  const maturity = classify(report);

  const drawer = buildFootprintDrawer(report, maturity, t);
  const byName = Object.fromEntries(drawer.agents.map((a) => [a.name, a.evaluationState]));
  assert.equal(byName.alpha, 'classified');
  assert.equal(byName.beta, 'not-evaluated', 'without the field, an absent agent is "never asked", not "omitted"');
  assert.equal(byName.gamma, 'not-evaluated');

  const html = renderSheet({ root: tmpRoot, footprint: { report, maturity }, certifications: {}, agentCertifications: {}, backendAcceptance: {} }, 'es');
  assert.ok(html.includes(t.sheet.agentNotEvaluated), 'the 106 state still shows');
  assert.equal(html.includes(t.classification.agentEvalOmitted), false, 'nobody is marked omitted without the field');
});

test('ALL omitted: reads as a partial run, never as "we never asked"', async () => {
  // The case my own precedence got wrong first, and it is reachable: the incident answered 1 of 9 and could have answered 0.
  const t = getCatalog('es');
  const report = scan({ root: tmpRoot });
  report.agentDescriptions = parseAgentDescriptions(tmpRoot);
  const server = await startServer({ evaluations: [], omittedAgentNames: ['alpha', 'beta', 'gamma'] });
  let rec = null;
  const body = buildAgentEvaluationRequest(report.agents, definitionsFor(['alpha', 'beta', 'gamma']), 'es', false);
  report.agentEvaluation = await requestAgentEvaluation(body, {
    endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation`,
    onOutcome: (r) => { rec = r; },
  });
  server.close();
  attachModelCall(report, MODEL_CALL.EVALUATION, rec);
  const maturity = classify(report);

  assert.equal(rec.reason, REASON.OK_PARTIAL, 'zero coverage is still a partial success, not a failure');
  assert.equal(rec.omitted.length, 3);

  const html = renderSheet({ root: tmpRoot, footprint: { report, maturity }, certifications: {}, agentCertifications: {}, backendAcceptance: {} }, 'es');
  assert.ok(unesc(html).includes(t.classification.agentsEvalPartial('alpha, beta, gamma', 3)), 'the partial notice must name all three');
  assert.equal(html.includes(t.sheet.agentsEvalMissing), false, 'the 106 notice claims nobody asked, and somebody did');

  const out = renderTerminal(report, maturity, 'es', { showRoadmap: false });
  const flat = out.replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
  assert.ok(flat.includes(t.classification.agentsEvalPartial('alpha, beta, gamma', 3).replace(/\s+/g, ' ')));
});

test('teardown', () => {
  if (originalHome === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHome;
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (tmpHome) fs.rmSync(tmpHome, { recursive: true, force: true });
});
