'use strict';

const { execFile } = require('child_process');

// Runs the aggregation's per-repo git logs concurrently with the collectors' exact args; each result is taken once and expires.

const GIT_TIMEOUT_MS = 15000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const MAX_CONCURRENT = 8;
const TTL_MS = 60 * 1000;

const prefetched = new Map();

const keyOf = (root, args) => JSON.stringify([root, args]);

function runAsync(root, args) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', root, ...args],
      { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

// Runs every (root, args) pair, at most MAX_CONCURRENT at a time. Never throws.
async function prefetchGitLogs(roots, argSets) {
  const jobs = [];
  for (const root of roots || []) {
    for (const args of argSets) jobs.push({ root, args });
  }
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { root, args } = jobs[next++];
      const out = await runAsync(root, args);
      if (out !== null) prefetched.set(keyOf(root, args), { out, at: Date.now() });
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, jobs.length) }, worker));
}

// The prefetched stdout for exactly this command, once; `undefined` on a miss.
function takePrefetchedGitLog(root, args) {
  const key = keyOf(root, args);
  const hit = prefetched.get(key);
  if (!hit) return undefined;
  prefetched.delete(key);
  return Date.now() - hit.at <= TTL_MS ? hit.out : undefined;
}

module.exports = { prefetchGitLogs, takePrefetchedGitLog };
