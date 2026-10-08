'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { collectGitActivity, extensionOf } = require('../src/git-activity');

function git(root, args, env) {
  execFileSync('git', ['-C', root, ...args], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, ...env },
  });
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-activity-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Tester']);
  git(root, ['config', 'user.email', 'me@shakersworks.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  return root;
}

function commit(root, files, { email, name, date } = {}) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  git(root, ['add', '-A']);
  const env = {};
  if (email) {
    env.GIT_AUTHOR_EMAIL = email;
    env.GIT_COMMITTER_EMAIL = email;
  }
  if (name) {
    env.GIT_AUTHOR_NAME = name;
    env.GIT_COMMITTER_NAME = name;
  }
  if (date) {
    env.GIT_AUTHOR_DATE = date;
    env.GIT_COMMITTER_DATE = date;
  }
  git(root, ['commit', '-q', '-m', 'c'], env);
}

test('extensionOf normalizes extension, handles renames and no-extension', () => {
  assert.equal(extensionOf('src/foo.TS'), 'ts');
  assert.equal(extensionOf('Makefile'), 'none');
  assert.equal(extensionOf('src/{a => b}/file.js'), 'js');
});

test('returns null outside a git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
  assert.equal(collectGitActivity(dir, 'me@shakersworks.com'), null);
});

test('counts commits, authored commits, lines and file types', () => {
  const root = initRepo();
  commit(
    root,
    { 'a.ts': 'const a = 1;\nconst b = 2;\n', 'r.md': '# hi\n' },
    { email: 'me@shakersworks.com', date: '2026-01-01T00:00:00' },
  );
  commit(
    root,
    { 'a.ts': 'const a = 1;\n' },
    { email: 'other@example.com', name: 'Other', date: '2026-01-11T00:00:00' },
  );

  const out = collectGitActivity(root, 'me@shakersworks.com');
  assert.equal(out.commitCount, 2);
  assert.equal(out.authoredCommitCount, 1);
  assert.equal(out.linesAdded, 3);
  assert.equal(out.linesDeleted, 1);
  assert.equal(out.filesByType.ts, 2);
  assert.equal(out.filesByType.md, 1);
  assert.equal(out.spanDays, 10);
  assert.equal(out.velocity, 0.2);
});

test('third-party author emails are never emitted, only counted as non-authored', () => {
  const root = initRepo();
  commit(root, { 'x.js': 'x\n' }, { email: 'me@shakersworks.com' });
  commit(root, { 'y.js': 'y\n' }, { email: 'secret@thirdparty.com', name: 'Third' });

  const out = collectGitActivity(root, 'me@shakersworks.com');
  assert.equal(out.authoredCommitCount, 1);
  assert.equal(out.commitCount, 2);
  assert.ok(!JSON.stringify(out).includes('thirdparty'));
});
