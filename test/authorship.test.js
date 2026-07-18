'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { collectAuthorship, attributeSample, normalizeRemote, isGitRepo } = require('../src/authorship');

/*
 * skill-code-certification, ADR-017: verified-authorship gate. These exercise
 * the real `git` binary against throwaway repos, so they prove the attribution
 * decision the CLI relies on — file-level author match, case-insensitive.
 */

function git(dir, args, email) {
  execFileSync('git', ['-C', dir, ...args], {
    stdio: 'ignore',
    env: email
      ? { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: email }
      : process.env,
  });
}

function makeRepo(files, email) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authorship-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', email]);
  git(dir, ['config', 'user.name', 'T']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init'], email);
  return dir;
}

test('normalizeRemote strips .git, userinfo (tokens), and scheme', () => {
  assert.equal(normalizeRemote('git@github.com:acme/widgets.git'), 'github.com/acme/widgets');
  assert.equal(normalizeRemote('https://github.com/acme/widgets.git'), 'github.com/acme/widgets');
  // an embedded token in the userinfo must be dropped, never returned
  assert.equal(normalizeRemote('https://x-token:secret@github.com/acme/widgets.git'), 'github.com/acme/widgets');
});

test('isGitRepo is false for a plain directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
  try {
    assert.equal(isGitRepo(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectAuthorship: unavailable for a non-git directory (drives the hard refusal)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
  try {
    const a = collectAuthorship(dir);
    assert.equal(a.available, false);
    assert.deepEqual(a.authorsForPath('src/a.js'), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectAuthorship: maps each tracked file to its author-emails (lower-cased)', () => {
  const dir = makeRepo({ 'src/a.js': 'a\n', 'src/b.js': 'b\n' }, 'Talent@Example.com');
  try {
    const a = collectAuthorship(dir);
    assert.equal(a.available, true);
    assert.deepEqual(a.authorsForPath('src/a.js'), ['talent@example.com']);
    assert.deepEqual(a.authorsForPath('unknown.js'), []);
    assert.ok(a.commitRange && a.commitRange.length > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attributeSample: keeps only files the verified email authored, case-insensitively', () => {
  const dir = makeRepo({ 'src/a.js': 'a\n', 'src/b.js': 'b\n' }, 'talent@example.com');
  try {
    const authorship = collectAuthorship(dir);
    const sample = {
      files: [
        { path: 'src/a.js', content: 'a' },
        { path: 'src/b.js', content: 'b' },
      ],
    };
    // Match despite different case in the certifying email.
    const res = attributeSample(sample, 'TALENT@example.com', authorship);
    assert.equal(res.certifiable, true);
    assert.equal(res.attributableFiles.length, 2);
    assert.deepEqual(res.authorEmails, [{ email: 'talent@example.com', matched: true }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attributeSample: a sample authored by someone else is NOT certifiable, but records the considered author', () => {
  const dir = makeRepo({ 'src/a.js': 'a\n' }, 'other@contrib.com');
  try {
    const authorship = collectAuthorship(dir);
    const sample = { files: [{ path: 'src/a.js', content: 'a' }] };
    const res = attributeSample(sample, 'talent@example.com', authorship);
    assert.equal(res.certifiable, false);
    assert.equal(res.attributableFiles.length, 0);
    assert.deepEqual(res.authorEmails, [{ email: 'other@contrib.com', matched: false }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
