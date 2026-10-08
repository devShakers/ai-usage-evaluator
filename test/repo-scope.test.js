'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveRepoScope,
  machineWideToplevels,
  promptScope,
} = require('../bin/ai-usage');
const { getCatalog } = require('../src/i18n');

const catalog = getCatalog('en');

// A repoIdentityForCwd double: maps a cwd to a git toplevel, or null when the
// cwd is not a repo (mirrors the real fn's shape { toplevel, remote }).
function repoIdentity(map) {
  return (cwd) => ({ toplevel: map[cwd] || null, remote: null });
}

function detectReposFn(repos, unassigned = 0) {
  return () => ({ repos, unassignedSessionCount: unassigned });
}

function baseOpts(over = {}) {
  return {
    json: true, // keep stdout quiet in tests (notes are gated on !json)
    repos: null,
    allRepos: false,
    machine: false,
    repo: false,
    scope: null,
    ...over,
  };
}

test('machineWideToplevels: current repo leads, detected follow, deduped', () => {
  const cwdTop = '/home/u/proj-a';
  const detected = [
    { toplevel: '/home/u/proj-b' },
    { toplevel: '/home/u/proj-a' }, // dup of cwd → dropped
    { toplevel: '/home/u/proj-c' },
  ];
  const mw = machineWideToplevels(cwdTop, detected);
  assert.deepEqual(mw.toplevels, ['/home/u/proj-a', '/home/u/proj-b', '/home/u/proj-c']);
  assert.equal(mw.capped, false);
});

test('machineWideToplevels: refused system roots are dropped', () => {
  const mw = machineWideToplevels(null, [
    { toplevel: '/' },
    { toplevel: '/System' },
    { toplevel: '/home/u/real' },
  ]);
  assert.deepEqual(mw.toplevels, ['/home/u/real']);
});

test('machineWideToplevels: caps and reports total', () => {
  const detected = Array.from({ length: 8 }, (_, i) => ({ toplevel: `/r/${i}` }));
  const mw = machineWideToplevels(null, detected, 5);
  assert.equal(mw.toplevels.length, 5);
  assert.equal(mw.total, 8);
  assert.equal(mw.capped, true);
});

