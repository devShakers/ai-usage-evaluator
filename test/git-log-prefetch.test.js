'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const util = require('util');

const { prefetchGitLogs, takePrefetchedGitLog } = require('../src/git-log-prefetch');
const { collectGitActivity, GIT_ACTIVITY_LOG_ARGS } = require('../src/git-activity');
const { collectWorkStreams, WORK_STREAMS_LOG_ARGS } = require('../src/work-streams');
const { collectAuthorship, AUTHORSHIP_LOG_ARGS } = require('../src/authorship');

const ALL_ARGS = [GIT_ACTIVITY_LOG_ARGS, WORK_STREAMS_LOG_ARGS, AUTHORSHIP_LOG_ARGS];

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefetch-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'ada@example.com');
  git('config', 'user.name', 'Ada');
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.js`), `line ${i}\n`.repeat(i + 1));
    git('add', '.');
    git('commit', '-q', '-m', `c${i}`);
  }
  return dir;
}

test('prefetched logs are byte-identical to the collectors own synchronous run', async () => {
  const repo = makeRepo();
  const direct = {
    activity: collectGitActivity(repo, 'ada@example.com'),
    streams: collectWorkStreams(repo),
    authorship: collectAuthorship(repo),
  };

  await prefetchGitLogs([repo], ALL_ARGS);
  const viaPrefetch = {
    activity: collectGitActivity(repo, 'ada@example.com'),
    streams: collectWorkStreams(repo),
    authorship: collectAuthorship(repo),
  };

  // Full-depth rendering: the authorship index holds Maps/Sets, compared by content here.
  const render = (v) => util.inspect(v, { depth: null, sorted: true, maxArrayLength: null, maxStringLength: null });
  assert.equal(render(viaPrefetch), render(direct));
  fs.rmSync(repo, { recursive: true, force: true });
});

test('a prefetched log is served once, then the collector runs git itself again', async () => {
  const repo = makeRepo();
  await prefetchGitLogs([repo], [WORK_STREAMS_LOG_ARGS]);
  assert.equal(typeof takePrefetchedGitLog(repo, WORK_STREAMS_LOG_ARGS), 'string');
  assert.equal(takePrefetchedGitLog(repo, WORK_STREAMS_LOG_ARGS), undefined);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('a failed prefetch (not a repo) stores nothing, so the collector keeps its own fallback', async () => {
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'prefetch-none-'));
  await prefetchGitLogs([notRepo], ALL_ARGS);
  for (const args of ALL_ARGS) assert.equal(takePrefetchedGitLog(notRepo, args), undefined);
  assert.equal(collectGitActivity(notRepo, 'ada@example.com'), null);
  fs.rmSync(notRepo, { recursive: true, force: true });
});

test('prefetchGitLogs with no roots is a no-op that never throws', async () => {
  await prefetchGitLogs([], ALL_ARGS);
  await prefetchGitLogs(undefined, ALL_ARGS);
});
