'use strict';

const { collectGitActivity } = require('./git-activity');
const { collectWorkStreams } = require('./work-streams');
const { collectDetectionEvidence } = require('./detection-evidence');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function maxOrNull(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}

function minOrNull(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.min(a, b);
}

function mergeGitActivity(list) {
  const present = list.filter(Boolean);
  if (present.length === 0) return null;
  const filesByType = {};
  let commitCount = 0;
  let authoredCommitCount = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  let spanDays = 0;
  for (const g of present) {
    commitCount += g.commitCount;
    authoredCommitCount += g.authoredCommitCount;
    linesAdded += g.linesAdded;
    linesDeleted += g.linesDeleted;
    spanDays = Math.max(spanDays, g.spanDays);
    for (const [ext, c] of Object.entries(g.filesByType || {})) {
      filesByType[ext] = (filesByType[ext] || 0) + c;
    }
  }
  return {
    commitCount,
    authoredCommitCount,
    linesAdded,
    linesDeleted,
    filesByType,
    velocity: round2(commitCount / Math.max(spanDays, 1)),
    spanDays,
  };
}

function mergeWorkStreams(list) {
  const present = list.filter(Boolean);
  if (present.length === 0) return null;
  let streamCount = 0;
  let multiDayStreams = 0;
  let maxStreamSpanDays = 0;
  let sumAvg = 0;
  for (const w of present) {
    streamCount += w.streamCount;
    multiDayStreams += w.multiDayStreams;
    maxStreamSpanDays = Math.max(maxStreamSpanDays, w.maxStreamSpanDays);
    sumAvg += w.avgCommitsPerSession;
  }
  return {
    streamCount,
    multiDayStreams,
    avgCommitsPerSession: round2(sumAvg / present.length),
    maxStreamSpanDays,
  };
}

function mergeCandidate(existing, incoming) {
  existing.authoredFileCount += incoming.authoredFileCount;
  existing.totalFileCount += incoming.totalFileCount;
  existing.authorshipKnown = existing.authorshipKnown || incoming.authorshipKnown;
  existing.depth = maxOrNull(existing.depth, incoming.depth);
  existing.recencyDays = minOrNull(existing.recencyDays, incoming.recencyDays);
  existing.vendored = existing.vendored && incoming.vendored;
}

function agentKey(a) {
  return `${a.name}|${(a.tools || []).join(',')}|${a.model || ''}`;
}

function mergeProvenance(a, b) {
  if (!b) return a;
  if (!a) return { ...b };
  return {
    fork: a.fork || b.fork,
    forkSignal: a.forkSignal || b.forkSignal || null,
    boilerplate: a.boilerplate || b.boilerplate,
    boilerplateMarker: a.boilerplateMarker || b.boilerplateMarker || null,
  };
}

function mergeDetectionEvidence(list) {
  const present = list.filter(Boolean);
  if (present.length === 0) return null;
  const skillsByTech = new Map();
  const agentsByKey = new Map();
  let provenance = null;
  for (const de of present) {
    for (const s of de.skills || []) {
      const existing = skillsByTech.get(s.tech);
      if (!existing) skillsByTech.set(s.tech, { ...s });
      else mergeCandidate(existing, s);
    }
    for (const a of de.agents || []) {
      const k = agentKey(a);
      const existing = agentsByKey.get(k);
      if (!existing) agentsByKey.set(k, { ...a });
      else mergeCandidate(existing, a);
    }
    provenance = mergeProvenance(provenance, de.provenance);
  }
  return {
    skills: [...skillsByTech.values()],
    agents: [...agentsByKey.values()],
    provenance,
  };
}

function collectScopedGitActivity(toplevels, verifiedEmail) {
  return mergeGitActivity(
    toplevels.map((root) => collectGitActivity(root, verifiedEmail)),
  );
}

function collectScopedWorkStreams(toplevels) {
  return mergeWorkStreams(toplevels.map((root) => collectWorkStreams(root)));
}

function collectScopedDetectionEvidence(toplevels, verifiedEmail, report) {
  return mergeDetectionEvidence(
    toplevels.map((root) => collectDetectionEvidence(root, verifiedEmail, report)),
  );
}

module.exports = {
  mergeGitActivity,
  mergeWorkStreams,
  mergeDetectionEvidence,
  collectScopedGitActivity,
  collectScopedWorkStreams,
  collectScopedDetectionEvidence,
};
