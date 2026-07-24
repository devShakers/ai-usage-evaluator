'use strict';

const { computeTierResult, setupLevelForTier, SETUP_LEVELS, TIERS } = require('./tier-engine');

/*
 * Deterministic "why this tier" analysis (talents-ai-score): builds a
 * professional, analytical breakdown of exactly which tier criteria are
 * satisfied — WITH the signal value backing each one — and the EXACT next
 * criterion blocking progression. Rendered in both render-html.js and
 * render-terminal.js from the SAME data here, so both outputs agree by
 * construction.
 *
 * This is a MECHANICAL readout of tier-engine.js's own ladder rule (see its
 * header table / computeTier()) — never an LLM guess, never invented: each
 * `met` predicate below mirrors computeTier()'s step-by-step logic exactly,
 * and every rendered sentence is a template filled with an already-computed
 * signal from `aggregateTierSignals` (tier-engine.js). Unlike
 * roadmap-content.js (curated, authored prose), this copy is
 * formula-driven, so it's written and translated in full in src/i18n.js's
 * `tierAnalysis` catalog — no pendingTranslation flag needed here.
 */

// One entry per tier BOUNDARY (T(n-1) -> Tn), in ladder order. `met` mirrors
// tier-engine.js's computeTier() exactly; `metText`/`blockingText` render
// the criterion in each direction (satisfied / still missing) from the
// SAME signals object, via the caller-supplied translated catalog (`tt`,
// i.e. `catalog.tierAnalysis` from src/i18n.js).
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

// Builds the full analysis for a report: `{ tier, tierKey, tierName, band,
// signals, metCriteria, blockingCriterion }`. `metCriteria` covers every
// boundary up to and including the computed tier (never beyond — matches
// the ladder's own "checked strictly bottom-up" rule: a criterion for a
// tier you haven't reached is never listed as "met" even if its own
// condition happens to hold in isolation, mirroring computeTier()'s gating
// on the PREVIOUS tier exactly). `blockingCriterion` is the tier+1
// boundary's text, or `null` at the max tier (T7) — nothing left to block.
//
// `t` is the FULL i18n catalog (src/i18n.js's `getCatalog(lang)`), not
// just `t.tierAnalysis` — talents-ai-score, i18n audit: tier-engine.js's
// own `tierName` field is Spanish-only (domain logic, not i18n, by
// design), so it's overridden here with the localized name from `t.tierNames`
// (keyed by the stable `tierKey`, never the raw Spanish string) before
// this ever reaches the render layer. Falls back to the raw name only if
// `t.tierNames` is somehow missing the key (defensive, never expected).
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

// Builds the FULL progression ladder (skill-code-certification, report req 1;
// ADR-016): every SETUP LEVEL (S1-S3, plus "Not certified") and every TIER
// (T0-T7) with its status relative to where the talent currently sits — so the
// report explains what each setup level/tier MEANS and shows, at a glance,
// which checks are already passed (✓), which is current (●) and which remain
// (○) with the exact criterion that unlocks them.
//
// Fully DETERMINISTIC: the current tier / setup level come straight from the
// tier engine, and the per-tier unlock text reuses tier-analysis's own
// already-translated `blockingText` criteria — no LLM, no new copy for the
// criteria themselves (only the plain-language "what it represents"
// descriptions are new i18n, in `t.ladder` / `t.setupLevels`). `t` is the FULL
// catalog (needs `t.tierNames`, `t.setupLevels`, `t.tierAnalysis`, `t.ladder`).
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

  // NESTED ladder: each SETUP LEVEL groups the TIERS that compose it. The
  // grouping is DERIVED from the tier engine's single source of truth
  // (`setupLevelForTier`, i.e. SETUP_LEVEL_BY_TIER) — never a hardcoded second
  // copy — so if that table changes, the grouping follows. Today that
  // inversion yields none→[T0] S1→[T1,T2] S2→[T3,T4] S3→[T5,T6,T7].
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
