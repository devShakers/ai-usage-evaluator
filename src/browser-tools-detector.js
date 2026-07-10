'use strict';

/*
 * Deterministic (no-LLM) browser tools detector (talents-ai-score, issue
 * 018 / ADR-013-014). Pure composition — does NOT scan any file itself,
 * only re-derives a signal from two already-computed, already-whitelisted
 * detectors:
 *   - Playwright/Puppeteer as a PROJECT DEPENDENCY (tech-detector's raw
 *     dependency names, ADR-012 — package/module names only). NOT the
 *     canonical `report.technologies` list: Playwright/Puppeteer aren't
 *     "frameworks/libraries" in the tech-stack sense, so they're
 *     deliberately absent from that human-facing list, but this detector
 *     still needs to see them as dependencies.
 *   - A browser-category MCP server BY NAME (`report.mcp`, issue 015's
 *     mcp-detector — server names + heuristic category only).
 * Re-exposing these names here is not a new leak surface: both are already
 * approved, derived signals: this module just recombines them into one
 * "does this talent use browser automation tooling" view.
 */

const BROWSER_DEPENDENCY_NAMES = new Set(['playwright', '@playwright/test', 'puppeteer', 'puppeteer-core']);

function detectBrowserTools(technologies, mcp) {
  const techList = Array.isArray(technologies) ? technologies : [];
  const mcpServers = mcp && Array.isArray(mcp.servers) ? mcp.servers : [];

  const dependencies = techList.filter((name) => BROWSER_DEPENDENCY_NAMES.has(name));
  const mcpBrowserNames = mcpServers.filter((s) => s.category === 'browser').map((s) => s.name);

  return {
    detected: dependencies.length > 0 || mcpBrowserNames.length > 0,
    via: { dependencies, mcp: mcpBrowserNames },
    count: dependencies.length + mcpBrowserNames.length,
  };
}

module.exports = { detectBrowserTools };
