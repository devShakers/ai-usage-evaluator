'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFindProjectsTools, FIND_PROJECTS_SCHEMA } = require('../src/mcp-find-projects-tools');

const ITEMS = [
  { positionId: 'pos-1', title: 'Backend dev', projectId: 'prj-1', projectName: 'Acme', match: 92, isSaved: true, company: { name: 'Acme' }, budget: null, skillNames: [], languages: [] },
  { positionId: 'pos-2', title: 'PM', projectId: 'prj-2', projectName: 'Zeta', match: null, isSaved: false, company: {}, budget: null, skillNames: [], languages: [] },
];

function toolWith(deps) {
  const [tool] = makeFindProjectsTools({
    loadAuthSession: () => ({ hubAccessToken: 'hub-jwt' }),
    sessionStatus: () => 'active',
    ...deps,
  });
  return tool;
}

test('find_projects: schema exposes tab(all|saved) + pagination + filters', () => {
  const [tool] = makeFindProjectsTools({});
  assert.equal(tool.name, 'find_projects');
  assert.deepEqual(FIND_PROJECTS_SCHEMA.properties.tab.enum, ['all', 'saved']);
  assert.ok(FIND_PROJECTS_SCHEMA.properties.page);
  assert.ok(FIND_PROJECTS_SCHEMA.properties.limit);
  assert.deepEqual(FIND_PROJECTS_SCHEMA.properties.attendance.enum, ['remote', 'hybrid', 'in-person']);
  assert.ok(FIND_PROJECTS_SCHEMA.properties.country);
});

test('find_projects: no active session -> throws (session-gated)', async () => {
  const tool = toolWith({ sessionStatus: () => 'expired', fetchFindProjects: async () => ({ ok: true, items: [] }) });
  await assert.rejects(() => tool.handler({}), /no active Shakers session/);
});

test('find_projects: threads pagination + filters, returns items + meta (ids kept)', async () => {
  let opts;
  const tool = toolWith({ fetchFindProjects: async (o) => { opts = o; return { ok: true, items: ITEMS, meta: { page: 2, pageSize: 15, total: 213, totalPages: 15 } }; } });
  const r = await tool.handler({ page: 2, limit: 15, attendance: 'Remote', country: 'es' });
  assert.equal(r.ok, true);
  assert.equal(opts.hubAccessToken, 'hub-jwt');
  assert.equal(opts.offset, 15);
  assert.equal(opts.limit, 15);
  assert.equal(opts.attendance, 'REMOTE');
  assert.equal(opts.country, 'ES');
  assert.equal(r.page, 2);
  assert.equal(r.meta.total, 213);
  assert.equal(r.items[0].positionId, 'pos-1');
});

test('find_projects: tab saved fetches saved', async () => {
  let tabAsked;
  const tool = toolWith({ fetchFindProjects: async ({ tab }) => { tabAsked = tab; return { ok: true, items: [ITEMS[0]], meta: null }; } });
  const r = await tool.handler({ tab: 'saved' });
  assert.equal(tabAsked, 'saved');
  assert.equal(r.tab, 'saved');
});

test('find_projects: unknown tab falls back to all; bad limit -> default', async () => {
  let opts;
  const tool = toolWith({ fetchFindProjects: async (o) => { opts = o; return { ok: true, items: [], meta: null }; } });
  const r = await tool.handler({ tab: 'recommended', limit: -5 });
  assert.equal(opts.tab, 'all');
  assert.equal(r.limit, 15);
});

test('find_projects: fetch failure -> ok:false with reason', async () => {
  const tool = toolWith({ fetchFindProjects: async () => ({ ok: false, reason: 'http-500' }) });
  assert.deepEqual(await tool.handler({}), { ok: false, reason: 'http-500' });
});

test('find_projects: recommended=true filters to match!=null (json keeps match), mode="recommended"', async () => {
  const tool = toolWith({ fetchFindProjects: async () => ({ ok: true, items: ITEMS, meta: { total: 5 } }) });
  const r = await tool.handler({ recommended: true });
  assert.equal(r.recommended, 'recommended');
  assert.equal(r.filters.recommended, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].positionId, 'pos-1');
  assert.equal(r.items[0].match, 92); // match still present per item
});

test('find_projects: recommended with none matched -> fallback to available (never empty)', async () => {
  const none = ITEMS.map((it) => ({ ...it, match: null }));
  const tool = toolWith({ fetchFindProjects: async () => ({ ok: true, items: none, meta: { total: 2 } }) });
  const r = await tool.handler({ recommended: true });
  assert.equal(r.recommended, 'fallback');
  assert.equal(r.items.length, 2); // available shown, not empty
});

test('find_projects: schema exposes the recommended boolean', () => {
  assert.equal(FIND_PROJECTS_SCHEMA.properties.recommended.type, 'boolean');
});
