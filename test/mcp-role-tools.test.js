'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeRoleTools } = require('../src/mcp-role-tools');
const { normalizeRole } = require('../src/roles-client');

const SESSION = { accessToken: 'certs-jwt', hubAccessToken: 'hub-jwt' };
const IMPORT = { clusterId: 'backend', clusterName: 'Backend Developer', category: 'tech', type: 'RECOMMENDED', source: 'IMPORT' };
const INTERVIEW = { clusterId: 'ai-eng', clusterName: 'AI Engineer', category: 'tech', type: 'RECOMMENDED', source: 'ONBOARDING_INTERVIEW' };
const GROWTH = { clusterId: 'pm', clusterName: 'Product Manager', category: 'product', type: 'GROWTH', source: 'TALENT' };

// A clock the fake sleep advances, so bounded waits run instantly.
function harness({ clusters = () => [], finalization = () => ({ ok: true, status: 'READY' }), interview = null, setMain = async () => ({ ok: true }) } = {}) {
  let t = 0;
  const calls = { finalization: [], clusters: 0, setMain: [] };
  const tools = makeRoleTools({
    loadAuthSession: () => SESSION,
    sessionStatus: () => 'active',
    getAvailableRolesEndpoint: () => 'https://hub/available',
    getSetMainRoleEndpoint: () => 'https://hub/main-role',
    getAssignedClustersEndpoint: () => 'https://hub/assigned',
    getMyCertificationsEndpoint: () => 'https://hub/certs-me',
    getOnboardingInterviewsEndpoint: () => 'https://certs/interviews',
    requestMeCertifications: async () => ({ ok: true, mainRole: null, growingInto: [] }),
    requestAssignedClusters: async () => { calls.clusters += 1; return { ok: true, clusters: clusters(t).map(normalizeRole) }; },
    requestInterviewFinalization: async (args, opts) => { calls.finalization.push({ args, opts }); return finalization(t); },
    requestSetMainRole: async (args) => { calls.setMain.push(args); return setMain(args); },
    completedOnboardingInterview: () => interview,
    sleep: async (ms) => { t += ms; },
    now: () => t,
  });
  return { tools: Object.fromEntries(tools.map((x) => [x.name, x])), calls, at: (ms) => { t = ms; } };
}

test('normalizeRole: the hub assigned-clusters row names the role in clusterName and says where it came from', () => {
  assert.deepEqual(normalizeRole(IMPORT), { clusterId: 'backend', name: 'Backend Developer', category: 'tech', proposalKind: null, type: 'RECOMMENDED', source: 'IMPORT' });
});

test('list_my_roles: recommended roles come named, interview signal before the CV, without waiting when nothing is finalizing', async () => {
  const { tools, calls } = harness({ clusters: () => [GROWTH, IMPORT, INTERVIEW] });
  const r = await tools.list_my_roles.handler({ waitSeconds: 20 });
  assert.deepEqual(r.recommended.map((x) => [x.clusterId, x.name, x.source]), [['ai-eng', 'AI Engineer', 'ONBOARDING_INTERVIEW'], ['backend', 'Backend Developer', 'IMPORT']]);
  assert.equal(r.pending, false);
  assert.equal(calls.clusters, 1);
  assert.match(r.message, /set_main_role/);
  assert.doesNotMatch(JSON.stringify(r.roles), /"name":null/);
});

test('list_my_roles: after an interview it waits for its evaluation to finalize, then reads what it recommended', async () => {
  const { tools, calls } = harness({
    interview: { interviewId: 'iv-1', completedAt: 0 },
    finalization: (t) => ({ ok: true, status: t < 6000 ? 'PROCESSING' : 'READY' }),
    clusters: (t) => (t < 6000 ? [IMPORT] : [IMPORT, INTERVIEW]),
  });
  const r = await tools.list_my_roles.handler({ waitSeconds: 20 });
  assert.equal(r.pending, false);
  assert.deepEqual(r.recommended.map((x) => x.clusterId), ['ai-eng', 'backend']);
  assert.deepEqual(calls.finalization[0].args, { interviewId: 'iv-1', accessToken: 'certs-jwt' });
  assert.equal(calls.finalization[0].opts.base, 'https://certs/interviews');
  assert.equal(calls.clusters, 1, 'the clusters are read once the evaluation settled');
});

test('list_my_roles: an evaluation still running at the end of the wait is pending, so the AI calls again', async () => {
  const { tools } = harness({ interview: { interviewId: 'iv-1', completedAt: 0 }, finalization: () => ({ ok: true, status: 'COLLECTING' }), clusters: () => [IMPORT] });
  const r = await tools.list_my_roles.handler({ waitSeconds: 10 });
  assert.equal(r.pending, true);
  assert.match(r.message, /list_my_roles again/);
});

test('list_my_roles: the wait for an evaluation is bounded from when the interview ended, like the web', async () => {
  const { tools, calls, at } = harness({ interview: { interviewId: 'iv-1', completedAt: 0 }, finalization: () => ({ ok: true, status: 'PROCESSING' }), clusters: () => [IMPORT] });
  at(90000);
  const r = await tools.list_my_roles.handler({ waitSeconds: 20 });
  assert.equal(r.pending, false);
  assert.equal(calls.finalization.length, 0);
  assert.deepEqual(r.recommended.map((x) => x.clusterId), ['backend']);
});

test('list_my_roles: with no interview it polls briefly for the importer\'s recommendations', async () => {
  const { tools } = harness({ clusters: (t) => (t < 4000 ? [] : [IMPORT]) });
  const r = await tools.list_my_roles.handler({ waitSeconds: 10 });
  assert.deepEqual(r.recommended.map((x) => x.clusterId), ['backend']);
});

test('list_my_roles: nothing recommended sends the AI to set_main_role, which offers the catalogue', async () => {
  const { tools } = harness({ clusters: () => [GROWTH] });
  const r = await tools.list_my_roles.handler({ waitSeconds: 4 });
  assert.deepEqual(r.recommended, []);
  assert.equal(r.next, 'set_main_role');
  assert.match(r.message, /set_main_role without clusterId.*catalogue/);
});

test('list_my_roles: without waitSeconds it answers at once', async () => {
  const { tools, calls } = harness({ interview: { interviewId: 'iv-1', completedAt: 0 }, finalization: () => ({ ok: true, status: 'PROCESSING' }), clusters: () => [] });
  const r = await tools.list_my_roles.handler({});
  assert.equal(calls.clusters, 1);
  assert.equal(r.pending, true);
});

test('set_main_role: promotes the picked role; a role the talent does not hold says to add it first', async () => {
  const ok = harness();
  assert.deepEqual(await ok.tools.set_main_role.handler({ clusterId: 'ai-eng' }), { ok: true, clusterId: 'ai-eng' });
  assert.deepEqual(ok.calls.setMain[0], { clusterId: 'ai-eng', hubAccessToken: 'hub-jwt' });
  const notHeld = harness({ setMain: async () => ({ ok: false, reason: 'http-400' }) });
  const r = await notHeld.tools.set_main_role.handler({ clusterId: 'design' });
  assert.equal(r.reason, 'http-400');
  assert.match(r.message, /add_role/);
});

test('role tool descriptions put set_main_role as the sign-up step before open_web', () => {
  const { tools } = harness();
  assert.match(tools.list_my_roles.description, /waitSeconds/);
  assert.match(tools.set_main_role.description, /before open_web/);
});
