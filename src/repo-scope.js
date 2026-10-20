'use strict';

const { isRefusedWalkRoot } = require('./scan-exclusions');
const {
  detectRepos,
  repoIdentityForCwd,
  matchReposByFlag,
  scopeFromSelection,
  indexOfCurrentRepo,
} = require('./detect-repos');

const MAX_MACHINE_WIDE_REPOS = 5;
const SCOPE_MACHINE = 'machine';
const SCOPE_REPO = 'repo';

function currentRepoToplevel(cwd, repoIdentityFn = repoIdentityForCwd) {
  try {
    return repoIdentityFn(cwd).toplevel || cwd;
  } catch {
    return cwd;
  }
}

// The real git toplevel of `cwd`, or null when `cwd` is not a repo (or is a refused system root like `/`, the MCP `cwd=/` case).
function cwdRepoToplevel(cwd, repoIdentityFn = repoIdentityForCwd) {
  if (isRefusedWalkRoot(cwd)) return null;
  try {
    return repoIdentityFn(cwd).toplevel || null;
  } catch {
    return null;
  }
}

// Pure: builds the machine-wide root set.
function machineWideToplevels(cwdRepoTop, detectedRepos, cap = MAX_MACHINE_WIDE_REPOS) {
  const ordered = [];
  const seen = new Set();
  const push = (t) => {
    if (typeof t !== 'string' || !t) return;
    if (isRefusedWalkRoot(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
    ordered.push(t);
  };
  push(cwdRepoTop);
  for (const r of detectedRepos || []) push(r && r.toplevel);
  const capped = ordered.slice(0, cap);
  return { toplevels: capped, total: ordered.length, capped: ordered.length > capped.length };
}

function cwdOnlyScope(repos, cwdToplevel) {
  const idx = indexOfCurrentRepo(repos, cwdToplevel);
  if (idx === -1) {
    return { selectedCwds: new Set(), toplevels: [cwdToplevel], mode: 'cwd' };
  }
  const { selectedCwds, selectedToplevels } = scopeFromSelection(repos, [idx]);
  return {
    selectedCwds,
    toplevels: selectedToplevels.length ? selectedToplevels : [cwdToplevel],
    mode: 'cwd',
  };
}

// Resolve which repos feed the AI-usage evaluation.
async function resolveRepoScope({
  opts,
  cwd,
  injectedAsk,
  catalog,
  detectReposFn = detectRepos,
  repoIdentityFn = repoIdentityForCwd,
  chooseScope = null,
  isTTY = !!process.stdin.isTTY && !!process.stdout.isTTY,
  note = () => {},
}) {
  const cwdToplevel = currentRepoToplevel(cwd, repoIdentityFn);
  const cwdRepoTop = cwdRepoToplevel(cwd, repoIdentityFn);
  const detect = () => {
    try {
      return detectReposFn(process.env);
    } catch {
      return { repos: [], unassignedSessionCount: 0 };
    }
  };

  // 1. Explicit repo list always wins.
  if (opts.repos) {
    const { repos, unassignedSessionCount } = detect();
    note(catalog.cli.reposDetectedNote(repos.length, unassignedSessionCount));
    const { indices, unmatched } = matchReposByFlag(repos, opts.repos);
    if (unmatched.length > 0) {
      process.stderr.write(`  ${catalog.cli.reposFlagUnmatched(unmatched.join(', '))}\n`);
    }
    if (indices.length > 0) {
      const { selectedCwds, selectedToplevels } = scopeFromSelection(repos, indices);
      return { selectedCwds, toplevels: [...new Set(selectedToplevels)], mode: 'flag' };
    }
    return cwdOnlyScope(repos, cwdToplevel);
  }

  const wantsMachine = opts.allRepos || opts.machine || opts.scope === SCOPE_MACHINE;
  const wantsRepo = opts.repo || opts.scope === SCOPE_REPO;

  let choice = null;
  if (wantsMachine) choice = SCOPE_MACHINE;
  else if (wantsRepo) choice = SCOPE_REPO;
  else if (chooseScope && isTTY && !injectedAsk && !opts.json) {
    choice = await chooseScope({ catalog, stdinIsTTY: true });
  }
  if (choice === null) choice = SCOPE_REPO;

  if (choice === SCOPE_MACHINE) {
    const { repos, unassignedSessionCount } = detect();
    note(catalog.cli.reposDetectedNote(repos.length, unassignedSessionCount));
    const mw = machineWideToplevels(cwdRepoTop, repos);
    if (mw.capped) {
      process.stderr.write(`\n  ${catalog.cli.reposScopeCapped(mw.toplevels.length, mw.total)}\n`);
    }
    note(catalog.cli.reposScopeAll);
    return {
      selectedCwds: null,
      toplevels: mw.toplevels.length ? mw.toplevels : [cwdToplevel],
      mode: 'all',
    };
  }

  // Current repo.
  const { repos } = detect();
  return cwdOnlyScope(repos, cwdToplevel);
}

module.exports = { resolveRepoScope, machineWideToplevels, SCOPE_MACHINE, SCOPE_REPO };
