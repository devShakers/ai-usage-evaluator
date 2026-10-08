'use strict';

const { execFileSync } = require('child_process');

// Git-derived signals for the "Add project to portfolio" route (talents-ai- score, ADR-059): the remote URL (step 4) and the first/last-commit date range (auto `startDate`/`endDate`).

const GIT_TIMEOUT_MS = 15000;

function runGit(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function getRemoteUrl(root) {
  const raw = runGit(root, ['remote', 'get-url', 'origin']);
  if (!raw || !raw.trim()) return null;
  return normalizeRemoteUrl(raw.trim());
}

function normalizeRemoteUrl(url) {
  const stripped = url.replace(/\.git$/, '');
  const scp = stripped.match(/^[^@/]+@([^:]+):(.+)$/); // git@host:owner/repo
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  try {
    const u = new URL(stripped);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; // e.g. an ssh:// scheme
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return null; // not a URL this function recognizes — never guess
  }
}

function getCommitDateRange(root) {
  const endRaw = runGit(root, ['log', '-1', '--format=%aI']);
  const endDate = isoDateOnly(endRaw);

  const rootShas = runGit(root, ['rev-list', '--max-parents=0', 'HEAD']);
  const firstSha = rootShas && rootShas.trim() ? rootShas.trim().split('\n')[0] : null;
  const startRaw = firstSha ? runGit(root, ['show', '-s', '--format=%aI', firstSha]) : null;
  const startDate = isoDateOnly(startRaw);

  return { startDate, endDate };
}

function isoDateOnly(raw) {
  const s = raw && raw.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return s.slice(0, 10); // %aI is already ISO 8601 (e.g. 2026-08-01T12:00:00+02:00); take the date part
}

module.exports = { getRemoteUrl, normalizeRemoteUrl, getCommitDateRange };
