'use strict';

const { normalizeAgentName } = require('./tier-engine');
const { scrubSecrets } = require('./agent-synthesis');
const { requestDeclareAgent } = require('./agents-client');

function detectedAgentsFromReport(report) {
  const synthesis = report && report.agentSynthesis && Array.isArray(report.agentSynthesis.agents) ? report.agentSynthesis.agents : [];
  const whatItDoesByName = new Map(synthesis.filter((a) => a && a.name).map((a) => [a.name, a.whatItDoes]));
  const agents = report && Array.isArray(report.agents) ? report.agents : [];
  return agents
    .filter((a) => a && typeof a.name === 'string' && a.name)
    .map((a) => ({ name: a.name, whatItDoes: whatItDoesByName.get(a.name) || null }));
}

function newDetectedAgents(candidates, profileAgents) {
  const taken = new Set((Array.isArray(profileAgents) ? profileAgents : []).map((a) => normalizeAgentName(a && a.name)));
  const fresh = [];
  for (const agent of Array.isArray(candidates) ? candidates : []) {
    const key = normalizeAgentName(agent && agent.name);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    fresh.push({ name: agent.name.trim(), whatItDoes: typeof agent.whatItDoes === 'string' && agent.whatItDoes ? agent.whatItDoes : null });
  }
  return fresh;
}

async function declareDetectedAgents(agents, { accessToken, hubAccessToken }, { endpoint, declare = requestDeclareAgent } = {}) {
  const added = [];
  const failed = [];
  for (const agent of agents) {
    const whatItDoes = agent.whatItDoes ? scrubSecrets(agent.whatItDoes) : undefined;
    const result = await declare({ name: agent.name, whatItDoes, accessToken, hubAccessToken }, { endpoint });
    if (result && result.ok) added.push(agent);
    else failed.push({ agent, reason: (result && result.reason) || 'declare-failed' });
  }
  return { added, failed };
}

module.exports = { detectedAgentsFromReport, newDetectedAgents, declareDetectedAgents };
