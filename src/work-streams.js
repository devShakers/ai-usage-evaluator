'use strict';

const { execFileSync } = require('child_process');
const { isGitRepo } = require('./git-activity');
const { takePrefetchedGitLog } = require('./git-log-prefetch');

// Deterministic WORK-STREAM structure for the project where `shakers ai-usage` runs (hybrid evaluation, Slice 2).

const GIT_TIMEOUT_MS = 15000;
const SESSION_GAP_SECONDS = 4 * 3600;
const SECONDS_PER_DAY = 86400;

const WORK_STREAMS_LOG_ARGS = ['log', '--no-merges', '--pretty=format:%at'];

function runGitTimestamps(root) {
  const prefetched = takePrefetchedGitLog(root, WORK_STREAMS_LOG_ARGS);
  if (prefetched !== undefined) return prefetched;
  try {
    return execFileSync(
      'git',
      ['-C', root, ...WORK_STREAMS_LOG_ARGS],
      {
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch {
    return null;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function collectWorkStreams(root) {
  if (!isGitRepo(root)) return null;

  const log = runGitTimestamps(root);
  if (log === null) return null;

  const timestamps = log
    .split('\n')
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (timestamps.length === 0) return null;

  const streams = [];
  let current = null;
  for (const ts of timestamps) {
    if (current && ts - current.last <= SESSION_GAP_SECONDS) {
      current.last = ts;
      current.count += 1;
    } else {
      current = { first: ts, last: ts, count: 1 };
      streams.push(current);
    }
  }

  const streamCount = streams.length;
  const spanDaysOf = (s) => Math.floor((s.last - s.first) / SECONDS_PER_DAY);
  const multiDayStreams = streams.filter((s) => spanDaysOf(s) >= 1).length;
  const maxStreamSpanDays = streams.reduce(
    (max, s) => Math.max(max, spanDaysOf(s)),
    0,
  );

  return {
    streamCount,
    multiDayStreams,
    avgCommitsPerSession: round2(timestamps.length / streamCount),
    maxStreamSpanDays,
  };
}

module.exports = { collectWorkStreams, SESSION_GAP_SECONDS, WORK_STREAMS_LOG_ARGS };
