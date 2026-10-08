'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectRepos,
  matchReposByFlag,
  scopeFromSelection,
  indexOfCurrentRepo,
} = require('../src/detect-repos');

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'detect-repos-'));
}

function writeSession(home, tool, name, lines) {
  const dirs = {
    claude: path.join(home, '.claude', 'projects', 'proj'),
    codex: path.join(home, '.codex', 'sessions'),
    cursor: path.join(home, '.cursor', 'chats'),
  };
  const dir = dirs[tool];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    lines.map((l) => JSON.stringify(l)).join('\n'),
  );
}

// Maps a cwd to a fake { toplevel, remote }. Unknown cwd => git "fails" (null).
function fakeGit(map) {
  return (cwd, args) => {
    const e = map[cwd];
    if (!e) return null;
    if (args[0] === 'rev-parse') return e.toplevel || null;
    if (args[0] === 'config') return e.remote || null;
    return null;
  };
}

test('detects distinct repos with per-repo session counts', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [{ cwd: '/work/repo-a' }]);
  writeSession(home, 'claude', 'b.jsonl', [{ cwd: '/work/repo-a' }]);
  writeSession(home, 'codex', 'c.jsonl', [{ cwd: '/work/repo-b' }]);

  const gitRunner = fakeGit({
    '/work/repo-a': { toplevel: '/work/repo-a', remote: 'git@host/owner/repo-a' },
    '/work/repo-b': { toplevel: '/work/repo-b', remote: 'git@host/owner/repo-b' },
  });
  const { repos, unassignedSessionCount } = detectRepos(
    { SHAKERS_CLI_HOME_DIR: home },
    { gitRunner },
  );

  assert.equal(unassignedSessionCount, 0);
  assert.equal(repos.length, 2);
  const a = repos.find((r) => r.toplevel === '/work/repo-a');
  assert.equal(a.sessionCount, 2);
  assert.equal(a.remote, 'git@host/owner/repo-a');
  assert.deepEqual(a.cwds, ['/work/repo-a']);
});

test('monorepo: sub-directory cwds collapse into ONE repo by toplevel', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [{ cwd: '/mono/apps/web' }]);
  writeSession(home, 'claude', 'b.jsonl', [{ cwd: '/mono/packages/ui' }]);

  const gitRunner = fakeGit({
    '/mono/apps/web': { toplevel: '/mono', remote: 'git@host/owner/mono' },
    '/mono/packages/ui': { toplevel: '/mono', remote: 'git@host/owner/mono' },
  });
  const { repos } = detectRepos({ SHAKERS_CLI_HOME_DIR: home }, { gitRunner });

  assert.equal(repos.length, 1);
  assert.equal(repos[0].toplevel, '/mono');
  assert.equal(repos[0].sessionCount, 2);
  assert.deepEqual(repos[0].cwds, ['/mono/apps/web', '/mono/packages/ui']);
});

test('sessions with no attributable cwd are counted as unassigned, not a repo', () => {
  const home = makeHome();
  writeSession(home, 'cursor', 'a.jsonl', [
    { message: { content: [{ type: 'text', text: 'hi' }] } },
  ]);
  writeSession(home, 'claude', 'b.jsonl', [{ cwd: '/work/repo-a' }]);

  const gitRunner = fakeGit({
    '/work/repo-a': { toplevel: '/work/repo-a', remote: null },
  });
  const { repos, unassignedSessionCount } = detectRepos(
    { SHAKERS_CLI_HOME_DIR: home },
    { gitRunner },
  );

  assert.equal(unassignedSessionCount, 1);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].toplevel, '/work/repo-a');
});

test('a moved/gone repo (git fails) falls back to cwd as its own group', () => {
  const home = makeHome();
  writeSession(home, 'claude', 'a.jsonl', [{ cwd: '/gone/repo-x' }]);
  const gitRunner = fakeGit({}); // every git call returns null
  const { repos } = detectRepos({ SHAKERS_CLI_HOME_DIR: home }, { gitRunner });

  assert.equal(repos.length, 1);
  assert.equal(repos[0].toplevel, null);
  assert.equal(repos[0].resolved, false);
  assert.equal(repos[0].id, '/gone/repo-x');
  assert.deepEqual(repos[0].cwds, ['/gone/repo-x']);
});

test('matchReposByFlag matches by remote/toplevel/basename and reports unmatched', () => {
  const repos = [
    { id: 'git@host/owner/repo-a', toplevel: '/work/repo-a', remote: 'git@host/owner/repo-a', label: 'git@host/owner/repo-a', cwds: ['/work/repo-a'], sessionCount: 2 },
    { id: '/work/repo-b', toplevel: '/work/repo-b', remote: null, label: 'repo-b', cwds: ['/work/repo-b'], sessionCount: 1 },
  ];
  const byBasename = matchReposByFlag(repos, ['repo-a']);
  assert.deepEqual(byBasename.indices, [0]);
  const byPath = matchReposByFlag(repos, ['/work/repo-b']);
  assert.deepEqual(byPath.indices, [1]);
  const withUnmatched = matchReposByFlag(repos, ['repo-a', 'nope']);
  assert.deepEqual(withUnmatched.indices, [0]);
  assert.deepEqual(withUnmatched.unmatched, ['nope']);
});

test('scopeFromSelection unions cwds and lists toplevels; indexOfCurrentRepo finds the cwd repo', () => {
  const repos = [
    { id: 'a', toplevel: '/work/repo-a', remote: null, label: 'repo-a', cwds: ['/work/repo-a', '/work/repo-a/sub'], sessionCount: 2 },
    { id: 'b', toplevel: '/work/repo-b', remote: null, label: 'repo-b', cwds: ['/work/repo-b'], sessionCount: 1 },
  ];
  const scope = scopeFromSelection(repos, [0]);
  assert.deepEqual([...scope.selectedCwds].sort(), ['/work/repo-a', '/work/repo-a/sub']);
  assert.deepEqual(scope.selectedToplevels, ['/work/repo-a']);
  assert.equal(indexOfCurrentRepo(repos, '/work/repo-b'), 1);
  assert.equal(indexOfCurrentRepo(repos, '/nope'), -1);
});
