'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { parseAgentDescriptions } = require('../src/agent-org-chart');
const { buildAgentEvaluationRequest, requestAgentEvaluation } = require('../src/agent-evaluation');
const { renderTerminal } = require('../src/render-terminal');
const { renderSheet } = require('../src/render-sheet');
const { getCatalog } = require('../src/i18n');

// Issue 092: what the talent SEES gets a test on the surface that shows it.

/* ---------- the real pipeline, once ---------- */

const AGENT = 'sentinel-migrator';
// Values chosen to be unmistakable in a rendered document.
const SERVER_EVALUATION = {
  evaluations: [
    {
      name: AGENT,
      rationale: 'SENTINEL-RATIONALE unique string',
      description: 'SENTINEL-DESCRIPTION migrates legacy modules.',
      classification: { catalogId: 'agent-42', category: 'developer', role: 'SENTINEL-ROLE Backend Engineer', level: 'L2', method: 'llm' },
      improvements: ['SENTINEL-TIP add a concrete example', 'SENTINEL-TIP-2 name the output format'],
    },
  ],
};

let tmpRoot;
let baseReport;
let maturity;

function projectShape(report, mat) {
  return {
    root: tmpRoot,
    updatedAt: new Date().toISOString(),
    footprint: { generatedAt: report.generatedAt, report, maturity: mat },
    certifications: {},
    agentCertifications: {},
    backendAcceptance: {},
  };
}

function startServer(payload) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Runs the REAL evaluation client against a local server and returns whatever
// the production code path produces — including its normalizer.
async function realEvaluation(report, payload) {
  const server = await startServer(payload);
  try {
    const body = buildAgentEvaluationRequest(report.agents, parseAgentDescriptions(tmpRoot), 'es', false);
    return await requestAgentEvaluation(body, { endpoint: `http://127.0.0.1:${server.address().port}/agent-evaluation` });
  } finally {
    server.close();
  }
}

test('setup: a real project, scanned, described and evaluated through the real client', async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-092-'));
  fs.mkdirSync(path.join(tmpRoot, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, '.claude', 'agents', `${AGENT}.md`),
    ['---', `name: ${AGENT}`, 'description: Moves old modules to the new layout', 'tools: Read, Write, Bash', 'model: sonnet', '---', 'Body.'].join('\n'),
  );

  baseReport = scan({ root: tmpRoot });
  baseReport.agentDescriptions = parseAgentDescriptions(tmpRoot);
  maturity = classify(baseReport);
  baseReport.agentEvaluation = await realEvaluation(baseReport, SERVER_EVALUATION);

  // The premise of every assertion below: this is the production object shape.
  assert.equal(baseReport.agentEvaluation.evaluations.length, 1);
  assert.equal(baseReport.agentEvaluation.evaluations[0].classification.category, 'developer');
  assert.equal(baseReport.agentEvaluation.evaluations[0].classification.method, 'llm');
});

/* ---------- THE CASE: the classification, painted ---------- */

for (const lang of ['es', 'en']) {
  test(`terminal [${lang}]: the agent's category, role and level are ON SCREEN`, () => {
    const t = getCatalog(lang);
    const out = renderTerminal(baseReport, maturity, lang, { showRoadmap: false });

    // The category is painted as its LOCALIZED label, not as the raw key: a test that asserted `developer` would pass while the talent read a bare English key in a Spanish report.
    const label = t.classification.categories.developer;
    assert.ok(out.includes(label), `the category label "${label}" is not on screen`);
    assert.equal(out.includes('agent-42'), false, 'the internal catalogId is never shown to the talent');

    assert.ok(out.includes('SENTINEL-ROLE Backend Engineer'), 'the role is not on screen');
    assert.ok(out.includes(t.classification.levels.L2), 'the level label is not on screen');
    // And the "no category" copy must NOT be there when there IS one.
    assert.equal(out.includes(t.classification.noCategory), false);
  });

  test(`terminal [${lang}]: an evaluated-but-unclassified agent reads "no category", not silence`, async () => {
    const t = getCatalog(lang);
    const report = scan({ root: tmpRoot });
    report.agentDescriptions = parseAgentDescriptions(tmpRoot);
    // Same real client, a server that returns an evaluation with NO catalog match
    // — the normalizer turns that into the explicit unclassified object.
    report.agentEvaluation = await realEvaluation(report, {
      evaluations: [{ name: AGENT, rationale: 'r', description: 'd', classification: null, improvements: [] }],
    });
    assert.equal(report.agentEvaluation.evaluations[0].classification.catalogId, null);

    const out = renderTerminal(report, classify(report), lang, { showRoadmap: false });
    assert.ok(out.includes(t.classification.noCategory), 'an unclassified agent must SAY it is unclassified');
    assert.equal(out.includes(t.classification.categories.developer), false);
  });
}

