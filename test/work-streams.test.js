'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { collectWorkStreams } = require('../src/work-streams');

function git(root, args, env = {}) {
  execFileSync('git', ['-C', root, ...args], {
    stdio: 'ignore',
    env: { ...process.env, ...env },
  });
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-streams-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  git(root, ['config', 'user.name', 'Dev']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  return root;
}

function commitAt(root, epochSeconds, message) {
  const iso = new Date(epochSeconds * 1000).toISOString();
  fs.writeFileSync(path.join(root, 'f.txt'), `${message}\n`);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', message], {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}

test('returns null outside a git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
  assert.equal(collectWorkStreams(dir), null);
});

test('returns null for an empty repo with no commits', () => {
  const root = initRepo();
  assert.equal(collectWorkStreams(root), null);
});

test('clusters close commits into ONE stream, far ones into another', () => {
  const root = initRepo();
  const base = 1_700_000_000;
  // Session A: three commits within an hour.
  commitAt(root, base, 'a1');
  commitAt(root, base + 600, 'a2');
  commitAt(root, base + 1200, 'a3');
  // Session B: two commits, five days later, within minutes.
  const later = base + 5 * 86400;
  commitAt(root, later, 'b1');
  commitAt(root, later + 300, 'b2');

  const out = collectWorkStreams(root);
  assert.equal(out.streamCount, 2);
  assert.equal(out.avgCommitsPerSession, 2.5);
  // Neither cluster spans a day internally.
  assert.equal(out.multiDayStreams, 0);
  assert.equal(out.maxStreamSpanDays, 0);
});

test('a stream that spans multiple days is counted as multi-day', () => {
  const root = initRepo();
  const base = 1_700_000_000;
  // Commits every 3h (< 4h gap) across ~2.5 days => ONE continuous stream.
  for (let i = 0; i < 20; i++) {
    commitAt(root, base + i * 3 * 3600, `c${i}`);
  }
  const out = collectWorkStreams(root);
  assert.equal(out.streamCount, 1);
  assert.equal(out.multiDayStreams, 1);
  assert.ok(out.maxStreamSpanDays >= 2);
  assert.equal(out.avgCommitsPerSession, 20);
});

test('emits no author emails, messages or paths — only the four numeric fields', () => {
  const root = initRepo();
  commitAt(root, 1_700_000_000, 'secret-branch-name');
  const out = collectWorkStreams(root);
  assert.deepEqual(
    Object.keys(out).sort(),
    ['avgCommitsPerSession', 'maxStreamSpanDays', 'multiDayStreams', 'streamCount'].sort(),
  );
  assert.ok(!JSON.stringify(out).includes('dev@example.com'));
  assert.ok(!JSON.stringify(out).includes('secret-branch-name'));
});
