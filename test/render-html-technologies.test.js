'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score, ADR-012: the local HTML report always shows detected
 * project technologies (dependency manifest names), regardless of consent.
 */

const BASE_REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-10T00:00:00.000Z',
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

test('renderHtml: technologies empty -> renders the empty state, never throws', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /Tecnolog[íi]as del proyecto/i);
});

test('renderHtml: renders each detected technology as a chip', () => {
  const report = { ...BASE_REPORT, technologies: ['react', 'typescript', 'express'] };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /react/);
  assert.match(html, /typescript/);
  assert.match(html, /express/);
});

test('renderHtml: missing report.technologies (older report) does not throw', () => {
  const { technologies, ...reportWithoutTech } = BASE_REPORT;
  assert.doesNotThrow(() => renderHtml(reportWithoutTech, MATURITY, 'es'));
});
