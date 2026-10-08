'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const {
  toolSources,
  listSessionFiles,
  readSessionObjects,
  resolveFileCwd,
} = require('./session-scan');
const { normalizeRemote } = require('./authorship');

const GIT_TIMEOUT_MS = 15000;

function git(cwd, args) {
  try {
    const out = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 4 * 1024 * 1024,
    });
    return out ? out.trim() : null;
  } catch {
    return null;
  }
}

function repoIdentityForCwd(cwd, gitRunner = git) {
  const toplevel = gitRunner(cwd, ['rev-parse', '--show-toplevel']) || null;
  const remoteRaw = gitRunner(cwd, ['config', '--get', 'remote.origin.url']);
  const remote = remoteRaw && remoteRaw.trim() ? normalizeRemote(remoteRaw.trim()) : null;
  return { toplevel, remote };
}

function sessionCwdCounts(env = process.env) {
  const counts = new Map();
  let unassigned = 0;
  for (const source of toolSources(env)) {
    for (const file of listSessionFiles(source.dir)) {
      const cwd = resolveFileCwd(readSessionObjects(file));
      if (cwd === null) {
        unassigned += 1;
        continue;
      }
      counts.set(cwd, (counts.get(cwd) || 0) + 1);
    }
  }
  return { counts, unassigned };
}

function labelFor(remote, groupKey) {
  if (remote) return remote;
  return path.basename(groupKey) || groupKey;
}

function detectRepos(env = process.env, { gitRunner = git } = {}) {
  const { counts, unassigned } = sessionCwdCounts(env);

  const byGroup = new Map();
  for (const [cwd, sessionCount] of counts) {
    const { toplevel, remote } = repoIdentityForCwd(cwd, gitRunner);
    const groupKey = toplevel || cwd;
    let group = byGroup.get(groupKey);
    if (!group) {
      group = {
        toplevel: toplevel || null,
        remote: remote || null,
        cwds: new Set(),
        sessionCount: 0,
        resolved: !!toplevel,
      };
      byGroup.set(groupKey, group);
    }
    group.cwds.add(cwd);
    group.sessionCount += sessionCount;
    if (!group.remote && remote) group.remote = remote;
  }

  const repos = [...byGroup.entries()]
    .map(([groupKey, g]) => ({
      id: g.remote || g.toplevel || groupKey,
      toplevel: g.toplevel,
      remote: g.remote,
      label: labelFor(g.remote, groupKey),
      sessionCount: g.sessionCount,
      cwds: [...g.cwds].sort(),
      resolved: g.resolved,
    }))
    .sort(
      (a, b) => b.sessionCount - a.sessionCount || a.label.localeCompare(b.label),
    );

  return { repos, unassignedSessionCount: unassigned };
}

function normalizeFlagToken(token) {
  return String(token || '').trim().toLowerCase().replace(/\/+$/, '');
}

function repoMatchesToken(repo, token) {
  const t = normalizeFlagToken(token);
  if (!t) return false;
  return [repo.id, repo.remote, repo.toplevel, repo.label, path.basename(repo.toplevel || repo.id)]
    .filter((x) => typeof x === 'string' && x)
    .some((x) => normalizeFlagToken(x) === t || normalizeFlagToken(x).endsWith(`/${t}`));
}

function matchReposByFlag(repos, tokens) {
  const indices = new Set();
  const unmatched = [];
  for (const token of tokens || []) {
    const idx = repos.findIndex((r) => repoMatchesToken(r, token));
    if (idx === -1) unmatched.push(token);
    else indices.add(idx);
  }
  return { indices: [...indices].sort((a, b) => a - b), unmatched };
}

function scopeFromSelection(repos, indices) {
  const selectedCwds = new Set();
  const selectedToplevels = [];
  for (const i of indices) {
    const repo = repos[i];
    if (!repo) continue;
    for (const c of repo.cwds) selectedCwds.add(c);
    selectedToplevels.push(repo.toplevel || repo.id);
  }
  return { selectedCwds, selectedToplevels };
}

function indexOfCurrentRepo(repos, cwdToplevel) {
  if (!cwdToplevel) return -1;
  return repos.findIndex((r) => r.toplevel === cwdToplevel);
}

module.exports = {
  detectRepos,
  repoIdentityForCwd,
  sessionCwdCounts,
  matchReposByFlag,
  repoMatchesToken,
  scopeFromSelection,
  indexOfCurrentRepo,
};
