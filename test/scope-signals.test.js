'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeGitActivity,
  mergeWorkStreams,
  mergeDetectionEvidence,
} = require('../src/scope-signals');

test('mergeGitActivity: single repo passes through (velocity recomputed identically)', () => {
  const g = {
    commitCount: 10,
    authoredCommitCount: 8,
    linesAdded: 100,
    linesDeleted: 20,
    filesByType: { js: 5 },
    velocity: 2,
    spanDays: 5,
  };
  assert.deepEqual(mergeGitActivity([g]), g);
});

test('mergeGitActivity: two repos sum counts, merge filesByType, max span, recompute velocity', () => {
  const merged = mergeGitActivity([
    { commitCount: 6, authoredCommitCount: 4, linesAdded: 60, linesDeleted: 10, filesByType: { js: 3 }, velocity: 3, spanDays: 2 },
    { commitCount: 4, authoredCommitCount: 4, linesAdded: 40, linesDeleted: 5, filesByType: { js: 1, ts: 2 }, velocity: 1, spanDays: 4 },
  ]);
  assert.equal(merged.commitCount, 10);
  assert.equal(merged.authoredCommitCount, 8);
  assert.equal(merged.linesAdded, 100);
  assert.deepEqual(merged.filesByType, { js: 4, ts: 2 });
  assert.equal(merged.spanDays, 4);
  assert.equal(merged.velocity, 2.5); // 10 / max(4,1)
});

test('mergeGitActivity: all null yields null', () => {
  assert.equal(mergeGitActivity([null, null]), null);
});

test('mergeWorkStreams: sums additive fields, averages avgCommits, max span', () => {
  const merged = mergeWorkStreams([
    { streamCount: 2, multiDayStreams: 1, avgCommitsPerSession: 4, maxStreamSpanDays: 3 },
    { streamCount: 3, multiDayStreams: 2, avgCommitsPerSession: 2, maxStreamSpanDays: 5 },
  ]);
  assert.deepEqual(merged, {
    streamCount: 5,
    multiDayStreams: 3,
    avgCommitsPerSession: 3, // (4+2)/2
    maxStreamSpanDays: 5,
  });
});

test('mergeDetectionEvidence: same tech from two repos merges (sum authored/total, OR known, max depth, min recency, AND vendored)', () => {
  const merged = mergeDetectionEvidence([
    {
      skills: [{ tech: 'React', authoredFileCount: 1, totalFileCount: 2, authorshipKnown: true, depth: 0.4, vendored: false, recencyDays: 100 }],
      agents: [{ name: 'planner', tools: ['Read'], model: 'sonnet', authoredFileCount: 1, totalFileCount: 1, authorshipKnown: true, depth: 0.5, vendored: false, recencyDays: 50 }],
      provenance: { fork: false, forkSignal: null, boilerplate: false, boilerplateMarker: null },
    },
    {
      skills: [{ tech: 'React', authoredFileCount: 2, totalFileCount: 3, authorshipKnown: false, depth: 0.9, vendored: true, recencyDays: 5 }],
      agents: [],
      provenance: { fork: true, forkSignal: 'upstream-remote', boilerplate: false, boilerplateMarker: null },
    },
  ]);
  assert.equal(merged.skills.length, 1);
  const s = merged.skills[0];
  assert.equal(s.authoredFileCount, 3);
  assert.equal(s.totalFileCount, 5);
  assert.equal(s.authorshipKnown, true);
  assert.equal(s.depth, 0.9);
  assert.equal(s.recencyDays, 5);
  assert.equal(s.vendored, false); // false in one repo -> keep (AND)
  assert.equal(merged.agents.length, 1);
  assert.equal(merged.provenance.fork, true);
});

test('mergeDetectionEvidence: distinct agents stay separate; null list yields null', () => {
  assert.equal(mergeDetectionEvidence([null]), null);
  const merged = mergeDetectionEvidence([
    { skills: [], agents: [{ name: 'a', tools: ['Read'], model: 'x', authoredFileCount: 1, totalFileCount: 1, authorshipKnown: true, depth: 0.5, vendored: false, recencyDays: 1 }], provenance: null },
    { skills: [], agents: [{ name: 'b', tools: ['Edit'], model: 'y', authoredFileCount: 1, totalFileCount: 1, authorshipKnown: true, depth: 0.5, vendored: false, recencyDays: 1 }], provenance: null },
  ]);
  assert.equal(merged.agents.length, 2);
});
