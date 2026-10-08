'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

// Git AUTHORSHIP + provenance for the certify phase (skill-code-certification, ADR-017).

const { takePrefetchedGitLog } = require('./git-log-prefetch');

const GIT_TIMEOUT_MS = 15000;
const SHORT_SHA_LEN = 10;

const AUTHORSHIP_LOG_ARGS = ['log', '--no-merges', '--pretty=format:\x01%ae\x1f%at', '--name-only'];

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

// True only inside a real work tree. Everything else (no git, bare repo, not a
// repo) is treated as "cannot attribute" upstream.
function isGitRepo(root) {
  return runGit(root, ['rev-parse', '--is-inside-work-tree']) !== null;
}

// Repo identity for the evidence record.
function getRepository(root) {
  const remote = runGit(root, ['config', '--get', 'remote.origin.url']);
  if (remote && remote.trim()) return normalizeRemote(remote.trim());
  const top = runGit(root, ['rev-parse', '--show-toplevel']);
  if (top && top.trim()) return path.basename(top.trim());
  return null;
}

function normalizeRemote(url) {
  // `git@host:owner/repo.git` | `https://[token@]host/owner/repo.git` ->
  // `host/owner/repo`. Any userinfo (a token/password) is dropped, never kept.
  let s = url.replace(/\.git$/, '');
  const scp = s.match(/^[^@]+@([^:]+):(.+)$/); // scp-like ssh
  if (scp) return `${scp[1]}/${scp[2]}`;
  try {
    const u = new URL(s);
    return `${u.host}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return s;
  }
}

// `<root-commit>..<HEAD>` short shas over the current branch. `null` when the
// history can't be read (e.g. a repo with no commits yet).
function getCommitRange(root) {
  const head = runGit(root, ['rev-parse', `--short=${SHORT_SHA_LEN}`, 'HEAD']);
  if (!head || !head.trim()) return null;
  const roots = runGit(root, ['rev-list', '--max-parents=0', 'HEAD']);
  const firstFull = roots && roots.trim() ? roots.trim().split('\n').pop().trim() : null;
  if (!firstFull) return head.trim();
  const first = runGit(root, ['rev-parse', `--short=${SHORT_SHA_LEN}`, firstFull]);
  const firstShort = first && first.trim() ? first.trim() : firstFull.slice(0, SHORT_SHA_LEN);
  return `${firstShort}..${head.trim()}`;
}

// The path git sees for a file is repo-relative; the sampler's paths are relative to `root`, which may be a SUBDIR of the repo.
function getRootPrefix(root) {
  const prefix = runGit(root, ['rev-parse', '--show-prefix']);
  return prefix && prefix.trim() ? prefix.trim().replace(/\/+$/, '') : '';
}

function buildPathIndex(root) {
  const authorsByPath = new Map();
  const timeByPath = new Map();
  const prefetched = takePrefetchedGitLog(root, AUTHORSHIP_LOG_ARGS);
  const log = prefetched !== undefined ? prefetched : runGit(root, AUTHORSHIP_LOG_ARGS);
  if (log === null) return { authorsByPath, timeByPath };

  let currentEmail = null;
  let currentTime = null;
  for (const rawLine of log.split('\n')) {
    if (rawLine.startsWith('\x01')) {
      const [email, atRaw] = rawLine.slice(1).split('\x1f');
      currentEmail = String(email || '').trim().toLowerCase();
      const ts = Number.parseInt(atRaw, 10);
      currentTime = Number.isFinite(ts) ? ts : null;
      continue;
    }
    const file = rawLine.trim();
    if (!file || currentEmail === null) continue;
    let set = authorsByPath.get(file);
    if (!set) {
      set = new Set();
      authorsByPath.set(file, set);
    }
    set.add(currentEmail);
    if (currentTime !== null) {
      const prev = timeByPath.get(file);
      if (prev === undefined || currentTime > prev) {
        timeByPath.set(file, currentTime);
      }
    }
  }
  return { authorsByPath, timeByPath };
}

// Full authorship context for `root`, collected ONCE per run.
function collectAuthorship(root) {
  if (!isGitRepo(root)) {
    return {
      available: false,
      repository: null,
      commitRange: null,
      authorsForPath: () => [],
      mostRecentCommitTime: () => null,
    };
  }

  const prefix = getRootPrefix(root);
  const { authorsByPath, timeByPath } = buildPathIndex(root);

  return {
    available: true,
    repository: getRepository(root),
    commitRange: getCommitRange(root),
    authorsForPath(relPathFromRoot) {
      if (typeof relPathFromRoot !== 'string' || !relPathFromRoot) return [];
      const repoRel = prefix ? `${prefix}/${relPathFromRoot}` : relPathFromRoot;
      const set = authorsByPath.get(repoRel);
      return set ? [...set] : [];
    },
    // UNIX seconds of the most recent commit touching `relPathFromRoot`, or `null` when the path is untracked / history is unreadable.
    mostRecentCommitTime(relPathFromRoot) {
      if (typeof relPathFromRoot !== 'string' || !relPathFromRoot) return null;
      const repoRel = prefix ? `${prefix}/${relPathFromRoot}` : relPathFromRoot;
      const t = timeByPath.get(repoRel);
      return t === undefined ? null : t;
    },
  };
}

// Builds an "is this author attributable?" predicate for one certifying identity.
function buildAttributionPredicate(verifiedEmail, authorizedSet) {
  const target = String(verifiedEmail || '').trim().toLowerCase();
  const domainSuffix =
    authorizedSet && authorizedSet.domain
      ? `@${String(authorizedSet.domain).trim().toLowerCase()}`
      : null;
  const extra = new Set(
    authorizedSet && Array.isArray(authorizedSet.extraEmails)
      ? authorizedSet.extraEmails.map((e) => String(e).trim().toLowerCase())
      : [],
  );
  return (author) => {
    const a = String(author || '').toLowerCase();
    if (target && a === target) return true;
    if (domainSuffix && a.endsWith(domainSuffix)) return true;
    if (extra.has(a)) return true;
    return false;
  };
}

// Applies the ADR-017 gate (with the ADR-023 widening for test identities) to ONE sampled Skill.
function attributeSample(sample, verifiedEmail, authorship, authorizedSet = null) {
  const isAttributable = buildAttributionPredicate(verifiedEmail, authorizedSet);
  const files = Array.isArray(sample.files) ? sample.files : [];

  const consideredEmails = new Set();
  const attributableFiles = [];
  const fileAttribution = [];

  for (const file of files) {
    const authors = authorship.authorsForPath(file.path);
    for (const a of authors) consideredEmails.add(a);
    const attributed = authors.some((a) => isAttributable(a));
    if (attributed) attributableFiles.push(file);
    fileAttribution.push({ path: file.path, authors, attributed });
  }

  const authorEmails = [...consideredEmails].map((email) => ({
    email,
    matched: isAttributable(email),
  }));

  return {
    attributableFiles,
    authorEmails,
    fileAttribution,
    certifiable: attributableFiles.length > 0,
  };
}

module.exports = {
  collectAuthorship,
  AUTHORSHIP_LOG_ARGS,
  attributeSample,
  // exported for unit tests
  normalizeRemote,
  isGitRepo,
};
