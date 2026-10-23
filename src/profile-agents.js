'use strict';

const { requestListAgents } = require('./agents-client');
const { getAgentsListEndpoint } = require('./config');
const { ensureFreshSession } = require('./session-refresh');

const TALENT_ADDED_SOURCES = new Set(['DECLARED_BY_TALENT', 'CLI_DETECTED']);

async function fetchProfileAgentNames(env = process.env, deps = {}) {
  const {
    refresh = ensureFreshSession,
    list = requestListAgents,
    endpoint = getAgentsListEndpoint(env),
  } = deps;
  try {
    const session = await refresh(env);
    if (!session || !session.hubAccessToken) return [];
    const listed = await list({ accessToken: session.accessToken, hubAccessToken: session.hubAccessToken }, { endpoint });
    if (!listed || !listed.ok || !Array.isArray(listed.agents)) return [];
    return listed.agents.filter((a) => a && TALENT_ADDED_SOURCES.has(a.source) && a.name).map((a) => a.name);
  } catch {
    return [];
  }
}

module.exports = { fetchProfileAgentNames, TALENT_ADDED_SOURCES };
