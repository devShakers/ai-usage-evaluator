'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTerminal } = require('../src/render-terminal');
const { getCatalog } = require('../src/i18n');
const { needle } = require('../test-fixtures/copy-needle');
const { resolveReportGate } = require('../src/report-gating');

// ADR-016 terminal redesign.

function strip(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

const BASE_REPORT = {
  generatedAt: '2026-07-10T00:00:00.000Z',
  tools: [
    {
      id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', category: 'CLI agéntica',
      detected: true, signalTypes: ['bin'], signalCount: 1, depth: {},
      footprint: null, recency: { bucket: null }, version: null,
    },
  ],
  environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v22.0.0', editorsInstalled: [] },
  technologies: [],
  agents: [],
};

const MATURITY_NO_TIER = { level: 1, key: 'exploring', name: 'Exploring', score: 20, emoji: 'x', next: 'algo' };
const ROADMAP = { showRoadmap: true };

test('renderTerminal: the Activity block prints sessions/subagents/hours/git/workstreams from the scoped engine blocks', () => {
  const report = {
    ...BASE_REPORT,
    sessions: { sessionCount: 37, subagentRunCount: 241, activeHours: 267, crossToolLinks: 0, filesTouchedCount: 5, bashCommandsCount: 10, redactedCommandSample: [] },
    gitActivity: { authoredCommitCount: 40, commitCount: 50, linesAdded: 1200, linesDeleted: 300, velocity: 2.1, spanDays: 20, filesByType: {} },
    workStreams: { streamCount: 8, multiDayStreams: 3, avgCommitsPerSession: 5, maxStreamSpanDays: 4 },
    analyzedRepos: ['repo-a', 'repo-b'],
  };
  const out = strip(renderTerminal(report, MATURITY_NO_TIER, 'en'));
  assert.ok(out.includes('Activity'));
  assert.ok(out.includes('repo-a, repo-b'));
  assert.ok(out.includes('37 sessions (root)'));
  assert.ok(out.includes('241 subagent runs'));
  assert.ok(out.includes('267 active h'));
  assert.ok(out.includes('40/50 commits by you'));
  assert.ok(out.includes('8 workstreams'));
});

test('renderTerminal: the Activity block is pruned when no engine blocks are present (back-compat)', () => {
  const out = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'en'));
  assert.equal(out.includes('Activity (analyzed repos)'), false);
});

// ADR-016 (2026-07-18): empty sections are PRUNED — no header, no placeholder.
test('renderTerminal: the technologies section is OMITTED entirely when none recognized (no empty placeholder)', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.equal(html.includes('Tecnologías del proyecto'), false);
  assert.equal(html.includes('No se reconoció ningún framework'), false);
});

test('renderTerminal: the detected technologies/skills section is never rendered (agents-only report, every identity)', () => {
  const report = { ...BASE_REPORT, technologies: ['React', 'NestJS'] };
  const gates = [
    resolveReportGate({ loggedIn: true, profile: 'talent' }),
    resolveReportGate({ loggedIn: false, profile: 'talent' }),
    resolveReportGate({ loggedIn: false, profile: 'external' }),
  ];
  for (const gate of gates) {
    for (const lang of ['es', 'en']) {
      const html = strip(renderTerminal(report, MATURITY_NO_TIER, lang, { gate }));
      assert.equal(html.includes('React'), false);
      assert.equal(html.includes('NestJS'), false);
      assert.equal(html.includes('Skills'), false);
      assert.equal(html.includes('Tecnologías del proyecto'), false);
      assert.equal(html.includes('Project technologies'), false);
    }
  }
});

// ADR-016: the Environment ("Entorno") section is GONE from the terminal (it
// stays in the HTML report). It must never render here.
test('renderTerminal: no Environment section in the terminal (ADR-016)', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.equal(html.includes('Entorno'), false);
  assert.equal(html.includes('darwin'), false);
  assert.equal(html.includes('v22.0.0'), false);
});

test('renderTerminal: the agents section is OMITTED entirely when there are no agents (no empty placeholder)', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.equal(html.includes('Agentes'), false);
  assert.equal(html.includes('No se han detectado agentes'), false);
});

