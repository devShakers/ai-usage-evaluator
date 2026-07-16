'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');
const { renderTerminal } = require('../src/render-terminal');

/*
 * talents-ai-score: undetected tools add visual noise without signal — the
 * report should list only DETECTED/used tools. An undetected tool that's
 * still relevant is already covered by the tier roadmap's next-step
 * guidance, so it's never silently dropped, just not repeated here as a
 * name in a long "not detected" list.
 */

function strip(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Scopes assertions to the tools list itself: roadmap-content.js's authored
// prose legitimately mentions tool names like "Cursor"/"Copilot" as
// suggestions elsewhere in the report, so a whole-document substring check
// would collide with that unrelated content.
function toolsSectionOf(html) {
  const start = html.search(/<ul class="tools">|<div class="card tool-empty">/);
  assert.ok(start !== -1, 'expected a tools list or its empty state');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

const BASE_REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-11T00:00:00.000Z',
  anonId: 'anon123',
  platform: 'darwin',
  environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v20.0.0', editorsInstalled: [] },
  summary: { totalDetected: 1, categories: [] },
  tools: [
    {
      id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', category: 'Agentic CLI',
      detected: true, signalTypes: ['bin'], signalCount: 1, depth: {},
      footprint: null, recency: { bucket: null }, version: null,
    },
    {
      id: 'github-copilot', name: 'GitHub Copilot', vendor: 'GitHub', category: 'Autocomplete',
      detected: false, signalTypes: [], signalCount: 0, depth: {},
      footprint: null, recency: { bucket: null }, version: null,
    },
    {
      id: 'cursor', name: 'Cursor', vendor: 'Anysphere', category: 'AI editor',
      detected: false, signalTypes: [], signalCount: 0, depth: {},
      footprint: null, recency: { bucket: null }, version: null,
    },
  ],
  agents: [],
  agentCounts: { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  technologies: [],
};

const MATURITY = { level: 1, key: 'exploring', name: 'Exploring', score: 20, emoji: 'x', next: 'x' };

test('renderHtml: only detected tools are listed, undetected ones are hidden entirely', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  const section = toolsSectionOf(html);
  assert.match(section, /Claude Code/);
  assert.equal(section.includes('GitHub Copilot'), false);
  assert.equal(section.includes('Cursor'), false);
});

test('renderHtml: no "not detected" list/text rendered in the tools section', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  const section = toolsSectionOf(html);
  assert.equal(/no detectad/i.test(section), false);
});

test('renderHtml: when NOTHING is detected, shows an empty state instead of an empty list', () => {
  const report = { ...BASE_REPORT, tools: BASE_REPORT.tools.map((t) => ({ ...t, detected: false })) };
  const html = renderHtml(report, MATURITY, 'es');
  assert.equal(html.includes('<ul class="tools">'), false);
  assert.match(html, /No se ha detectado ninguna herramienta de IA/);
});

test('renderHtml: never throws with an all-undetected tool list', () => {
  const report = { ...BASE_REPORT, tools: BASE_REPORT.tools.map((t) => ({ ...t, detected: false })) };
  assert.doesNotThrow(() => renderHtml(report, MATURITY, 'es'));
});

test('renderTerminal: only detected tools are listed, no "Not detected: ..." line', () => {
  const out = strip(renderTerminal(BASE_REPORT, MATURITY, 'es'));
  const start = out.indexOf('Detectadas');
  // Terminal-condense: the Environment block was removed from the terminal,
  // so the section that follows Detected is now Technologies.
  const end = out.indexOf('Tecnolog', start);
  const section = out.slice(start, end);
  assert.match(section, /Claude Code/);
  assert.equal(section.includes('GitHub Copilot'), false);
  assert.equal(section.includes('Cursor'), false);
  assert.equal(/no detectad/i.test(section), false);
});
