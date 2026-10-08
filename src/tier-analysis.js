'use strict';

const { computeTierResult, setupLevelForTier, SETUP_LEVELS, TIERS } = require('./tier-engine');

// One entry per tier BOUNDARY (T(n-1) -> Tn), in ladder order.
const CRITERIA = [
  {
    toTier: 1,
    met: (s) => s.totalDetected >= 1,
    metText: (s, tt) => tt.criterion.t1Met(s.totalDetected),
    blockingText: (s, tt) => tt.criterion.t1Blocking(s.totalDetected),
  },
  {
    toTier: 2,
    met: (s) => s.context >= 1,
    metText: (s, tt) => tt.criterion.t2Met(s.context),
    blockingText: (s, tt) => tt.criterion.t2Blocking(s.context),
  },
  {
    toTier: 3,
    met: (s) => s.mcp >= 1,
    metText: (s, tt) => tt.criterion.t3Met(s.mcp),
    blockingText: (s, tt) => tt.criterion.t3Blocking(s.mcp),
  },
  {
    toTier: 4,
    met: (s) => s.custom >= 1,
    metText: (s, tt) => tt.criterion.t4Met(s.custom),
    blockingText: (s, tt) => tt.criterion.t4Blocking(s.custom),
  },
  {
    toTier: 5,
    met: (s) => s.hasAgentic && s.mcp >= 1 && s.custom >= 1,
    metText: (s, tt) => tt.criterion.t5Met(s.hasAgentic, s.mcp, s.custom),
    blockingText: (s, tt) => tt.criterion.t5Blocking(s.hasAgentic, s.mcp, s.custom),
  },
  {
    toTier: 6,
    met: (s) => s.agentCount >= 2,
    metText: (s, tt) => tt.criterion.t6Met(s.agentCount),
    blockingText: (s, tt) => tt.criterion.t6Blocking(s.agentCount),
  },
  {
    toTier: 7,
    met: (s) => s.hooks >= 1,
    metText: (s, tt) => tt.criterion.t7Met(s.hooks),
    blockingText: (s, tt) => tt.criterion.t7Blocking(s.hooks),
  },
];

// Builds the full analysis for a report: `{ tier, tierKey, tierName, band, signals, metCriteria, blockingCriterion }`.
function analyzeTier(report, t) {
  const tt = t.tierAnalysis;
  const result = computeTierResult(report || {});
  const { signals, tier } = result;

  const tierName = (t.tierNames && t.tierNames[result.tierKey]) || result.tierName;

  const metCriteria = CRITERIA.filter((c) => c.toTier <= tier).map((c) => ({
    toTier: c.toTier,
    text: c.metText(signals, tt),
  }));

  const blockingEntry = tier < 7 ? CRITERIA.find((c) => c.toTier === tier + 1) : null;
  const blockingCriterion = blockingEntry ? blockingEntry.blockingText(signals, tt) : null;

  return { ...result, tierName, metCriteria, blockingCriterion };
}

function buildLadder(report, t) {
  const tt = t.tierAnalysis;
  const ld = t.ladder;
  const result = computeTierResult(report || {});
  const { signals, tier } = result;
  const currentSetupRank = setupLevelForTier(tier).rank;

  const statusFor = (index, current) =>
    index < current ? 'done' : index === current ? 'current' : 'pending';

  const tierNode = (meta) => {
    const status = statusFor(meta.tier, tier);
    // Pending tiers carry the exact criterion that unlocks them (reused from the
    // tier-analysis CRITERIA, already localized). done/current show none.
    let unlock = null;
    if (status === 'pending') {
      const crit = CRITERIA.find((c) => c.toTier === meta.tier);
      unlock = crit ? crit.blockingText(signals, tt) : null;
    }
    return {
      tier: meta.tier,
      tierKey: meta.key,
      name: (t.tierNames && t.tierNames[meta.key]) || meta.name,
      description: (ld && ld.tierDesc && ld.tierDesc[meta.key]) || '',
      status,
      unlock,
    };
  };

  // NESTED ladder: each SETUP LEVEL groups the TIERS that compose it.
  const tiersBySetup = new Map();
  for (const meta of TIERS) {
    const key = setupLevelForTier(meta.tier).key;
    if (!tiersBySetup.has(key)) tiersBySetup.set(key, []);
    tiersBySetup.get(key).push(tierNode(meta));
  }

  const setupLevels = SETUP_LEVELS.map((meta) => {
    const tiers = (tiersBySetup.get(meta.key) || []).sort((a, b) => a.tier - b.tier);
    const copy = (t.setupLevels && t.setupLevels[meta.key]) || {};
    return {
      key: meta.key,
      code: meta.code,
      rank: meta.rank,
      emoji: meta.emoji,
      label: copy.label || meta.key,
      description: copy.desc || '',
      status: statusFor(meta.rank, currentSetupRank),
      tierKeys: tiers.map((x) => x.tierKey),
      tiers,
    };
  });

  return { currentTier: tier, currentSetupRank, setupLevels };
}

module.exports = { analyzeTier, buildLadder, CRITERIA };
