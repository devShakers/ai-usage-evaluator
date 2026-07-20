'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/*
 * Git AUTHORSHIP + provenance for the certify phase (skill-code-certification,
 * ADR-017). The certification is only meaningful if the sampled code is
 * ACTUALLY the Talent's: this module reads local git history to decide, per
 * sampled file, which author-emails wrote it — the input to the HARD GATE in
 * bin/certify.js ("sin email atribuible, no hay certificación").
 *
 * Zero-dependency invariant preserved: node stdlib + the local `git` binary
 * only (execFileSync — never a shell string, so paths/emails can't be
 * injected). Every git call is defensive: any failure (no git, not a repo,
 * shallow/squashed history, git absent from PATH) resolves to a SAFE EMPTY
 * result, never throws — the caller turns "no attribution" into a clean
 * refusal, not a crash.
 *
 * ATTRIBUTION MODEL (ADR-017 v1, deliberately file-level, not line-level):
 * a file is "attributable" to an email when that email appears as an AUTHOR of
 * ANY commit touching the file (case-insensitive). Line-level blame ("the
 * Talent wrote most of the sampled content") is future hardening — file-level
 * author match is the v1 gate.
 */

const GIT_TIMEOUT_MS = 15000;
const SHORT_SHA_LEN = 10;

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

// Repo identity for the evidence record. Prefers the `origin` remote URL
// (normalized to `host/owner/repo`, secret-free — a token embedded in an
// https remote is stripped); falls back to the toplevel directory name. `null`
// when neither is available.
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

// The path git sees for a file is repo-relative; the sampler's paths are
// relative to `root`, which may be a SUBDIR of the repo. `git rev-parse
// --show-prefix` gives the subdir (empty when root IS the repo top).
function getRootPrefix(root) {
  const prefix = runGit(root, ['rev-parse', '--show-prefix']);
  return prefix && prefix.trim() ? prefix.trim().replace(/\/+$/, '') : '';
}

/**
 * ONE `git log` pass over the whole history, mapping every tracked file
 * (repo-relative POSIX path) to the set of author-emails that touched it. A
 * `\x01`-sentinel before each author line disambiguates it from the file
 * paths git prints under `--name-only`. Emails are lower-cased for
 * case-insensitive matching. Returns an empty Map on any failure.
 */
function buildAuthorsByPath(root) {
  const out = new Map();
  const log = runGit(root, [
    'log',
    '--no-merges',
    '--pretty=format:\x01%ae',
    '--name-only',
  ]);
  if (log === null) return out;

  let current = null;
  for (const rawLine of log.split('\n')) {
    if (rawLine.startsWith('\x01')) {
      current = rawLine.slice(1).trim().toLowerCase();
      continue;
    }
    const file = rawLine.trim();
    if (!file || current === null) continue;
    let set = out.get(file);
    if (!set) {
      set = new Set();
      out.set(file, set);
    }
    set.add(current);
  }
  return out;
}

/**
 * Full authorship context for `root`, collected ONCE per run. Shape:
 *   {
 *     available: boolean,        // false => cannot attribute (no git / squashed / no history)
 *     repository: string|null,
 *     commitRange: string|null,
 *     authorsForPath(relPathFromRoot): string[]  // lower-cased emails, [] if unknown
 *   }
 * `available:false` is the signal the caller turns into the hard-gate refusal.
 * A repo with git but a squashed/rewritten history simply yields empty author
 * sets per file, so files come back non-attributable — same clean refusal.
 */
function collectAuthorship(root) {
  if (!isGitRepo(root)) {
    return {
      available: false,
      repository: null,
      commitRange: null,
      authorsForPath: () => [],
    };
  }

  const prefix = getRootPrefix(root);
  const authorsByPath = buildAuthorsByPath(root);

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
  };
}

/**
 * Builds an "is this author attributable?" predicate for one certifying
 * identity. Base rule (ADR-017): the author IS the identity's own verified
 * email. ADR-023 WIDENING — applied ONLY when `authorizedSet` is non-null (the
 * server returns one for TEST identities only, never for a real identity): an
 * author is also attributable if its email is in the domain (`*@<domain>`) or
 * the extra-email list. All comparisons case-insensitive. This is NOT a bypass:
 * authors outside the set are still dropped, and a sample with zero in-set
 * authors is still non-certifiable.
 */
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

/**
 * Applies the ADR-017 gate (with the ADR-023 widening for test identities) to
 * ONE sampled Skill. `authorizedSet` is the server-returned authorized authoring
 * set for a TEST identity, or `null`/undefined for a real identity (strict
 * single-email match — unchanged). Returns:
 *   {
 *     attributableFiles: [{path, content, ...}],   // files attributable to the identity
 *     authorEmails: [{email, matched}],            // ALL considered authors + attribution flag
 *     fileAttribution: [{path, authors[], attributed}], // EVERY sampled file → its git authors + ✓/✗ (ADR-025 receipt)
 *     certifiable: boolean,                        // at least one attributable file
 *   }
 * Only `attributableFiles` are ever sent to the model — code outside the
 * authorized set never leaves the machine for certification. `authorEmails` is
 * the persisted EVIDENCE of the decision; `fileAttribution` is the per-file
 * attribution trail shown in the ADR-025 receipt (NOT persisted — an at-certify
 * -time display artifact; git authorship is self-asserted, not cryptographic
 * proof).
 */
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
  attributeSample,
  // exported for unit tests
  normalizeRemote,
  isGitRepo,
};
