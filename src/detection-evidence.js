'use strict';

const { collectAuthorship, attributeSample } = require('./authorship');
const { detectTechnologyManifests } = require('./tech-detector');
const { agentSourceFilesByName } = require('./agent-org-chart');
const { classifyVendored, collectProvenance } = require('./detection-noise');

// Per-CANDIDATE authorship + depth (hybrid evaluation, Slice 3c).

const SKILL_DEPTH_SATURATION = 3;
const AGENT_DEPTH_SATURATION = 8;
const DEPTH_FLOOR = 0.3;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Maps a raw count to (0,1]: DEPTH_FLOOR..1, so a detected-but-shallow candidate
// is ordered DOWN without being excluded. `null` when there is no signal.
function normalizedDepth(signal, saturation) {
  if (typeof signal !== 'number' || !Number.isFinite(signal) || signal <= 0) {
    return null;
  }
  const ratio = Math.min(1, signal / saturation);
  return round2(DEPTH_FLOOR + (1 - DEPTH_FLOOR) * ratio);
}

function recencyDaysForPaths(relPaths, authorship, nowSeconds) {
  if (!Array.isArray(relPaths) || relPaths.length === 0) return null;
  let mostRecent = null;
  for (const p of relPaths) {
    const t = authorship.mostRecentCommitTime(p);
    if (typeof t === 'number' && Number.isFinite(t)) {
      mostRecent = mostRecent === null ? t : Math.max(mostRecent, t);
    }
  }
  if (mostRecent === null) return null;
  return Math.max(0, Math.floor((nowSeconds - mostRecent) / 86400));
}

// Attributes a candidate's evidence files against the talent's own email via the ADR-017 gate.
function attributionCounts(relPaths, verifiedEmail, authorship) {
  if (!Array.isArray(relPaths) || relPaths.length === 0) {
    return { authoredFileCount: 0, totalFileCount: 0, authorshipKnown: false };
  }
  const result = attributeSample(
    { files: relPaths.map((p) => ({ path: p })) },
    verifiedEmail,
    authorship,
  );
  const totalFileCount = result.fileAttribution.filter(
    (f) => f.authors.length > 0,
  ).length;
  return {
    authoredFileCount: result.attributableFiles.length,
    totalFileCount,
    authorshipKnown: authorship.available && totalFileCount > 0,
  };
}

// Builds `report.detectionEvidence` = `{ skills, agents, provenance } | null`.
function collectDetectionEvidence(root, verifiedEmail, report) {
  const scanRoot = root || process.cwd();
  const authorship = collectAuthorship(scanRoot);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const skills = detectTechnologyManifests(scanRoot).map(
    ({ tech, manifestPaths }) => ({
      tech,
      ...attributionCounts(manifestPaths, verifiedEmail, authorship),
      depth: normalizedDepth(manifestPaths.length, SKILL_DEPTH_SATURATION),
      vendored: classifyVendored(manifestPaths),
      recencyDays: recencyDaysForPaths(manifestPaths, authorship, nowSeconds),
    }),
  );

  const sourceByName = agentSourceFilesByName(scanRoot);
  const reportAgents =
    report && Array.isArray(report.agents) ? report.agents : [];
  const agents = reportAgents.map((agent) => {
    const rel = sourceByName.get(agent.name) || null;
    const tools = Array.isArray(agent.tools) ? agent.tools : [];
    const evidencePaths = rel ? [rel] : [];
    return {
      name: agent.name,
      tools,
      model: agent.model || null,
      ...attributionCounts(evidencePaths, verifiedEmail, authorship),
      depth: normalizedDepth(tools.length, AGENT_DEPTH_SATURATION),
      vendored: classifyVendored(evidencePaths),
      recencyDays: recencyDaysForPaths(evidencePaths, authorship, nowSeconds),
    };
  });

  if (skills.length === 0 && agents.length === 0) return null;
  return { skills, agents, provenance: collectProvenance(scanRoot) };
}

module.exports = {
  collectDetectionEvidence,
  normalizedDepth,
  SKILL_DEPTH_SATURATION,
  AGENT_DEPTH_SATURATION,
  DEPTH_FLOOR,
};
