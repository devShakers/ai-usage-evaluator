'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const { takePrefetchedGitLog } = require('./git-log-prefetch');

const GIT_TIMEOUT_MS = 15000;
const MAX_FILE_TYPES = 50;

// The one history read behind the activity numbers (\x01 = commit marker, \x1f = field sep).
const GIT_ACTIVITY_LOG_ARGS = ['log', '--no-merges', '--numstat', '--pretty=format:\x01%ae\x1f%at'];

function runGit(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function isGitRepo(root) {
  return runGit(root, ['rev-parse', '--is-inside-work-tree']) !== null;
}

function extensionOf(rawPath) {
  let p = rawPath;
  const arrow = p.indexOf('=>');
  if (arrow !== -1) {
    p = p
      .slice(arrow + 2)
      .replace(/[{}]/g, '')
      .trim();
  }
  const base = path.basename(p.trim());
  const ext = path.extname(base).replace(/^\./, '').toLowerCase();
  return ext || 'none';
}

function bumpFileType(filesByType, ext) {
  if (Object.prototype.hasOwnProperty.call(filesByType, ext)) {
    filesByType[ext] += 1;
    return;
  }
  if (Object.keys(filesByType).length >= MAX_FILE_TYPES) return;
  filesByType[ext] = 1;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Deterministic git-activity signals for the project where `shakers ai-usage` runs (hybrid evaluation, Slice 1).
function collectGitActivity(root, verifiedEmail) {
  if (!isGitRepo(root)) return null;

  const sep = String.fromCharCode(1);
  const unit = String.fromCharCode(31);
  const prefetchedLog = takePrefetchedGitLog(root, GIT_ACTIVITY_LOG_ARGS);
  const log = prefetchedLog !== undefined ? prefetchedLog : runGit(root, GIT_ACTIVITY_LOG_ARGS);
  if (log === null) return null;

  const target = String(verifiedEmail || '')
    .trim()
    .toLowerCase();

  let commitCount = 0;
  let authoredCommitCount = 0;
  let linesAdded = 0;
  let linesDeleted = 0;
  let minTs = null;
  let maxTs = null;
  const filesByType = {};

  for (const rawLine of log.split('\n')) {
    if (rawLine.startsWith(sep)) {
      commitCount += 1;
      const [email, atRaw] = rawLine.slice(1).split(unit);
      if (target && String(email || '').trim().toLowerCase() === target) {
        authoredCommitCount += 1;
      }
      const ts = Number.parseInt(atRaw, 10);
      if (Number.isFinite(ts)) {
        if (minTs === null || ts < minTs) minTs = ts;
        if (maxTs === null || ts > maxTs) maxTs = ts;
      }
      continue;
    }
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [addedRaw, deletedRaw] = parts;
    const filePath = parts.slice(2).join('\t');
    if (addedRaw !== '-') linesAdded += Number.parseInt(addedRaw, 10) || 0;
    if (deletedRaw !== '-') linesDeleted += Number.parseInt(deletedRaw, 10) || 0;
    bumpFileType(filesByType, extensionOf(filePath));
  }

  if (commitCount === 0) return null;

  const spanDays =
    minTs !== null && maxTs !== null
      ? Math.max(0, Math.floor((maxTs - minTs) / 86400))
      : 0;
  const velocity = round2(commitCount / Math.max(spanDays, 1));

  return {
    commitCount,
    authoredCommitCount,
    linesAdded,
    linesDeleted,
    filesByType,
    velocity,
    spanDays,
  };
}

module.exports = { collectGitActivity, extensionOf, isGitRepo, GIT_ACTIVITY_LOG_ARGS };
