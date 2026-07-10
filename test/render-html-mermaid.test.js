'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score, ADR-010/ADR-011: the local HTML report renders the
 * synthesized agent diagram with Mermaid (mermaid.js vendored INLINE, zero
 * network calls at render time) when the ephemeral synthesis call
 * succeeded this run (`report.agentSynthesis`); falls back to a short note
 * (the deterministic org chart, ADR-009, is already its own section) when
 * it didn't. Also covers the new `report.technologies` section (ADR-012).
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

// --- technologies section (ADR-012) -----------------------------------------

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

// --- agent diagram (ADR-010/ADR-011): Mermaid when synthesis succeeded -----

test('renderHtml: no agentSynthesis attached -> renders the fallback note, does NOT inline the (multi-MB) mermaid.js vendor script', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.match(html, /Diagrama de agentes/i);
  assert.match(html, /Síntesis no disponible/i);
  // Keep the fallback path light: the ~3.2MB vendored library should only
  // be inlined when a diagram actually needs to be rendered.
  assert.ok(html.length < 200_000, `expected a lightweight fallback report, got ${html.length} bytes`);
});

test('renderHtml: agentSynthesis present -> renders Mermaid diagram source + inlines the vendored mermaid.js (zero-network)', () => {
  const report = {
    ...BASE_REPORT,
    agentSynthesis: {
      agents: [
        { name: 'orchestrator', symbolicName: 'The Conductor', whatItDoes: 'Coordinates every agent' },
        { name: 'backend-developer', symbolicName: 'The Builder', whatItDoes: 'Writes backend code' },
      ],
      edges: [{ from: 'orchestrator', to: 'backend-developer' }],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /flowchart TD/);
  assert.match(html, /The Conductor/);
  assert.match(html, /The Builder/);
  assert.match(html, /-->/);
  assert.match(html, /class="mermaid"/);
  // The vendored library is inlined verbatim (large, but zero-network).
  assert.ok(html.length > 1_000_000, `expected the vendored mermaid.js to be inlined, got only ${html.length} bytes`);
  assert.match(html, /mermaid\.initialize/);
});

test('renderHtml: diagram source escapes agent-provided text safely (no raw HTML injection)', () => {
  const report = {
    ...BASE_REPORT,
    agentSynthesis: {
      agents: [{ name: 'weird', symbolicName: '<script>alert(1)</script>', whatItDoes: 'x' }],
      edges: [],
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.equal(html.includes('<script>alert(1)</script>'), false);
});

test('renderHtml: works in English too', () => {
  const report = {
    ...BASE_REPORT,
    technologies: ['django'],
    agentSynthesis: { agents: [{ name: 'a', symbolicName: 'A', whatItDoes: 'does a' }], edges: [] },
  };
  const html = renderHtml(report, MATURITY, 'en');
  assert.match(html, /Project technologies/i);
  assert.match(html, /Agent diagram/i);
  assert.match(html, /django/);
});
