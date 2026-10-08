'use strict';

// Deterministic (no-LLM) browser tools detector (talents-ai-score, issue 018 / ADR-013-014).

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
