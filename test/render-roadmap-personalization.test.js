'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');
const { renderTerminal } = require('../src/render-terminal');
const { getRoadmapEntry } = require('../src/roadmap-content');

/*
 * talents-ai-score, ADR-015: rendering the personalized roadmap (or
 * falling back to curated verbatim) in both the HTML and terminal
 * reports. `report.roadmapPersonalization` is set by bin/report.js only
 * AFTER an already-validated network call (see
 * test/roadmap-personalization.test.js for the client-side validation
 * itself) — these tests only exercise the render layer's merge/guardrails:
 * the criterion ("Sube de tier cuando"), tier/title and the copyable
 * snippet must ALWAYS come from the curated content, regardless of
 * personalization.
 */

function strip(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

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

const MATURITY_T1 = {
  level: 1, key: 'exploring', name: 'Explorando', emoji: '◔', score: 20,
  breadth: 1, depth: {}, hasAgentic: false, next: 'x', tier: 0, tierKey: 'T1', tierName: 'x',
};

const CURATED_T1 = getRoadmapEntry('T1', 'es');

function personalizedFor(curated, marker) {
  return {
    whatUnlocks: `${marker} unlocks text.`,
    steps: curated.steps.map((s) => ({ text: `${marker}: ${s.text}`, estimate: s.estimate })),
    tips: curated.tips.map((tip) => `${marker}: ${tip}`),
    mistakes: curated.commonMistakes.map((m) => `${marker}: ${m}`),
  };
}

function roadmapSectionOf(html) {
  const start = html.indexOf('<div class="card roadmap-card">');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

// --- HTML --------------------------------------------------------------

test('renderHtml: with a validated personalization, the 4 prose gaps show the PERSONALIZED text', () => {
  const report = { ...BASE_REPORT, roadmapPersonalization: personalizedFor(CURATED_T1, 'ADAPTED') };
  const html = renderHtml(report, MATURITY_T1, 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /ADAPTED unlocks text\./);
  assert.match(section, /ADAPTED: /);
});

test('renderHtml: even when personalized, the criterion ("Sube de tier cuando"), tier title and the snippet stay CURATED verbatim', () => {
  const report = { ...BASE_REPORT, roadmapPersonalization: personalizedFor(CURATED_T1, 'ADAPTED') };
  const html = renderHtml(report, MATURITY_T1, 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, new RegExp(CURATED_T1.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(section, /Subes de tier cuando/);
  assert.match(section, /es decir ≥1 fichero de contexto persistente/); // curated upgradeWhen text, untouched
  assert.match(section, /Nombre del proyecto/); // curated snippet code, untouched
});

test('renderHtml: with personalization, shows the "adapted to your project" notice', () => {
  const report = { ...BASE_REPORT, roadmapPersonalization: personalizedFor(CURATED_T1, 'ADAPTED') };
  const html = renderHtml(report, MATURITY_T1, 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /Contenido adaptado a tu proyecto/);
});

test('renderHtml: WITHOUT report.roadmapPersonalization (no endpoint / fallback already resolved to null), renders curated verbatim, no notice', () => {
  const html = renderHtml(BASE_REPORT, MATURITY_T1, 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, new RegExp(CURATED_T1.unlocks.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(section.includes('Contenido adaptado a tu proyecto'), false);
});

test('renderHtml: at T7 (max tier), personalization is never applied even if report.roadmapPersonalization is somehow set', () => {
  const report = { ...BASE_REPORT, roadmapPersonalization: { whatUnlocks: 'x', steps: [], tips: [], mistakes: [] } };
  const maturityT7 = { ...MATURITY_T1, tierKey: 'T7' };
  const html = renderHtml(report, maturityT7, 'es');
  const section = roadmapSectionOf(html);
  assert.match(section, /nivel máximo/i);
  assert.equal(section.includes('Contenido adaptado a tu proyecto'), false);
});

// --- Terminal ------------------------------------------------------------

test('renderTerminal: with a validated personalization, shows the personalized unlocks text and the notice', () => {
  const report = { ...BASE_REPORT, roadmapPersonalization: personalizedFor(CURATED_T1, 'ADAPTED') };
  const out = strip(renderTerminal(report, MATURITY_T1, 'es'));
  assert.match(out, /ADAPTED unlocks text\./);
  assert.match(out, /Contenido adaptado a tu proyecto/);
});

test('renderTerminal: even when personalized, the criterion and title stay curated', () => {
  const report = { ...BASE_REPORT, roadmapPersonalization: personalizedFor(CURATED_T1, 'ADAPTED') };
  const out = strip(renderTerminal(report, MATURITY_T1, 'es'));
  assert.match(out, /Subes de tier cuando/);
  assert.match(out, new RegExp(CURATED_T1.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('renderTerminal: without personalization, renders curated verbatim, no notice', () => {
  const out = strip(renderTerminal(BASE_REPORT, MATURITY_T1, 'es'));
  assert.match(out, new RegExp(CURATED_T1.unlocks.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(out.includes('Contenido adaptado a tu proyecto'), false);
});

test('renderTerminal: never throws with a malformed roadmapPersonalization object', () => {
  const report = { ...BASE_REPORT, roadmapPersonalization: { whatUnlocks: 123, steps: 'not-an-array' } };
  assert.doesNotThrow(() => renderTerminal(report, MATURITY_T1, 'es'));
});