// ADR-016: one line per agent — name (+ symbolic name) + model + hierarchy. NO
// tools list, NO description sub-line (those stay in the HTML report).
test('renderTerminal: renders each agent name + AI product + tools; NO model, no "Reports to:" line', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orchestrator', tools: ['Read', 'Task'], aiProduct: 'claude-code', model: 'claude-opus-4', parent: null },
      { name: 'backend-dev', tools: ['Read', 'Write'], aiProduct: 'claude-code', model: 'claude-sonnet-4', parent: 'orchestrator' },
    ],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /orchestrator/);
  assert.match(html, /backend-dev/);
  // AI product replaces the model; the model string must NOT appear.
  assert.match(html, /\[Claude Code\]/);
  assert.equal(html.includes('claude-opus-4'), false);
  assert.equal(html.includes('claude-sonnet-4'), false);
  // The agent's wired tools ARE surfaced now (the per-card "technologies").
  assert.match(html, /Read · Task/);
  assert.equal(html.includes('Reporta a:'), false);
});

// Issue 086: the orchestration root, which 342408e deleted from this section without any suite noticing.
test('renderTerminal: the agents section names the implicit orchestration root (issue 086 regression)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'alpha', tools: [], model: null, parent: null },
      { name: 'beta', tools: [], model: null, parent: null },
    ],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  const t = getCatalog('es');
  assert.match(html, new RegExp(needle(t.html.orchestratorLabel, 't.html.orchestratorLabel')));
  // Not vacuous: with no explicit parent there is no other orchestration signal.
  assert.equal(html.includes('↓'), false, 'no depth markers with a flat parent-less set — the header is all there is');
  // It belongs to the agents section: after its heading, before the first agent.
  const iHeading = html.indexOf(needle(t.html.diagramHeading, 't.html.diagramHeading'));
  const iRoot = html.indexOf(needle(t.html.orchestratorLabel, 't.html.orchestratorLabel'));
  const iFirstAgent = html.indexOf('alpha');
  assert.ok(iHeading >= 0 && iHeading < iRoot && iRoot < iFirstAgent, 'root header sits between the heading and the first agent');
});

test('renderTerminal: no agents -> no orchestration root either (nothing to orchestrate)', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.equal(html.includes(needle(getCatalog('es').html.orchestratorLabel, 'getCatalog(\'es\').html.orchestratorLabel')), false);
});

// ADR-016: nested subagents drawn with stacked down-arrows (↓ per depth).
test('renderTerminal: nested subagents drawn with stacked ↓ per depth', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orchestrator', tools: [], model: 'opus', parent: null },
      { name: 'child', tools: [], model: 'sonnet', parent: 'orchestrator' },
      { name: 'grandchild', tools: [], model: 'sonnet', parent: 'child' },
    ],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /↓ child/); // depth 1 => one arrow
  assert.match(html, /↓↓ grandchild/); // depth 2 => two arrows
});

// ADR-016 agent evaluation: compact score + usage shown per line (join by NAME).
test('renderTerminal: agent cards show NO numeric score AND NO usage signal (both removed)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'alpha', tools: [], aiProduct: 'claude-code', model: 'opus', parent: null },
      { name: 'beta', tools: [], aiProduct: 'claude-code', model: 'haiku', parent: null },
    ],
    agentEvaluation: { evaluations: [{ name: 'alpha', rationale: 'clear' }], promptVersion: 'agent-eval-v1' },
    // Usage is provided but must NOT render anymore.
    agentUsage: { available: true, byAgent: { alpha: 4, beta: 0 } },
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /alpha/);
  assert.match(html, /beta/);
  // Usage signal is GONE from the cards.
  assert.equal(html.includes('usado 4×'), false);
  assert.equal(html.includes('sin uso local'), false);
  // Per-agent numeric score badge is GONE (maturity meter's own /100 is separate).
  assert.equal(/alpha[^\n]*\d+\/100/.test(html), false);
});

test('renderTerminal: a note is shown when local usage history is unavailable', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'a', tools: [], model: null, parent: null }],
    agentUsage: { available: false, byAgent: { a: null } },
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /sin historial local de Claude Code/);
});

test('renderTerminal: agent synthesis symbolic name shown, real name as badge, summarized description shown', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'orchestrator', tools: ['Read'], model: 'opus', parent: null }],
    agentSynthesis: { agents: [{ name: 'orchestrator', symbolicName: 'El Jefe', whatItDoes: 'Coordina el trabajo.' }] },
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /El Jefe/);
  assert.match(html, /\(orchestrator\)/); // real structural name kept visible
  // ADR-016 (2026-07-18): a summarized description IS shown per agent again (dim line).
  assert.match(html, /Coordina el trabajo/);
});