test('terminal: an agent with NO evaluation at all paints no classification line (three states, not two)', () => {
  const t = getCatalog('es');
  const report = scan({ root: tmpRoot });
  report.agentDescriptions = parseAgentDescriptions(tmpRoot);
  // No `agentEvaluation` at all — the run never got an answer. This is the state
  // issue 106 proved must not look like "unclassified".
  const out = renderTerminal(report, classify(report), 'es', { showRoadmap: false });
  assert.equal(out.includes(t.classification.noCategory), false);
  assert.equal(out.includes(t.classification.categories.developer), false);
  // The agent itself is still painted: losing the classification never loses the agent.
  assert.ok(out.includes(AGENT));
});

/* ---------- the rest of the agent card, on both surfaces ---------- */

test('terminal: the agent card paints name, tools, description and improvement tips', () => {
  const out = renderTerminal(baseReport, maturity, 'es', { showRoadmap: false });
  for (const needleText of [AGENT, 'Read', 'SENTINEL-DESCRIPTION migrates legacy modules.', 'SENTINEL-TIP add a concrete example']) {
    assert.ok(out.includes(needleText), `"${needleText}" is not on the terminal card`);
  }
});

test('terminal: the orchestration root the agents hang from is still there (issue 086, one line, three weeks unnoticed)', () => {
  const t = getCatalog('es');
  const out = renderTerminal(baseReport, maturity, 'es', { showRoadmap: false });
  assert.ok(out.includes(t.html.orchestratorLabel));
});

test('shared report: the same agent and the same category reach the HTML', () => {
  const t = getCatalog('es');
  const html = renderSheet(projectShape(baseReport, maturity), 'es');
  assert.ok(html.includes(AGENT), 'the agent is missing from the shared report (the 089 failure mode)');
  assert.ok(html.includes(t.classification.categories.developer), 'the category is missing from the shared report');
  assert.equal(html.includes('agent-42'), false, 'the internal catalogId never reaches the shared report');
});

test('shared report: an agent with no evaluation is shown as NOT ASSESSED, not as having no category', () => {
  const t = getCatalog('es');
  const report = scan({ root: tmpRoot });
  report.agentDescriptions = parseAgentDescriptions(tmpRoot);
  const html = renderSheet(projectShape(report, classify(report)), 'es');
  // Issue 106's distinction, asserted on the surface that paints it.
  assert.ok(html.includes(t.html.agentNotEvaluated), 'the "not assessed" state is missing');
  assert.equal(html.includes(t.classification.categories.developer), false);
});

/* ---------- the guard on this file ---------- */

test('the covered-data table is exact: every datum listed is painted somewhere', () => {
  const terminal = renderTerminal(baseReport, maturity, 'es', { showRoadmap: false });
  const html = renderSheet(projectShape(baseReport, maturity), 'es');
  const surfaces = { terminal, html };
  const COVERED = {
    'agent name': AGENT,
    'agent description (from the evaluation)': 'SENTINEL-DESCRIPTION migrates legacy modules.',
    'classification category (localized)': getCatalog('es').classification.categories.developer,
    'classification role': 'SENTINEL-ROLE Backend Engineer',
    'classification level (localized)': getCatalog('es').classification.levels.L2,
    'improvement tip': 'SENTINEL-TIP add a concrete example',
    'orchestration root': getCatalog('es').html.orchestratorLabel,
  };
  const unpainted = [];
  for (const [label, value] of Object.entries(COVERED)) {
    const on = Object.entries(surfaces).filter(([, out]) => String(out).includes(value)).map(([n]) => n);
    if (on.length === 0) unpainted.push(label);
  }
  assert.deepEqual(unpainted, [], `these data are no longer painted on any surface: ${unpainted.join(', ')}`);
});

test('teardown', () => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});
