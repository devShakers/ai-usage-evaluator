'use strict';

const os = require('os');

/*
 * Shared home-directory resolution (talents-ai-score, ADR-014 — "Alcance del
 * tier: Talento = proyecto ∪ home", applied uniformly to every category).
 *
 * Several detectors now need to scan the user's home directory in addition
 * to the project root (agent org chart, MCP config, memory structure,
 * automations, browser tools). `os.homedir()` can't be pointed at a
 * throwaway directory in tests, so every new/updated detector resolves the
 * home directory through this single function instead of calling
 * `os.homedir()` directly — `AI_FOOTPRINT_HOME_DIR` overrides it, test-only
 * (mirrors the existing `AI_FOOTPRINT_CONFIG_DIR` override pattern in
 * src/share.js). Unset in production: always resolves to the real home.
 */
function getHomeDir(env = process.env) {
  return env.AI_FOOTPRINT_HOME_DIR || os.homedir();
}

module.exports = { getHomeDir };