// ADR-016 (2026-07-18): a summarized frontmatter description shows under each agent.
test('renderTerminal: a summarized frontmatter description shows under each agent', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'a', tools: [], model: 'opus', parent: null }],
    agentDescriptions: [{ name: 'a', description: 'Does a very specific thing with clear boundaries and structure.' }],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Does a very specific thing/);
});

test('renderTerminal: an agent with neither synthesis nor a declared description still shows its name', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'bare-agent', tools: [], model: null, parent: null }],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /bare-agent/);
});

// --- roadmap is now behind --roadmap (ADR-016) ------------------------------

test('renderTerminal: the roadmap / next-steps is HIDDEN by default (ADR-016)', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es'));
  assert.equal(html.includes('Tu próximo nivel'), false);
  assert.equal(html.includes('Prompt para implementar'), false);
});

// ADR-016 (TASK B): the default output carries a dim hint pointing at --roadmap.
test('renderTerminal: default output includes the --roadmap discoverability hint', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /usage --roadmap/);
});

// ADR-016 (TASK B): --roadmap renders ONLY the roadmap section, NOT the rest of
// the report (no score meter / tools / technologies / agents), and no hint.
test('renderTerminal: { showRoadmap } renders ONLY the roadmap, not the full report', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const report = { ...BASE_REPORT, technologies: ['React'], agents: [{ name: 'a', tools: [], model: null, parent: null }] };
  const html = strip(renderTerminal(report, maturity, 'es', ROADMAP));
  assert.match(html, /Tu próximo nivel/); // roadmap present
  // NARROWED BY ISSUE 084, and the narrowing is the point of that issue.
  assert.equal(/[█░]/.test(html), false, 'no score meter bar');
  assert.equal(html.includes('Detectadas'), false, 'no detected-tools section');
  assert.equal(html.includes('Tecnologías del proyecto'), false, 'no technologies section');
  assert.equal(html.includes('Análisis de tier'), false, 'no tier-analysis section');
  assert.equal(html.includes('usage --roadmap'), false, 'no self-referential hint in roadmap mode');
});

test('renderTerminal: with { showRoadmap }, shows the tier roadmap (current -> next) instead of the generic band next-step', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'generic band text', tier: 5, tierKey: 'T5' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es', ROADMAP));
  assert.match(html, /Tu próximo nivel/);
  assert.equal(html.includes('generic band text'), false);
});

test('renderTerminal: --build-next-level is announced (under --roadmap) when there is a next tier to build', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es', ROADMAP));
  assert.match(html, /usage --build-next-level/);
  assert.match(html, /Alternativamente/);
});

test('renderTerminal: a jump entry (under --roadmap) shows the copyable implementation prompt in a clearly delimited block', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es', ROADMAP));
  assert.match(html, /Prompt para implementar/);
  assert.match(html, /Ay[uú]dame a implementar/);
});

test('renderTerminal (ADR-008): T7 (max tier, under --roadmap) DOES show a consolidation implementation prompt', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orquestador', score: 100, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es', ROADMAP));
  assert.match(html, /Prompt para implementar/);
  assert.match(html, /consolidar|afinar|tier máximo/i);
});

test('renderTerminal (ADR-008): T7 (under --roadmap) lists the curated improvement steps', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orquestador', score: 90, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es', ROADMAP));
  assert.match(html, /Pasos de consolidación/);
  const { T7_TERMINAL_ES } = require('../src/roadmap-content');
  assert.ok(html.includes(T7_TERMINAL_ES.consolidationSteps[0]));
});

test('renderTerminal (ADR-008): T7 improvement steps render in English too (under --roadmap)', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orchestrator', score: 90, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'en', ROADMAP));
  assert.match(html, /Consolidation steps/);
  const { T7_TERMINAL_EN } = require('../src/roadmap-content');
  assert.ok(html.includes(T7_TERMINAL_EN.consolidationSteps[0]));
});

test('renderTerminal: the implementation prompt reflects detected frameworks (under --roadmap)', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const report = { ...BASE_REPORT, technologies: ['React', 'NestJS'] };
  const html = strip(renderTerminal(report, maturity, 'es', ROADMAP));
  assert.match(html, /React/);
  assert.match(html, /NestJS/);
});

