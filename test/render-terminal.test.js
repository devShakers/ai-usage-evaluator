'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTerminal } = require('../src/render-terminal');

/*
 * ADR-016 terminal redesign. The default footprint terminal view now:
 *   - leads with the WHY of the score (tier analysis), before the score meter;
 *   - has NO environment section;
 *   - shows ONE line per agent (name + model + compact score + usage), with ↓
 *     stacked per depth for nested subagents (no description sub-line);
 *   - hides the tier roadmap / next-steps unless `{ showRoadmap: true }` (the
 *     `--roadmap` flag) is passed.
 */

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

test('renderTerminal: technologies heading always present; empty state when none detected', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Tecnolog[íi]as del proyecto/);
  assert.match(html, /No se reconoci[óo] ningún framework/);
});

test('renderTerminal: recognized framework technologies are listed', () => {
  const report = { ...BASE_REPORT, technologies: ['React', 'NestJS'] };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /React/);
  assert.match(html, /NestJS/);
});

// ADR-016: the Environment ("Entorno") section is GONE from the terminal (it
// stays in the HTML report). It must never render here.
test('renderTerminal: no Environment section in the terminal (ADR-016)', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.equal(html.includes('Entorno'), false);
  assert.equal(html.includes('darwin'), false);
  assert.equal(html.includes('v22.0.0'), false);
});

test('renderTerminal: agents heading always present; empty state when no agents', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Agentes/);
  assert.match(html, /No se han detectado agentes/);
});

// ADR-016: one line per agent — name (+ symbolic name) + model + hierarchy. NO
// tools list, NO description sub-line (those stay in the HTML report).
test('renderTerminal: renders each agent name + model; no tools list, no "Reports to:" line', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'orchestrator', tools: ['Read', 'Task'], model: 'claude-opus-4', parent: null },
      { name: 'backend-dev', tools: ['Read', 'Write'], model: 'claude-sonnet-4', parent: 'orchestrator' },
    ],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /orchestrator/);
  assert.match(html, /backend-dev/);
  assert.match(html, /claude-opus-4/);
  assert.match(html, /claude-sonnet-4/);
  assert.equal(html.includes('Read, Task'), false);
  assert.equal(html.includes('Reporta a:'), false);
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
test('renderTerminal: shows the definition-quality score and local usage per agent (joined by name)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'scored', tools: [], model: 'opus', parent: null },
      { name: 'unscored', tools: [], model: 'haiku', parent: null },
    ],
    // Fewer evaluations than agents (backend drops what it couldn't score) —
    // matched by name, NOT index, so `unscored` renders with no number.
    agentEvaluation: { evaluations: [{ name: 'scored', score: 88, rationale: 'clear' }], promptVersion: 'agent-eval-v1' },
    agentUsage: { available: true, byAgent: { scored: 4, unscored: 0 } },
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /scored.*88\/100/); // scored agent shows its number
  assert.match(html, /usado 4×/);
  assert.match(html, /sin uso local/);
  // `unscored` line present but carries no "/100" score badge.
  assert.match(html, /unscored/);
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

test('renderTerminal: agent synthesis symbolic name is shown when present, real name kept as a badge', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'orchestrator', tools: ['Read'], model: 'opus', parent: null }],
    agentSynthesis: { agents: [{ name: 'orchestrator', symbolicName: 'El Jefe', whatItDoes: 'Coordina el trabajo.' }] },
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /El Jefe/);
  assert.match(html, /\(orchestrator\)/); // real structural name kept visible
  // ADR-016: the description phrase is NOT shown in the terminal anymore (HTML only).
  assert.equal(html.includes('Coordina el trabajo.'), false);
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
  assert.match(html, /footprint --roadmap/);
});

// ADR-016 (TASK B): --roadmap renders ONLY the roadmap section, NOT the rest of
// the report (no score meter / tools / technologies / agents), and no hint.
test('renderTerminal: { showRoadmap } renders ONLY the roadmap, not the full report', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const report = { ...BASE_REPORT, technologies: ['React'], agents: [{ name: 'a', tools: [], model: null, parent: null }] };
  const html = strip(renderTerminal(report, maturity, 'es', ROADMAP));
  assert.match(html, /Tu próximo nivel/); // roadmap present
  assert.equal(html.includes('/100'), false, 'no score meter');
  assert.equal(html.includes('Detectadas'), false, 'no detected-tools section');
  assert.equal(html.includes('Tecnologías del proyecto'), false, 'no technologies section');
  assert.equal(html.includes('Análisis de tier'), false, 'no tier-analysis section');
  assert.equal(html.includes('footprint --roadmap'), false, 'no self-referential hint in roadmap mode');
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
  assert.match(html, /footprint --build-next-level/);
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
  assert.equal(html.includes('footprint --build-next-level'), false);
});

test('renderTerminal: without maturity.tierKey (older shape, under --roadmap), falls back to the generic band next-step text', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es', ROADMAP));
  assert.match(html, /CLAUDE\.md|\.cursorrules|copilot-instructions\.md/);
});

test('renderTerminal: renders in English too (default headings + roadmap heading translated)', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const report = { ...BASE_REPORT, technologies: ['React'] };
  // Default mode carries the report section headings...
  const def = strip(renderTerminal(report, maturity, 'en'));
  assert.match(def, /Project technologies/);
  assert.match(def, /Agents/);
  // ...and the --roadmap mode carries the roadmap heading.
  const road = strip(renderTerminal(report, maturity, 'en', ROADMAP));
  assert.match(road, /Your next level/);
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
