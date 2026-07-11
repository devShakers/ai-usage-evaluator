'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score: deterministic "why this tier" analysis section in the
 * HTML report. Content itself is unit-tested in test/tier-analysis.test.js
 * — this only exercises that renderHtml wires it in correctly.
 */

const BASE_REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-11T00:00:00.000Z',
  anonId: 'anon123',
  platform: 'darwin',
  environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v20.0.0', editorsInstalled: [] },
  summary: { totalDetected: 0, categories: [] },
  tools: [],
  agents: [],
  agentCounts: { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  technologies: [],
};

const MATURITY = { level: 2, key: 'integrated', name: 'Integrado', score: 40, emoji: '🧭', next: 'siguiente paso' };

test('renderHtml: tier analysis section always present, with the analytical heading', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /An[aá]lisis de tier/i);
  assert.match(html, /class="card tier-analysis-card"/);
});

test('renderHtml: lists met criteria with their backing signal values', () => {
  const report = {
    ...BASE_REPORT,
    tools: [{ id: 'claude-code', detected: true, depth: { instructions: 1 } }],
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /totalDetected = 1/);
  assert.match(html, /context = 1/);
});

test('renderHtml: shows the exact blocking criterion when not at the max tier', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /Criterio exacto que te impide subir de tier/);
  assert.match(html, /T1/);
});

test('renderHtml: at the max tier, shows the "meets every criterion" note instead of a blocking one', () => {
  const report = {
    ...BASE_REPORT,
    tools: [{ id: 'claude-code', detected: true, depth: { instructions: 1, mcpServers: 1, skills: 1, hooks: 1 } }],
    agentCounts: { agents: 2, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /Cumples todos los criterios de la escalera/);
  assert.equal(html.includes('<div class="tier-analysis-blocking-label">'), false);
});

test('renderHtml: renders in English too', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'en');
  assert.match(html, /Tier analysis: why this level/);
  assert.match(html, /Exact criterion blocking your next tier/);
});