test('renderTerminal: at the max tier (T7, under --roadmap), does NOT announce --build-next-level', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orquestador', score: 100, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es', ROADMAP));
  assert.equal(html.includes('usage --build-next-level'), false);
});

test('renderTerminal: without maturity.tierKey (older shape, under --roadmap), falls back to the generic band next-step text', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es', ROADMAP));
  assert.match(html, /CLAUDE\.md|\.cursorrules|copilot-instructions\.md/);
});

test('renderTerminal: renders in English too (default headings + roadmap heading translated)', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  // Include data for both sections so neither is pruned (ADR-016).
  const report = { ...BASE_REPORT, technologies: ['React'], agents: [{ name: 'a', tools: [], model: 'opus', parent: null }] };
  const def = strip(renderTerminal(report, maturity, 'en'));
  assert.equal(def.includes('Skills'), false);
  assert.match(def, /Agents/);
  // ...and the --roadmap mode carries the roadmap heading.
  const road = strip(renderTerminal(report, maturity, 'en', ROADMAP));
  assert.match(road, /Your next AI-usage level/);
});

test('renderTerminal: never throws on a malformed/cyclical agent parent chain', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'a', tools: [], model: null, parent: 'b' },
      { name: 'b', tools: [], model: null, parent: 'a' },
    ],
  };
  assert.doesNotThrow(() => renderTerminal(report, MATURITY_NO_TIER, 'es'));
});

// --- tier analysis: why this tier (now LEADS the terminal, ADR-016) ---------

test('renderTerminal: tier analysis section always present, with a summarized met-criteria checklist', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /An[aá]lisis de tier/);
  assert.match(html, /Criterios que cumples/);
  assert.match(html, /totalDetected = 1/);
});

// ADR-016 (reordered 2026-07-17): the SCORE meter comes FIRST, then the WHY.
test('renderTerminal: the score meter appears before the tier analysis (score-first)', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.ok(html.indexOf('/100') < html.indexOf('Análisis de tier'), 'score-first ordering');
});

test('renderTerminal: shows the exact blocking criterion for the next tier', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Criterio exacto que te impide subir de tier/);
  assert.match(html, /T2/);
});

test('renderTerminal: at the max tier, shows the "meets every criterion" note instead of a blocking one', () => {
  const report = {
    ...BASE_REPORT,
    tools: [{ id: 'claude-code', detected: true, depth: { instructions: 1, mcpServers: 1, skills: 1, hooks: 1 } }],
    agentCounts: { agents: 2 },
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Cumples todos los criterios de la escalera/);
  assert.equal(html.includes('Criterio exacto que te impide subir de tier'), false);
});

test('renderTerminal: strips raw ANSI escape / C0 control chars from an agent-synthesis symbolicName', () => {
  const evilEsc = '\x1b[31mFAKE\x1b[0m';
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'orchestrator', tools: [], model: null, parent: null }],
    agentSynthesis: { agents: [{ name: 'orchestrator', symbolicName: `The Builder ${evilEsc}`, whatItDoes: 'x' }], edges: [] },
  };
  const raw = renderTerminal(report, MATURITY_NO_TIER, 'es'); // NOT stripped of ANSI — testing the raw output
  assert.equal(raw.includes(evilEsc), false, 'the raw injected escape sequence must never reach the terminal verbatim');
  assert.match(raw, /The Builder/);
});

test('renderTerminal: strips raw ANSI escape / C0 control chars from personalized roadmap prose', () => {
  const evilEsc = '\x1b[31mFAKE\x1b[0m';
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const report = {
    ...BASE_REPORT,
    roadmapPersonalization: {
      whatUnlocks: `Adapted unlock text ${evilEsc}`,
      steps: [
        { text: `Adapted step one ${evilEsc}`, estimate: '10 min' },
        { text: 'Adapted step two', estimate: '10 min' },
        { text: 'Adapted step three', estimate: '10 min' },
      ],
      tips: ['tip one', 'tip two'],
      mistakes: ['mistake one', 'mistake two', 'mistake three'],
    },
  };
  const raw = renderTerminal(report, maturity, 'es', ROADMAP); // raw, not ANSI-stripped
  assert.equal(raw.includes(evilEsc), false, 'the raw injected escape sequence from personalized prose must never reach the terminal verbatim');
  assert.match(raw, /Adapted unlock text/);
  assert.match(raw, /Adapted step one/);
});
