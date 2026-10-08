'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  collectDetectionEvidence,
  normalizedDepth,
  DEPTH_FLOOR,
} = require('../src/detection-evidence');

const OWNER = 'me@shakersworks.com';
const OTHER = 'someone-else@example.com';

function git(root, args, env) {
  execFileSync('git', ['-C', root, ...args], {
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, ...env },
  });
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detection-evidence-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Tester']);
  git(root, ['config', 'user.email', OWNER]);
  git(root, ['config', 'commit.gpgsign', 'false']);
  return root;
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function commit(root, email) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'c'], {
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_NAME: 'A',
    GIT_COMMITTER_NAME: 'A',
  });
}

function daysAgoIso(d) {
  return new Date(Date.now() - d * 86400 * 1000).toISOString();
}

function commitAt(root, email, iso) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'c'], {
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_NAME: 'A',
    GIT_COMMITTER_NAME: 'A',
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  });
}

function pkg(deps) {
  return JSON.stringify({ dependencies: deps });
}

function agentFile(name, tools) {
  return `---\nname: ${name}\ntools: [${tools.join(', ')}]\nmodel: sonnet\n---\nbody text\n`;
}

// ---------------------------------------------------------------------------

test('normalizedDepth maps counts to (FLOOR,1] and null for no signal', () => {
  assert.equal(normalizedDepth(0, 3), null);
  assert.equal(normalizedDepth(null, 3), null);
  assert.equal(normalizedDepth(-2, 3), null);
  const shallow = normalizedDepth(1, 8);
  const deep = normalizedDepth(8, 8);
  assert.ok(shallow > 0 && shallow < deep);
  assert.equal(deep, 1);
  assert.ok(shallow >= DEPTH_FLOOR);
});

test('skill authorship: own manifest is authored, foreign manifest is known-but-not-authored', () => {
  const root = initRepo();
  // React declared in a manifest the OWNER wrote.
  write(root, 'package.json', pkg({ react: '18.0.0' }));
  commit(root, OWNER);
  // Express declared in a manifest a DIFFERENT author wrote.
  write(root, 'api/package.json', pkg({ express: '4.0.0' }));
  commit(root, OTHER);

  const evidence = collectDetectionEvidence(root, OWNER, { agents: [] });
  const byTech = Object.fromEntries(evidence.skills.map((s) => [s.tech, s]));

  assert.ok(byTech.React);
  assert.equal(byTech.React.authoredFileCount, 1);
  assert.equal(byTech.React.totalFileCount, 1);
  assert.equal(byTech.React.authorshipKnown, true);

  assert.ok(byTech.Express);
  assert.equal(byTech.Express.authoredFileCount, 0);
  assert.equal(byTech.Express.totalFileCount, 1);
  assert.equal(byTech.Express.authorshipKnown, true); // known, just not the talent's
});

test('skill depth grows with the number of manifests declaring the tech', () => {
  const root = initRepo();
  write(root, 'package.json', pkg({ react: '18.0.0' }));
  write(root, 'apps/web/package.json', pkg({ react: '18.0.0' }));
  write(root, 'apps/admin/package.json', pkg({ react: '18.0.0' }));
  write(root, 'lib/package.json', pkg({ express: '4.0.0' }));
  commit(root, OWNER);

  const evidence = collectDetectionEvidence(root, OWNER, { agents: [] });
  const byTech = Object.fromEntries(evidence.skills.map((s) => [s.tech, s]));

  assert.ok(byTech.React.depth > byTech.Express.depth);
  assert.equal(byTech.React.authoredFileCount, 3);
});

test('agent authorship: project agent attributed, agent depth from tool breadth', () => {
  const root = initRepo();
  write(root, '.claude/agents/planner.md', agentFile('planner', ['Read', 'Edit', 'Bash']));
  commit(root, OWNER);

  const report = {
    agents: [{ name: 'planner', tools: ['Read', 'Edit', 'Bash'], model: 'sonnet' }],
  };
  const evidence = collectDetectionEvidence(root, OWNER, report);

  assert.equal(evidence.agents.length, 1);
  const a = evidence.agents[0];
  assert.equal(a.name, 'planner');
  assert.deepEqual(a.tools, ['Read', 'Edit', 'Bash']);
  assert.equal(a.model, 'sonnet');
  assert.equal(a.authoredFileCount, 1);
  assert.equal(a.authorshipKnown, true);
  assert.ok(a.depth !== null && a.depth >= DEPTH_FLOOR);
});

