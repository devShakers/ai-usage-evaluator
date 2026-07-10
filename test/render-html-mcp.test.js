'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');

/*
 * talents-ai-score: renders `report.mcp.servers` (name + category, issue
 * 015's mcp-detector) in the local HTML report. Names are LOCAL ONLY — this
 * only exercises rendering, never touches src/share.js's derivePayload
 * (which still sends only mcp.countsByCategory/total, never these names).
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
  mcp: { servers: [], countsByCategory: { data: 0, comms: 0, dev: 0, browser: 0, other: 0 }, total: 0 },
};

const MATURITY = { level: 2, key: 'integrated', name: 'Integrado', score: 40, emoji: '🧭', next: 'siguiente paso' };

test('renderHtml: no MCP servers -> the MCP section is entirely omitted, no heading rendered', () => {
  const html = renderHtml(BASE_REPORT, MATURITY, 'es');
  assert.doesNotMatch(html, /Servidores MCP/i);
  assert.doesNotMatch(html, /<ul class="mcp-list">/);
});

test('renderHtml: MCP servers present -> renders the heading, each server name and its category', () => {
  const report = {
    ...BASE_REPORT,
    mcp: {
      servers: [
        { name: 'postgres', category: 'data' },
        { name: 'playwright-mcp', category: 'browser' },
      ],
      countsByCategory: { data: 1, comms: 0, dev: 0, browser: 1, other: 0 },
      total: 2,
    },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /Servidores MCP/i);
  assert.match(html, /<ul class="mcp-list">/);
  assert.match(html, /postgres/);
  assert.match(html, /playwright-mcp/);
  assert.match(html, /Datos/); // category label, es
  assert.match(html, /Navegador/); // category label, es
});

test('renderHtml: MCP category labels are translated in English too', () => {
  const report = {
    ...BASE_REPORT,
    mcp: { servers: [{ name: 'slack', category: 'comms' }], countsByCategory: { comms: 1 }, total: 1 },
  };
  const html = renderHtml(report, MATURITY, 'en');
  assert.match(html, /Detected MCP servers/i);
  assert.match(html, /Communication/);
});

test('renderHtml: an unrecognized MCP category degrades to the raw category string, never throws', () => {
  const report = {
    ...BASE_REPORT,
    mcp: { servers: [{ name: 'mystery-server', category: 'quantum' }], countsByCategory: {}, total: 1 },
  };
  assert.doesNotThrow(() => renderHtml(report, MATURITY, 'es'));
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /quantum/);
});

test('renderHtml: missing report.mcp (older report) does not throw and omits the section', () => {
  const { mcp, ...reportWithoutMcp } = BASE_REPORT;
  assert.doesNotThrow(() => renderHtml(reportWithoutMcp, MATURITY, 'es'));
  const html = renderHtml(reportWithoutMcp, MATURITY, 'es');
  assert.doesNotMatch(html, /<ul class="mcp-list">/);
});

test('renderHtml: MCP server names never leak into the privacy note or persistence-related copy — informational only', () => {
  // Not a strict assertion of absence elsewhere (the raw JSON <details> block
  // legitimately mirrors the full local report) — just confirms the section
  // renders as a plain list, not as anything resembling a payload preview.
  const report = {
    ...BASE_REPORT,
    mcp: { servers: [{ name: 'github', category: 'dev' }], countsByCategory: { dev: 1 }, total: 1 },
  };
  const html = renderHtml(report, MATURITY, 'es');
  assert.match(html, /<span class="mcp-name">github<\/span>/);
  assert.match(html, /<span class="mcp-category">Desarrollo<\/span>/);
});
