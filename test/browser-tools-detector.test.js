'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectBrowserTools } = require('../src/browser-tools-detector');

/*
 * talents-ai-score, issue 018 (ADR-013/014): browser tools detector. Pure
 * composition over TWO already-computed detectors — no new file scanning:
 *   - Playwright/Puppeteer via dependency manifest names (issue's
 *     tech-detector, ADR-012's `report.technologies`).
 *   - Browser-category MCP servers by name (issue 015's mcp-detector,
 *     `report.mcp`).
 * Never re-reads any file; only re-derives a signal from data already
 * whitelisted by those two detectors.
 */

test('detectBrowserTools: neither dependency nor MCP browser signal -> not detected', () => {
  const result = detectBrowserTools([], { servers: [], countsByCategory: { browser: 0 }, total: 0 });
  assert.equal(result.detected, false);
  assert.equal(result.count, 0);
  assert.deepEqual(result.via.dependencies, []);
  assert.deepEqual(result.via.mcp, []);
});

test('detectBrowserTools: Playwright dependency -> detected via dependencies', () => {
  const result = detectBrowserTools(['playwright', 'react'], { servers: [], countsByCategory: { browser: 0 }, total: 0 });
  assert.equal(result.detected, true);
  assert.deepEqual(result.via.dependencies, ['playwright']);
  assert.equal(result.count, 1);
});

test('detectBrowserTools: Puppeteer dependency -> detected via dependencies', () => {
  const result = detectBrowserTools(['puppeteer'], { servers: [], countsByCategory: { browser: 0 }, total: 0 });
  assert.equal(result.detected, true);
  assert.deepEqual(result.via.dependencies, ['puppeteer']);
});

test('detectBrowserTools: browser-category MCP server -> detected via mcp', () => {
  const mcp = {
    servers: [{ name: 'playwright-mcp', category: 'browser' }, { name: 'postgres', category: 'data' }],
    countsByCategory: { browser: 1, data: 1 },
    total: 2,
  };
  const result = detectBrowserTools([], mcp);
  assert.equal(result.detected, true);
  assert.deepEqual(result.via.mcp, ['playwright-mcp']);
  assert.equal(result.count, 1);
});

test('detectBrowserTools: both dependency AND MCP present -> counts both, combined count', () => {
  const mcp = { servers: [{ name: 'browserbase', category: 'browser' }], countsByCategory: { browser: 1 }, total: 1 };
  const result = detectBrowserTools(['playwright'], mcp);
  assert.equal(result.detected, true);
  assert.equal(result.count, 2);
  assert.deepEqual(result.via.dependencies, ['playwright']);
  assert.deepEqual(result.via.mcp, ['browserbase']);
});

test('detectBrowserTools: never throws on missing/malformed inputs', () => {
  assert.doesNotThrow(() => detectBrowserTools(undefined, undefined));
  assert.doesNotThrow(() => detectBrowserTools(null, null));
  const result = detectBrowserTools(undefined, undefined);
  assert.equal(result.detected, false);
});

test('detectBrowserTools: unrelated technologies/MCP servers are ignored', () => {
  const mcp = { servers: [{ name: 'postgres', category: 'data' }], countsByCategory: { data: 1 }, total: 1 };
  const result = detectBrowserTools(['react', 'express'], mcp);
  assert.equal(result.detected, false);
  assert.equal(result.count, 0);
});