test('resolveRepoScope: --machine → mode all, spans detected + current repo', async () => {
  const scope = await resolveRepoScope({
    opts: baseOpts({ machine: true }),
    cwd: '/home/u/proj-a',
    catalog,
    detectReposFn: detectReposFn([{ toplevel: '/home/u/proj-b' }]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    chooseScope: async () => { throw new Error('picker must not fire with a flag'); },
    isTTY: true,
  });
  assert.equal(scope.mode, 'all');
  assert.equal(scope.selectedCwds, null); // sessions machine-wide
  assert.deepEqual(scope.toplevels, ['/home/u/proj-a', '/home/u/proj-b']);
});

test('resolveRepoScope: --all-repos is an alias of --machine', async () => {
  const scope = await resolveRepoScope({
    opts: baseOpts({ allRepos: true }),
    cwd: '/home/u/proj-a',
    catalog,
    detectReposFn: detectReposFn([{ toplevel: '/home/u/proj-b' }]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    isTTY: false,
  });
  assert.equal(scope.mode, 'all');
  assert.ok(scope.toplevels.includes('/home/u/proj-b'));
});

test('resolveRepoScope: --repo / --scope repo → current repo, no picker', async () => {
  for (const opts of [baseOpts({ repo: true }), baseOpts({ scope: 'repo' })]) {
    const scope = await resolveRepoScope({
      opts,
      cwd: '/home/u/proj-a',
      catalog,
      detectReposFn: detectReposFn([{ toplevel: '/home/u/proj-a', cwds: ['/home/u/proj-a'] }]),
      repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
      chooseScope: async () => { throw new Error('picker must not fire with a flag'); },
      isTTY: true,
    });
    assert.equal(scope.mode, 'cwd');
  }
});

test('resolveRepoScope: --scope machine forces machine-wide', async () => {
  const scope = await resolveRepoScope({
    opts: baseOpts({ scope: 'machine' }),
    cwd: '/home/u/proj-a',
    catalog,
    detectReposFn: detectReposFn([{ toplevel: '/home/u/proj-b' }]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    isTTY: false,
  });
  assert.equal(scope.mode, 'all');
});

test('resolveRepoScope: TTY + no flag → picker fires; machine choice → all', async () => {
  let called = 0;
  const scope = await resolveRepoScope({
    opts: baseOpts({ json: false }),
    cwd: '/home/u/proj-a',
    catalog,
    detectReposFn: detectReposFn([{ toplevel: '/home/u/proj-b' }]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    chooseScope: async () => { called += 1; return 'machine'; },
    isTTY: true,
  });
  assert.equal(called, 1);
  assert.equal(scope.mode, 'all');
});

test('resolveRepoScope: picker "repo" choice → current repo', async () => {
  const scope = await resolveRepoScope({
    opts: baseOpts({ json: false }),
    cwd: '/home/u/proj-a',
    catalog,
    detectReposFn: detectReposFn([{ toplevel: '/home/u/proj-a', cwds: ['/home/u/proj-a'] }]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    chooseScope: async () => 'repo',
    isTTY: true,
  });
  assert.equal(scope.mode, 'cwd');
});

test('resolveRepoScope: picker aborted (null) → defaults to current repo', async () => {
  const scope = await resolveRepoScope({
    opts: baseOpts({ json: false }),
    cwd: '/home/u/proj-a',
    catalog,
    detectReposFn: detectReposFn([]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    chooseScope: async () => null,
    isTTY: true,
  });
  assert.equal(scope.mode, 'cwd');
});

test('resolveRepoScope: non-TTY, no flag → current repo, picker never called', async () => {
  let called = 0;
  const scope = await resolveRepoScope({
    opts: baseOpts({ json: false }),
    cwd: '/home/u/proj-a',
    catalog,
    detectReposFn: detectReposFn([]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    chooseScope: async () => { called += 1; return 'machine'; },
    isTTY: false,
  });
  assert.equal(called, 0);
  assert.equal(scope.mode, 'cwd');
});

test('resolveRepoScope: injected ask (register/onboarding path) never prompts', async () => {
  let called = 0;
  const scope = await resolveRepoScope({
    opts: baseOpts({ json: false }),
    cwd: '/home/u/proj-a',
    injectedAsk: async () => '', // register passes an ask
    catalog,
    detectReposFn: detectReposFn([]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    chooseScope: async () => { called += 1; return 'machine'; },
    isTTY: true,
  });
  assert.equal(called, 0); // no picker on the shared path
  assert.equal(scope.mode, 'cwd');
});

test('resolveRepoScope: explicit --repos LIST wins over everything', async () => {
  const scope = await resolveRepoScope({
    opts: baseOpts({ repos: ['proj-b'], machine: true }),
    cwd: '/home/u/proj-a',
    catalog,
    detectReposFn: detectReposFn([
      { id: '/home/u/proj-b', toplevel: '/home/u/proj-b', remote: null, label: 'proj-b', cwds: ['/home/u/proj-b'] },
    ]),
    repoIdentityFn: repoIdentity({ '/home/u/proj-a': '/home/u/proj-a' }),
    chooseScope: async () => { throw new Error('picker must not fire'); },
    isTTY: true,
  });
  assert.equal(scope.mode, 'flag');
  assert.deepEqual(scope.toplevels, ['/home/u/proj-b']);
});

test('promptScope: non-TTY fallback maps numbers to scope keys', async () => {
  const mk = (answer) => () => Object.assign(async () => answer, {});
  assert.equal(await promptScope({ catalog, stdinIsTTY: false, mkAsk: mk('1') }), 'machine');
  assert.equal(await promptScope({ catalog, stdinIsTTY: false, mkAsk: mk('2') }), 'repo');
  assert.equal(await promptScope({ catalog, stdinIsTTY: false, mkAsk: mk('nope') }), null);
});
