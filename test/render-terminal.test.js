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
