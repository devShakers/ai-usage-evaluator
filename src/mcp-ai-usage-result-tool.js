'use strict';

const FLOOR_METHOD = 'floor';
const FLOOR_CODE = 'other-1';
const POLL_INTERVAL_MS = 5000;
const POLL_CAP_MS = 90000;
const INVENTORY_TIMEOUT_MS = 15000;

const RESULT_INPUT_SCHEMA = { type: 'object', properties: {} };

function isClassified(agents) {
  if (agents.length === 0) return false;
  const anyMethod = agents.some((a) => typeof a.method === 'string' && a.method);
  if (anyMethod) {
    return agents.every(
      (a) => typeof a.method === 'string' && a.method && a.method !== FLOOR_METHOD,
    );
  }
  return agents.every((a) => a.code && a.code !== FLOOR_CODE);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollClassifiedInventory({
  accessToken,
  endpoint,
  requestDiscoveredInventory,
  sleep = defaultSleep,
  now = () => Date.now(),
  intervalMs = POLL_INTERVAL_MS,
  capMs = POLL_CAP_MS,
}) {
  const start = now();
  let agents = [];
  while (true) {
    const inv = await requestDiscoveredInventory(
      { accessToken },
      { endpoint, timeoutMs: INVENTORY_TIMEOUT_MS },
    );
    if (inv.ok) {
      agents = Array.isArray(inv.agents) ? inv.agents : [];
      if (isClassified(agents)) {
        return { status: 'ready', reason: 'classified', agents };
      }
    }
    if (now() - start + intervalMs > capMs) {
      return { status: 'pending', reason: 'classifying', agents };
    }
    await sleep(intervalMs);
  }
}

const READY_MESSAGE = 'Shakers finished classifying the agents.';
const PENDING_MESSAGE = 'Shakers is still classifying the agents — this is normal, call ai_usage_result again shortly to keep waiting.';

function makeAiUsageResultTool(deps = {}) {
  const {
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
    getUsageDiscoveredInventoryEndpoint = require('./config').getUsageDiscoveredInventoryEndpoint,
    requestDiscoveredInventory = require('./inventory-client').requestDiscoveredInventory,
    sleep = defaultSleep,
    now = () => Date.now(),
    intervalMs = POLL_INTERVAL_MS,
    capMs = POLL_CAP_MS,
  } = deps;

  async function handler() {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first.');
    }
    const endpoint = getUsageDiscoveredInventoryEndpoint();
    if (!endpoint) {
      throw new Error('discovered-inventory endpoint is not configured (set SHAKERS_CLI_INGEST_ENDPOINT).');
    }

    const result = await pollClassifiedInventory({
      accessToken: session.accessToken,
      endpoint,
      requestDiscoveredInventory,
      sleep,
      now,
      intervalMs,
      capMs,
    });
    return {
      ...result,
      message: result.status === 'ready' ? READY_MESSAGE : PENDING_MESSAGE,
    };
  }

  return {
    name: 'ai_usage_result',
    description:
      "Retrieve the enriched Shakers classification for the talent's agents after ai_usage. Shakers classifies agents and writes their descriptions server-side (no client LLM), so this reads the result: per agent { name, tools, model, category, role, level, code, whatItDoes }. Session-keyed, no arguments. Server-side classification can take a few minutes, so this does a bounded internal poll (~90s max, never a long-held call): returns { status: 'ready', agents } once every agent has been classified, or { status: 'pending', agents } while Shakers is still processing (call it again to keep waiting — 'pending' is normal progress, not an error). Present agents to the talent by NAME and category/role only; the `code` field is an internal handle for add_agent, never show it. Requires an active session.",
    inputSchema: RESULT_INPUT_SCHEMA,
    handler,
  };
}

module.exports = {
  makeAiUsageResultTool,
  isClassified,
  pollClassifiedInventory,
  RESULT_INPUT_SCHEMA,
};
