'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { getRemoteUrl, normalizeRemoteUrl, getCommitDateRange } = require('../src/portfolio-git-info');

// talents-ai-score, ADR-059 — step 4 (URL ← git remote) and the AUTO startDate/endDate (git history).

function git(dir, args, env) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', env: env || process.env });
}

function makeRepo({ remote = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-git-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'T']);
  if (remote) git(dir, ['remote', 'add', 'origin', remote]);
  return dir;
}

function commit(dir, file, content, date) {
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, ['add', '-A']);
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  git(dir, ['commit', '-q', '-m', file], env);
}

/* ---------------- normalizeRemoteUrl (pure) ---------------- */

test('normalizeRemoteUrl: scp-style ssh -> https, .git stripped', () => {
  assert.equal(normalizeRemoteUrl('git@github.com:acme/widgets.git'), 'https://github.com/acme/widgets');
});

test('normalizeRemoteUrl: https with embedded credentials -> creds stripped, scheme KEPT', () => {
  assert.equal(normalizeRemoteUrl('https://x-token:secret@github.com/acme/widgets.git'), 'https://github.com/acme/widgets');
});

test('normalizeRemoteUrl: http (rare) is kept as http, never upgraded', () => {
  assert.equal(normalizeRemoteUrl('http://internal.example.com/acme/widgets.git'), 'http://internal.example.com/acme/widgets');
});

test('normalizeRemoteUrl: an unrecognized scheme (e.g. ssh://) -> null, never a guess', () => {
  assert.equal(normalizeRemoteUrl('ssh://git@example.com/acme/widgets.git'), null);
});

/* ---------------- getRemoteUrl (real git) ---------------- */

test('getRemoteUrl: no git / not a repo -> null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
  try {
    assert.equal(getRemoteUrl(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getRemoteUrl: a repo with NO origin remote -> null', () => {
  const dir = makeRepo();
  try {
    assert.equal(getRemoteUrl(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getRemoteUrl: reads and normalizes the real `origin` remote', () => {
  const dir = makeRepo({ remote: 'git@github.com:acme/widgets.git' });
  try {
    assert.equal(getRemoteUrl(dir), 'https://github.com/acme/widgets');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------- getCommitDateRange (real git) ---------------- */

test('getCommitDateRange: no git / no commits -> both null, never a crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
  try {
    assert.deepEqual(getCommitDateRange(dir), { startDate: null, endDate: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getCommitDateRange: an initialized repo with NO commits yet -> both null', () => {
  const dir = makeRepo();
  try {
    assert.deepEqual(getCommitDateRange(dir), { startDate: null, endDate: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getCommitDateRange: first and last commit dates, as YYYY-MM-DD', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'a.txt', 'a', '2026-01-15T10:00:00+00:00');
    commit(dir, 'b.txt', 'b', '2026-06-30T10:00:00+00:00');
    commit(dir, 'c.txt', 'c', '2026-08-01T10:00:00+00:00');
    assert.deepEqual(getCommitDateRange(dir), { startDate: '2026-01-15', endDate: '2026-08-01' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('getCommitDateRange: a SINGLE commit -> startDate === endDate', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'a.txt', 'a', '2026-03-01T10:00:00+00:00');
    assert.deepEqual(getCommitDateRange(dir), { startDate: '2026-03-01', endDate: '2026-03-01' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
