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

test('renderTerminal: renders each agent, its tools, model, and hierarchy (visual nesting, not "Reports to:")', () => {
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
  assert.match(html, /Read, Task/);
  // hierarchy shown as visual nesting (indentation/connector), never the
  // retired "Reports to:" text line.
  assert.equal(html.includes('Reporta a:'), false);
});

test('renderTerminal: agent synthesis symbolic name + phrase are shown when present, real name kept as a badge', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'orchestrator', tools: ['Read'], model: 'opus', parent: null }],
    agentSynthesis: { agents: [{ name: 'orchestrator', symbolicName: 'El Jefe', whatItDoes: 'Coordina el trabajo.' }] },
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /El Jefe/);
  assert.match(html, /\(orchestrator\)/); // real structural name kept visible
  assert.match(html, /Coordina el trabajo\./);
});

// talents-ai-score: description is ALWAYS present now (real-browser user
// feedback rejected "no phrase at all" too — see render-html.js's
// buildAgentCardTree header for the full history of approaches tried).
// Without synthesis, priority is: raw frontmatter description, then a
// minimal name-derived last resort — never the old repetitive filler
// sentence, and never a blank card.
test('renderTerminal: agents without synthesis but WITH raw descriptions show those descriptions, not identical filler text', () => {
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
  assert.match(html, /Scans a module directory for DDD pattern violations\./);
  assert.match(html, /Revisor experto de Merge Requests\./);
  assert.match(html, /Creates comprehensive unit tests\./);
  assert.equal(html.includes('sin descripción sintetizada'), false);
  assert.equal(html.includes('Sin descripción disponible'), false);
});

// talents-ai-score: raw description cleanup + truncation (shared
// buildAgentCardTree, exercised in full in test/render-html-agent-
// cards.test.js) must apply in the terminal report too — a raw
// description with YAML escape artifacts and a long multi-sentence
// system-prompt body must render as a clean, short excerpt here as well.
test('renderTerminal: a raw description with YAML escape artifacts and a long multi-sentence body is cleaned AND cut down to only its first sentence', () => {
  const longDescription =
    'Revisor experto de Merge Requests del repo shakers-hub-backend.\\n\\n'
    + 'Ejemplos:\\n- User: "Revisa la MR !1234"\\n  Assistant: "Lanzo hub-mr-reviewer..."';
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'hub-mr-reviewer', tools: [], model: 'opus', parent: null }],
    agentDescriptions: [{ name: 'hub-mr-reviewer', description: longDescription }],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Revisor experto de Merge Requests del repo shakers-hub-backend\./);
  assert.equal(html.includes('\\n'), false);
  assert.equal(html.includes('Ejemplos'), false);
  assert.equal(html.includes('Assistant'), false);
});

test('renderTerminal: an agent with neither synthesis nor a declared description gets the minimal name-derived last-resort line, never blank', () => {
  const report = {
    ...BASE_REPORT,
    agents: [{ name: 'bare-agent', tools: [], model: null, parent: null }],
  };
  const html = strip(renderTerminal(report, MATURITY_NO_TIER, 'es'));
  assert.match(html, /Bare agent/i);
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
  assert.match(html, /ai-footprint --build-next-level/);
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

test('renderTerminal: T7 (max tier) does NOT show an implementation prompt', () => {
  const maturity = { level: 4, key: 'orchestrator', name: 'Orquestador', score: 100, emoji: 'x', next: 'x', tier: 7, tierKey: 'T7' };
  const html = strip(renderTerminal(BASE_REPORT, maturity, 'es'));
  assert.equal(html.includes('Prompt para implementar'), false);
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
  assert.equal(html.includes('ai-footprint --build-next-level'), false);
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

test('renderTerminal: tier analysis section always present, lists met criteria with signal values', () => {
  const html = strip(renderTerminal(BASE_REPORT, MATURITY_NO_TIER, 'es'));
  assert.match(html, /An[aá]lisis de tier/);
  assert.match(html, /totalDetected = 1/);
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
