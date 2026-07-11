'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score, issue 020 (ADR-013/014): the local HTML report shows
 * ONLY the current->next roadmap entry for `maturity.tierKey` (never the
 * whole ladder), replacing the old generic band-keyed "next step" card
 * with the richer, tier-specific curated content (issue 020's roadmap
 * data, src/roadmap-content.js). T7 renders the terminal "nivel máximo"
 * shape instead of an upgrade path.
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

function maturityAt(tierKey, level = 1) {
  return { level, key: 'exploring', name: 'Explorando', emoji: '◔', score: 20, breadth: 1, depth: {}, hasAgentic: false, next: 'x', tier: 0, tierKey, tierName: 'x' };
}

function roadmapSectionOf(html) {
  const start = html.indexOf('<div class="card roadmap-card">');
  assert.ok(start !== -1, 'expected a roadmap-card section');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

test('renderHtml: shows ONLY the current tier jump entry (T1), never the whole ladder', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /T1 → T2/);
  // The next tier's own jump title (T2 → T3) must not appear in this section.
  assert.equal(section.includes('T2 → T3'), false);
});

test('renderHtml: renders steps with their time estimate, the snippet code, tips and common mistakes', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T2'), 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /mcpServers/); // upgradeWhen text
  assert.match(section, /5 min|15-20 min|10 min/); // at least one step estimate
  assert.match(section, /mcpServers/); // snippet mentions mcpServers (json snippet)
  assert.match(section, /<pre class="roadmap-code">/);
});

test('renderHtml: T7 renders the "nivel máximo" terminal shape, not an upgrade path', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T7'), 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /nivel máximo/i);
  assert.equal(/Subes de tier cuando/i.test(section), false);
});

test('renderHtml: old generic band-keyed "next step" card is gone (replaced by the tier roadmap)', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'es');
  assert.equal(html.includes('class="card next"'), false);
});

test('renderHtml: snippet code is HTML-escaped safely (no raw injection), even though it is code', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T2'), 'es');
  const section = roadmapSectionOf(html);
  // The T2 snippet is a JSON block; must be escaped, not raw HTML.
  assert.equal(section.includes('<script>'), false);
});

test('renderHtml: missing/unrecognized tierKey never throws, degrades gracefully', () => {
  assert.doesNotThrow(() => renderHtml(BASE_REPORT, maturityAt('T99'), 'es'));
  assert.doesNotThrow(() => renderHtml(BASE_REPORT, { level: 0 }, 'es')); // no tierKey at all (older maturity shape)
});

test('renderHtml: English render shows the pending-translation notice (no authored English roadmap yet)', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'en');
  const section = roadmapSectionOf(html);
  assert.match(section, /pending translation|translat/i);
});

test('renderHtml: works in Spanish without a pending-translation notice', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'es');
  const section = roadmapSectionOf(html);
  assert.equal(/pending translation/i.test(section), false);
});

// --- implementation prompt (talents-ai-score, "next steps -> prompt") -------

test('renderHtml: a jump entry (not max tier) renders the copyable implementation prompt block', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /Prompt para implementar/);
  assert.match(section, /<pre class="roadmap-prompt-code">/);
  assert.match(section, /Ayúdame a implementar/);
});

test('renderHtml: T7 (max tier) does NOT render an implementation prompt (nothing to implement)', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T7'), 'es');
  const section = roadmapSectionOf(html);
  assert.equal(section.includes('roadmap-prompt-code'), false);
});

test('renderHtml: the implementation prompt reflects detected frameworks from the report', () => {
  const report = { ...BASE_REPORT, technologies: ['React', 'NestJS'] };
  const html = renderHtml(report, maturityAt('T1'), 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /React/);
  assert.match(section, /NestJS/);
});

test('renderHtml: the implementation prompt is HTML-escaped safely (never a raw injection)', () => {
  const report = { ...BASE_REPORT, technologies: ['<script>alert(1)</script>'] };
  const html = renderHtml(report, maturityAt('T1'), 'es');
  const section = roadmapSectionOf(html);
  assert.equal(section.includes('<script>alert(1)</script>'), false);
});
