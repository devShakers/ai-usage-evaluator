'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');
const { runAddRole, runChangeMainRole, runOnboardingMainRoleStep } = require('../src/roles-flow');
const { makeRoleTools } = require('../src/mcp-role-tools');

const catalog = getCatalog('en');
const SESSION = { hubAccessToken: 'H' };

function fakeIo({ pick = null } = {}) {
  const out = [];
  return {
    out,
    section: (t) => out.push(`section:${t}`),
    notify: (t) => out.push(`notify:${t}`),
    success: (t) => out.push(`success:${t}`),
    warn: (t) => out.push(`warn:${t}`),
    error: (t) => out.push(`error:${t}`),
    withProgress: (_l, task) => task(),
    select: async ({ items }) => (pick == null ? null : items[pick]),
  };
}

function baseDeps(over = {}) {
  return {
    getAvailableRolesEndpoint: () => 'https://hub/available',
    getSetMainRoleEndpoint: () => 'https://hub/main-role',
    getAssignedClustersEndpoint: () => 'https://hub/assigned',
    getMyCertificationsEndpoint: () => 'https://hub/me',
    requestAvailableRoles: async () => ({ ok: true, roles: [] }),
    requestAssignedClusters: async () => ({ ok: true, clusters: [] }),
    requestAddGrowthRole: async () => ({ ok: true }),
    requestSetMainRole: async () => ({ ok: true }),
    requestMeCertifications: async () => ({ ok: true, mainRole: null, growingInto: [] }),
    ...over,
  };
}

test('add-role: empty catalog reports none-available, no write', async () => {
  let added = false;
  const io = fakeIo({ pick: 0 });
  const res = await runAddRole({ io, session: SESSION, catalog, deps: baseDeps({ requestAddGrowthRole: async () => { added = true; return { ok: true }; } }) });
  assert.equal(res.ok, true);
  assert.equal(res.added, null);
  assert.equal(added, false);
  assert.ok(io.out.some((l) => l.includes(catalog.roles.noneAvailable)));
});

test('add-role: picking a role adds it as GROWTH', async () => {
  const calls = [];
  const io = fakeIo({ pick: 0 });
  const deps = baseDeps({
    requestAvailableRoles: async () => ({ ok: true, roles: [{ clusterId: 'data-engineer', name: 'Data Engineer', category: 'eng' }] }),
    requestAddGrowthRole: async (a) => { calls.push(a.clusterId); return { ok: true }; },
  });
  const res = await runAddRole({ io, session: SESSION, catalog, deps });
  assert.equal(res.added, 'data-engineer');
  assert.deepEqual(calls, ['data-engineer']);
});

test('change-role: no other held roles reports a hint', async () => {
  const io = fakeIo({ pick: 0 });
  const deps = baseDeps({
    requestMeCertifications: async () => ({ ok: true, mainRole: { clusterId: 'pm', name: 'PM' }, growingInto: [] }),
    requestAssignedClusters: async () => ({ ok: true, clusters: [] }),
  });
  const res = await runChangeMainRole({ io, session: SESSION, catalog, deps });
  assert.equal(res.changed, null);
  assert.ok(io.out.some((l) => l.includes(catalog.roles.noOtherRoles)));
});

test('change-role: picks among held roles and PATCHes main', async () => {
  const patched = [];
  const io = fakeIo({ pick: 0 });
  const deps = baseDeps({
    requestMeCertifications: async () => ({ ok: true, mainRole: { clusterId: 'pm', name: 'PM' }, growingInto: [{ clusterId: 'data-engineer', name: 'Data Engineer' }] }),
    requestSetMainRole: async (a) => { patched.push(a.clusterId); return { ok: true }; },
  });
  const res = await runChangeMainRole({ io, session: SESSION, catalog, deps });
  assert.equal(res.changed, 'data-engineer');
  assert.deepEqual(patched, ['data-engineer']);
});

test('onboarding main-role step: no roles yet degrades to a pending note', async () => {
  const io = fakeIo({ pick: 0 });
  const res = await runOnboardingMainRoleStep({ io, session: SESSION, catalog, deps: baseDeps() });
  assert.equal(res.chosen, null);
  assert.ok(io.out.some((l) => l.includes(catalog.roles.mainRolePending)));
});

test('onboarding main-role step: sets the chosen main role', async () => {
  const patched = [];
  const io = fakeIo({ pick: 0 });
  const deps = baseDeps({
    requestMeCertifications: async () => ({ ok: true, mainRole: null, growingInto: [{ clusterId: 'data-engineer', name: 'Data Engineer' }] }),
    requestSetMainRole: async (a) => { patched.push(a.clusterId); return { ok: true }; },
  });
  const res = await runOnboardingMainRoleStep({ io, session: SESSION, catalog, deps });
  assert.equal(res.chosen, 'data-engineer');
  assert.deepEqual(patched, ['data-engineer']);
});

test('onboarding main-role step: with no held roles, falls back to the catalog, adds then sets main', async () => {
  const added = [];
  const patched = [];
  const io = fakeIo({ pick: 0 });
  const deps = baseDeps({
    requestMeCertifications: async () => ({ ok: true, mainRole: null, growingInto: [] }),
    requestAssignedClusters: async () => ({ ok: true, clusters: [] }),
    requestAvailableRoles: async () => ({ ok: true, roles: [{ clusterId: 'data-engineer', name: 'Data Engineer' }] }),
    requestAddGrowthRole: async (a) => { added.push(a.clusterId); return { ok: true }; },
    requestSetMainRole: async (a) => { patched.push(a.clusterId); return { ok: true }; },
  });
  const res = await runOnboardingMainRoleStep({ io, session: SESSION, catalog, deps });
  assert.equal(res.chosen, 'data-engineer');
  assert.deepEqual(added, ['data-engineer']);
  assert.deepEqual(patched, ['data-engineer']);
});

test('mcp role tools: list/add/set surface the expected handlers', async () => {
  const tools = makeRoleTools({
    loadAuthSession: () => SESSION,
    sessionStatus: () => 'active',
    getAvailableRolesEndpoint: () => 'x', getSetMainRoleEndpoint: () => 'x',
    getAssignedClustersEndpoint: () => 'x', getMyCertificationsEndpoint: () => 'x',
    requestAvailableRoles: async () => ({ ok: true, roles: [{ clusterId: 'a', name: 'A', category: 'c', proposalKind: 'resume' }] }),
    requestAssignedClusters: async () => ({ ok: true, clusters: [] }),
    requestAddGrowthRole: async () => ({ ok: true }),
    requestSetMainRole: async () => ({ ok: true }),
    requestMeCertifications: async () => ({ ok: true, mainRole: { clusterId: 'a', name: 'A' }, growingInto: [] }),
  });
  const names = tools.map((t) => t.name);
  assert.deepEqual(names, ['list_available_roles', 'add_role', 'list_my_roles', 'set_main_role']);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const list = await byName.list_available_roles.handler({});
  assert.equal(list.ok, true);
  assert.equal(list.roles[0].proposalKind, 'resume');
  const add = await byName.add_role.handler({ clusterId: 'a' });
  assert.equal(add.ok, true);
  const set = await byName.set_main_role.handler({ clusterId: 'a' });
  assert.equal(set.ok, true);
  const mine = await byName.list_my_roles.handler({});
  assert.equal(mine.mainClusterId, 'a');
});