test('agent not authored by the talent is known-but-excludable', () => {
  const root = initRepo();
  write(root, '.claude/agents/foreign.md', agentFile('foreign', ['Read']));
  commit(root, OTHER);

  const report = { agents: [{ name: 'foreign', tools: ['Read'], model: 'sonnet' }] };
  const evidence = collectDetectionEvidence(root, OWNER, report);

  const a = evidence.agents[0];
  assert.equal(a.authoredFileCount, 0);
  assert.equal(a.totalFileCount, 1);
  assert.equal(a.authorshipKnown, true);
});

test('non-git directory yields unknown authorship (neutral, never a penalty)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-de-'));
  write(dir, 'package.json', pkg({ react: '18.0.0' }));
  write(dir, '.claude/agents/planner.md', agentFile('planner', ['Read']));

  const report = { agents: [{ name: 'planner', tools: ['Read'], model: 'sonnet' }] };
  const evidence = collectDetectionEvidence(dir, OWNER, report);

  const react = evidence.skills.find((s) => s.tech === 'React');
  assert.equal(react.authorshipKnown, false);
  assert.equal(react.authoredFileCount, 0);
  assert.equal(evidence.agents[0].authorshipKnown, false);
});

test('no detections at all returns null (back-compat neutral)', () => {
  const root = initRepo();
  write(root, 'README.md', '# nothing to detect');
  commit(root, OWNER);
  assert.equal(collectDetectionEvidence(root, OWNER, { agents: [] }), null);
});

test('no email means nothing is attributable, but authorship stays known', () => {
  const root = initRepo();
  write(root, 'package.json', pkg({ react: '18.0.0' }));
  commit(root, OWNER);

  const evidence = collectDetectionEvidence(root, null, { agents: [] });
  const react = evidence.skills.find((s) => s.tech === 'React');
  assert.equal(react.authoredFileCount, 0);
  assert.equal(react.totalFileCount, 1);
  assert.equal(react.authorshipKnown, true);
});

test('anti-noise: candidates carry a vendored flag and the block carries provenance', () => {
  const root = initRepo();
  // A real, root manifest (not vendored) and a third_party one (vendored).
  write(root, 'package.json', pkg({ react: '18.0.0' }));
  write(root, 'third_party/dep/package.json', pkg({ express: '4.0.0' }));
  commit(root, OWNER);

  const evidence = collectDetectionEvidence(root, OWNER, { agents: [] });
  const byTech = Object.fromEntries(evidence.skills.map((s) => [s.tech, s]));

  assert.equal(byTech.React.vendored, false);
  assert.equal(byTech.Express.vendored, true); // only evidence is under third_party/

  // provenance rides the block (no fork/boilerplate in this fixture).
  assert.deepEqual(evidence.provenance, {
    fork: false,
    forkSignal: null,
    boilerplate: false,
    boilerplateMarker: null,
  });
});

test('recency: recent evidence yields small days-ago, older evidence a larger one', () => {
  const root = initRepo();
  write(root, 'package.json', pkg({ react: '18.0.0' }));
  commitAt(root, OWNER, daysAgoIso(10));
  write(root, 'api/package.json', pkg({ express: '4.0.0' }));
  commitAt(root, OWNER, daysAgoIso(400));

  const evidence = collectDetectionEvidence(root, OWNER, { agents: [] });
  const byTech = Object.fromEntries(evidence.skills.map((s) => [s.tech, s]));

  assert.ok(byTech.React.recencyDays >= 9 && byTech.React.recencyDays <= 11);
  assert.ok(byTech.Express.recencyDays >= 398);
  assert.ok(byTech.React.recencyDays < byTech.Express.recencyDays);
});

test('recency: non-git directory yields null (neutral, back-compat)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-rec-'));
  write(dir, 'package.json', pkg({ react: '18.0.0' }));
  write(dir, '.claude/agents/planner.md', agentFile('planner', ['Read']));
  const report = { agents: [{ name: 'planner', tools: ['Read'], model: 'sonnet' }] };
  const evidence = collectDetectionEvidence(dir, OWNER, report);
  assert.equal(evidence.skills.find((s) => s.tech === 'React').recencyDays, null);
  assert.equal(evidence.agents[0].recencyDays, null);
});

test('anti-noise: provenance flags a boilerplate repo', () => {
  const root = initRepo();
  write(root, 'package.json', pkg({ react: '18.0.0' }));
  write(root, 'README.md', 'This project was bootstrapped with Create React App.');
  commit(root, OWNER);

  const evidence = collectDetectionEvidence(root, OWNER, { agents: [] });
  assert.equal(evidence.provenance.boilerplate, true);
  assert.equal(evidence.provenance.boilerplateMarker, 'create-react-app');
});
