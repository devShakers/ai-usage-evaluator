'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTerminal } = require('../src/render-terminal');

/*
 * talents-ai-score: terminal parity with the HTML report — technologies,
 * agents and the tier roadmap (current -> next only) must appear in the
 * plain-text renderer too, not just render-html.js. No test file existed
 * for render-terminal.js before this — first coverage for this module.
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

test('renderTerminal: agents heading always present; empty state when no agents', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Agentes/);
  assert.match(html, /No se han detectado agentes/);
});

// Terminal-condense (CPO feedback): the terminal agents view keeps only the
// STRUCTURE — name (+ symbolic name), model, and hierarchy nesting. The
// per-agent tools list and the description prose were dropped from the terminal
// (they stay in the HTML report; see test/render-html-agent-cards.test.js).
test('renderTerminal: renders each agent name, its model, and hierarchy (visual nesting, not "Reports to:"); tools list is HTML-only now', () => {
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
  // tools list no longer rendered in the condensed terminal
  assert.equal(html.includes('Read, Task'), false);
  // hierarchy shown as visual nesting (indentation/connector), never the
  // retired "Reports to:" text line.
  assert.equal(html.includes('Reporta a:'), false);
});

test('renderTerminal: agent synthesis symbolic name is shown when present, real name kept as a badge; the phrase is HTML-only', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'orchestrator', tools: ['Read'], model: 'opus', parent: null }],
    agentSynthesis: { agents: [{ name: 'orchestrator', symbolicName: 'El Jefe', whatItDoes: 'Coordina el trabajo.' }] },
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /El Jefe/);
  assert.match(html, /\(orchestrator\)/); // real structural name kept visible
  // the synthesized description phrase is no longer rendered in the terminal
  assert.equal(html.includes('Coordina el trabajo.'), false);
});

// Terminal-condense: agent descriptions (synthesized or raw) are no longer
// rendered in the terminal — names + model + hierarchy only. The descriptions
// still render in the HTML report.
test('renderTerminal: agent names + model render; their descriptions do NOT appear in the terminal', () => {
  const report = {
    ...BASE_REPORT,
    agents: [
      { name: 'ddd-enforcer', tools: [], model: 'opus', parent: null },
      { name: 'hub-mr-reviewer', tools: [], model: 'opus', parent: null },
      { name: 'test-writer', tools: [], model: 'sonnet', parent: null },
    ],
    agentDescriptions: [
      { name: 'ddd-enforcer', description: 'Scans a module directory for DDD pattern violations.' },
      { name: 'hub-mr-reviewer', description: 'Revisor experto de Merge Requests.' },
      { name: 'test-writer', description: 'Creates comprehensive unit tests.' },
    ],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /ddd-enforcer/);
  assert.match(html, /hub-mr-reviewer/);
  assert.match(html, /test-writer/);
  assert.equal(html.includes('Scans a module directory for DDD pattern violations.'), false);
  assert.equal(html.includes('Revisor experto de Merge Requests.'), false);
  assert.equal(html.includes('Creates comprehensive unit tests.'), false);
});

test('renderTerminal: an agent with neither synthesis nor a declared description still shows its name (no blank, no description block)', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'bare-agent', tools: [], model: null, parent: null }],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /bare-agent/);
});

test('renderTerminal: with maturity.tierKey, shows the tier roadmap (current -> next) instead of the generic band next-step', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'generic band text', tier: 5, tierKey: 'T5' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es'));
  assert.match(html, /Tu próximo nivel/);
  assert.equal(html.includes('generic band text'), false);
});

test('renderTerminal: --build-next-level is announced when there is a next tier to build', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es'));
  assert.match(html, /footprint --build-next-level/);
  // Now framed as a SECONDARY alternative — the prompt below is primary.
  assert.match(html, /Alternativamente/);
});

// --- implementation prompt (talents-ai-score, "next steps -> prompt") -------

test('renderTerminal: a jump entry (not max tier) shows the copyable implementation prompt in a clearly delimited block', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es'));
  assert.match(html, /Prompt para implementar/);
  assert.match(html, /Ayúdame a implementar/);
});

test('renderTerminal (ADR-008): T7 (max tier) DOES show a consolidation implementation prompt (the top is never a dead end)', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orquestador', score: 100, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es'));
  assert.match(html, /Prompt para implementar/);
  // It's a consolidation prompt, not a "build the next level" one.
  assert.match(html, /consolidar|afinar|tier máximo/i);
});

test('renderTerminal (ADR-008): T7 (max tier) is NOT a dead end — it lists the curated improvement steps', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orquestador', score: 90, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es'));
  // The consolidation/improvement label + at least one authored step must show.
  assert.match(html, /Pasos de consolidación/);
  const { T7_TERMINAL_ES } = require('../src/roadmap-content');
  assert.ok(html.includes(T7_TERMINAL_ES.consolidationSteps[0]));
});

test('renderTerminal (ADR-008): T7 improvement steps render in English too', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orchestrator', score: 90, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'en'));
  assert.match(html, /Consolidation steps/);
  const { T7_TERMINAL_EN } = require('../src/roadmap-content');
  assert.ok(html.includes(T7_TERMINAL_EN.consolidationSteps[0]));
});

test('renderTerminal: the implementation prompt reflects detected frameworks from the report', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const report = { ...BASE_REPORT, technologies: ['React', 'NestJS'] };
  const html = strip(renderTerminal(report, maturity, 'es'));
  assert.match(html, /React/);
  assert.match(html, /NestJS/);
});

test('renderTerminal: at the max tier (T7), does NOT announce --build-next-level (nothing left to build)', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orquestador', score: 100, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es'));
  assert.equal(html.includes('footprint --build-next-level'), false);
});

test('renderTerminal: without maturity.tierKey (older report shape), falls back to the generic band next-step text — a next step is never silently dropped', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  // MATURITY_NO_TIER.level = 1 -> the 'es' catalog's nextSteps[1] text
  assert.match(html, /CLAUDE\.md|\.cursorrules|copilot-instructions\.md/);
});

test('renderTerminal: renders in English too (technologies/agents/roadmap headings translated)', () => {
  const maturity = { level: 3, key: 'power', name: 'Power user', score: 70, emoji: 'x', next: 'x', tier: 5, tierKey: 'T5' };
  const report = { ...BASE_REPORT, technologies: ['React'] };
  const html = strip(renderTerminal(report, maturity, 'en'));
  assert.match(html, /Project technologies/);
  assert.match(html, /Agents/);
  assert.match(html, /Your next level/);
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

// --- tier analysis: why this tier (parity with render-html.js) -------------

// Terminal-condense (CPO feedback): the tier-analysis section keeps only the
// heading + the blocking criterion (below). The full met-criteria checklist
// with its signal values (e.g. "totalDetected = 1") is now HTML-only.
test('renderTerminal: tier analysis section always present; the met-criteria checklist is HTML-only now', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /An[aá]lisis de tier/);
  assert.equal(html.includes('totalDetected = 1'), false);
});

test('renderTerminal: shows the exact blocking criterion for the next tier', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Criterio exacto que te impide subir de tier/);
  assert.match(html, /T2/); // BASE_REPORT has one detected tool, no context yet -> blocked at T2
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
