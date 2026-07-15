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

// talents-ai-score, i18n audit: English roadmap content is now fully
// authored (src/roadmap-content.js's TIER_JUMPS_EN) — the old "pending
// translation, showing in Spanish" fallback is retired. English render
// shows genuine English prose, never a translation notice, never Spanish.
test('renderHtml: English render shows real English roadmap prose, no pending-translation notice, no Spanish text', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'en');
  const section = roadmapSectionOf(html);
  assert.equal(/pending translation/i.test(section), false);
  assert.equal(section.includes('roadmap-unavailable'), false);
  assert.match(section, /First tool/); // English tier title (T1 → T2 · First tool → ...)
  assert.equal(/[áéíóúñ¿¡]/i.test(section.replace(/<pre[\s\S]*?<\/pre>/g, '')), false); // excluding literal code snippets
});

test('renderHtml: works in Spanish exactly as before, no unavailable/translation notices', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'es');
  const section = roadmapSectionOf(html);
  assert.equal(/pending translation/i.test(section), false);
  assert.equal(section.includes('roadmap-unavailable'), false);
  assert.match(section, /Primera herramienta/);
});

// --- implementation prompt (talents-ai-score, "next steps -> prompt") -------

test('renderHtml: a jump entry (not max tier) renders the copyable implementation prompt block', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /Prompt para implementar/);
  assert.match(section, /<pre class="roadmap-prompt-code" id="implementation-prompt-code">/);
  assert.match(section, /Ayúdame a implementar/);
});

test('renderHtml: the prompt block includes a Copy button wired to the prompt code element via data-copy-target', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /<button type="button" class="roadmap-prompt-copy" data-copy-target="implementation-prompt-code" data-copied-label="Copiado ✓">Copiar<\/button>/);
});

test('renderHtml (en): the Copy button label follows the report locale', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'en');
  const section = roadmapSectionOf(html);
  assert.match(section, /data-copied-label="Copied ✓">Copy<\/button>/);
});

test('renderHtml (ADR-008): T7 (max tier) DOES render a consolidation implementation prompt (the top is never a dead end)', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T7'), 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /<pre class="roadmap-prompt-code" id="implementation-prompt-code">/);
  assert.match(section, /Prompt para implementar/);
  // It's a consolidation prompt (refine what you have), not a level-up one.
  assert.match(section, /consolidar|afinar|tier máximo/i);
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

// --- copy-to-clipboard script (talents-ai-score) ----------------------------
// Zero-network invariant check: the copy button's own JS lives in the
// existing inline <script> at the bottom of the document (no CDN, no
// fetch/XHR) and reads the prompt text back from the DOM element's own
// textContent rather than re-embedding it as a second JS string — so
// there's never an escaping mismatch between what's shown and what gets
// copied.

test('renderHtml: the copy-to-clipboard script is present, inline, and reads from data-copy-target (zero-network)', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T1'), 'es');
  assert.match(html, /navigator\.clipboard/);
  assert.match(html, /document\.execCommand\('copy'\)/);
  assert.match(html, /data-copy-target/);
  assert.match(html, /target\.textContent/);
  // No new network surface introduced: still no external <script src="...">.
  assert.equal(/<script[^>]+src=/.test(html), false);
});

test('renderHtml (ADR-008): T7 (max tier) now renders the copy button too (consolidation prompt is copyable)', () => {
  const html = renderHtml(BASE_REPORT, maturityAt('T7'), 'es');
  const section = roadmapSectionOf(html);
  assert.ok(section.includes('roadmap-prompt-copy'), 'T7 consolidation prompt has a copy button');
  assert.ok(section.includes('data-copy-target'), 'copy button wired to the prompt element');
});
