'use strict';

const { classify } = require('./maturity');
const { computeTierResult, aggregateTierSignals, computeTier } = require('./tier-engine');

// Where this roadmap leaves you, computed with the REAL engine (issue 084).

// One entry per TARGET tier: the smallest report-shape changes that satisfy that tier's criterion.
const AGENTIC_TOOL_ID = 'claude-code';

function cloneReport(report) {
  return JSON.parse(JSON.stringify(report));
}

function detectedTools(r) {
  return (Array.isArray(r.tools) ? r.tools : []).filter((t) => t && t.detected);
}

// Every depth bump needs SOME detected tool to hang off, because the engine only aggregates depth over detected tools.
function ensureDetectedTool(r, { agentic = false } = {}) {
  if (!Array.isArray(r.tools)) r.tools = [];
  const existing = detectedTools(r);
  const wanted = agentic ? existing.find((t) => t.id === AGENTIC_TOOL_ID) : existing[0];
  if (wanted) {
    if (!wanted.depth || typeof wanted.depth !== 'object') wanted.depth = {};
    return wanted;
  }
  const tool = {
    id: agentic ? AGENTIC_TOOL_ID : 'projected-tool',
    name: agentic ? 'Claude Code' : 'AI tool',
    detected: true,
    depth: {},
    footprint: null,
    recency: { lastModified: null, daysSinceModified: null, bucket: null },
  };
  r.tools.push(tool);
  return tool;
}

const bumpDepth = (field) => (r) => {
  const tool = ensureDetectedTool(r);
  tool.depth[field] = (tool.depth[field] || 0) + 1;
};

// "Configure one MCP server" needs its own delta, and the reason is a collision worth recording (issue 112 landing after issue 084).
const addMcpServer = (r) => {
  const tool = ensureDetectedTool(r);
  tool.depth.mcpServers = (tool.depth.mcpServers || 0) + 1;
  if (!r.mcp || typeof r.mcp !== 'object') r.mcp = { servers: [], countsByCategory: {}, total: 0, byTool: {} };
  r.mcp.total = (typeof r.mcp.total === 'number' ? r.mcp.total : 0) + 1;
};

const DELTAS = {
  1: [(r) => { ensureDetectedTool(r); }],
  2: [bumpDepth('instructions')],
  3: [addMcpServer],
  4: [bumpDepth('skills')],
  5: [
    (r) => { ensureDetectedTool(r, { agentic: true }); },
    addMcpServer,
    bumpDepth('skills'),
  ],
  6: [(r) => {
    if (!r.agentCounts || typeof r.agentCounts !== 'object') r.agentCounts = {};
    r.agentCounts.agents = Math.max(2, (r.agentCounts.agents || 0) + 1);
  }],
  7: [bumpDepth('hooks')],
};

const MAX_TIER = 7;

function projectNextTier(report) {
  if (!report || typeof report !== 'object') return null;

  const currentTierResult = computeTierResult(report);
  const currentTier = currentTierResult.tier;
  if (currentTier >= MAX_TIER) return null;

  const deltas = DELTAS[currentTier + 1];
  if (!deltas) return null;

  let projectedReport;
  try {
    projectedReport = cloneReport(report);
    for (const apply of deltas) apply(projectedReport);
  } catch {
    // A report shape this cannot clone or mutate is a report this must not
    // guess about: no projection is better than a made-up one.
    return null;
  }

  const projectedTierResult = computeTierResult(projectedReport);
  // Guard against a delta that no longer satisfies its criterion (a ladder
  // change): under-projecting silently would be worse than saying nothing.
  if (projectedTierResult.tier <= currentTier) return null;

  const currentMaturity = classify(report);
  const projectedMaturity = classify(projectedReport);

  return {
    current: {
      tier: currentTier,
      tierKey: currentTierResult.tierKey,
      setupLevelKey: currentTierResult.setupLevel.key,
      score: currentMaturity.score,
    },
    projected: {
      tier: projectedTierResult.tier,
      tierKey: projectedTierResult.tierKey,
      setupLevelKey: projectedTierResult.setupLevel.key,
      score: projectedMaturity.score,
    },
    cascaded: projectedTierResult.tier > currentTier + 1,
  };
}

module.exports = { projectNextTier, DELTAS, aggregateTierSignals, computeTier };
