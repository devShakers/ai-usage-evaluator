'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');
const { runFindProjects, resolveQuery, paginationFooter, splitRecommended } = require('../src/find-projects-flow');

function fakeIo() {
  const lines = [];
  const io = {
    lines,
    section: (t) => lines.push(`SECTION ${t}`),
    notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, "")),
    error: (t) => lines.push(`ERROR ${t}`),
    warn: (t) => lines.push(`WARN ${t}`),
    success: (t) => lines.push(`SUCCESS ${t}`),
    withProgress: (_label, task) => task(),
  };
  return io;
}

const SESSION = { hubAccessToken: 'hub-jwt', accessToken: 'a' };
const ITEMS = [
  { positionId: 'pos-1', title: 'Backend dev', projectId: 'prj-1', projectName: 'Acme', match: 92, isSaved: true, company: { name: 'Acme', restricted: false }, budget: { display: '3 000 €/mes' }, skillNames: [], languages: [], attendance: 'REMOTE', country: 'ES', requiredMonthlyHours: 80 },
  { positionId: 'pos-2', title: 'PM', projectId: 'prj-2', projectName: 'Zeta', match: 70, isSaved: false, company: { name: null, restricted: true }, budget: null, skillNames: [], languages: [] },
];

function depsCapturing(res) {
  const calls = [];
  const written = [];
  return { calls, written, fetchFindProjects: async (opts) => { calls.push(opts); return res; }, writePositionCache: (ids) => written.push(ids) };
}

/* -------- resolveQuery: pagination + filter normalization -------- */

test('resolveQuery: page->offset, defaults, attendance/country normalization + invalids', () => {
  assert.deepEqual(resolveQuery({ page: 3, limit: 10 }), { tab: 'all', limit: 10, page: 3, offset: 20, attendance: null, country: null, attendanceInvalid: false, countryInvalid: false, recommended: false });
  assert.equal(resolveQuery({ recommended: true }).recommended, true);
  const q = resolveQuery({ attendance: 'Remote', country: 'es' });
  assert.equal(q.attendance, 'REMOTE');
  assert.equal(q.country, 'ES');
  const bad = resolveQuery({ attendance: 'onsite', country: 'spain' });
  assert.equal(bad.attendance, null);
  assert.equal(bad.attendanceInvalid, true);
  assert.equal(bad.country, null);
  assert.equal(bad.countryInvalid, true);
  assert.equal(resolveQuery({ tab: 'recommended' }).tab, 'all'); // dropped tab falls back
  assert.equal(resolveQuery({ limit: 999 }).limit, 50); // clamped
});

/* -------- paginationFooter -------- */

test('paginationFooter: "Showing X–Y of TOTAL" + next-page hint only while more remain', () => {
  const fp = getCatalog('en').findProjects;
  const withMore = paginationFooter(fp, { total: 213, totalPages: 15 }, { offset: 0, page: 1 }, 15);
  assert.match(withMore, /Showing 1–15 of 213/);
  assert.match(withMore, /--page 2 to see more/);
  const lastPage = paginationFooter(fp, { total: 20, totalPages: 2 }, { offset: 15, page: 2 }, 5);
  assert.match(lastPage, /Showing 16–20 of 20/);
  assert.doesNotMatch(lastPage, /--page/);
  assert.equal(paginationFooter(fp, { total: 0 }, { offset: 0, page: 1 }, 0), null);
});

/* -------- runFindProjects -------- */

test('runFindProjects: single paginated list (no grouping), footer from meta, ids hidden', async () => {
  const io = fakeIo();
  const deps = depsCapturing({ ok: true, items: ITEMS, meta: { page: 1, pageSize: 15, total: 213, totalPages: 15 } });
  const r = await runFindProjects({
    io, session: SESSION, lang: 'en', catalog: getCatalog('en'),
    opts: { page: 1, limit: 15 }, deps,
  });
  assert.equal(r.ok, true);
  const out = io.lines.join('\n');
  assert.match(out, /SECTION Available projects/);
  assert.doesNotMatch(out, /Recommended|SECTION Saved/); // grouping removed
  assert.match(out, /Backend dev/);
  assert.doesNotMatch(out, /pos-1|prj-1/); // ids never in human render
  assert.match(out, /Showing 1–2 of 213/); // range = items actually rendered
  assert.match(out, /--page 2 to see more/);
  assert.equal(deps.calls[0].limit, 15);
  assert.equal(deps.calls[0].offset, 0);
  // The human listing persists the ordinal -> positionId map, in display order.
  assert.deepEqual(deps.written, [['pos-1', 'pos-2']]);
});

test('runFindProjects: --json skips the loader label (no io.withProgress), human path uses it', async () => {
  const jsonIo = { ...fakeIo(), progressed: false };
  jsonIo.withProgress = (_l, task) => { jsonIo.progressed = true; return task(); };
  await runFindProjects({ io: jsonIo, rawOut: () => {}, session: SESSION, lang: 'en', catalog: getCatalog('en'), opts: { json: true }, deps: depsCapturing({ ok: true, items: ITEMS, meta: { total: 2 } }) });
  assert.equal(jsonIo.progressed, false); // never wraps the fetch in the loader in json mode

  const humanIo = { ...fakeIo(), progressed: false };
  humanIo.withProgress = (_l, task) => { humanIo.progressed = true; return task(); };
  await runFindProjects({ io: humanIo, session: SESSION, lang: 'en', catalog: getCatalog('en'), opts: {}, deps: depsCapturing({ ok: true, items: ITEMS, meta: { total: 2 } }) });
  assert.equal(humanIo.progressed, true);
});

test('runFindProjects: --json does NOT write the position cache', async () => {
  const deps = depsCapturing({ ok: true, items: ITEMS, meta: { total: 2 } });
  await runFindProjects({
    io: fakeIo(), rawOut: () => {}, session: SESSION, lang: 'en', catalog: getCatalog('en'),
    opts: { json: true }, deps,
  });
  assert.deepEqual(deps.written, []); // machine output never caches
});

test('runFindProjects: --tab saved fetches saved + uses the saved title', async () => {
  const io = fakeIo();
  const deps = depsCapturing({ ok: true, items: [ITEMS[0]], meta: { total: 1, totalPages: 1 } });
  await runFindProjects({
    io, session: SESSION, lang: 'en', catalog: getCatalog('en'),
    opts: { tab: 'saved' }, deps,
  });
  assert.equal(deps.calls[0].tab, 'saved');
  assert.match(io.lines.join('\n'), /SECTION Saved projects/);
});

test('runFindProjects: filters thread through + page 2 offset', async () => {
  const io = fakeIo();
  const deps = depsCapturing({ ok: true, items: ITEMS, meta: { total: 30, totalPages: 2 } });
  await runFindProjects({
    io, session: SESSION, lang: 'en', catalog: getCatalog('en'),
    opts: { page: 2, limit: 15, attendance: 'remote', country: 'ES' }, deps,
  });
  assert.equal(deps.calls[0].offset, 15);
  assert.equal(deps.calls[0].attendance, 'REMOTE');
  assert.equal(deps.calls[0].country, 'ES');
});

test('runFindProjects: invalid --attendance -> warn, filter dropped (not sent)', async () => {
  const io = fakeIo();
  const deps = depsCapturing({ ok: true, items: ITEMS, meta: { total: 2, totalPages: 1 } });
  await runFindProjects({
    io, session: SESSION, lang: 'en', catalog: getCatalog('en'),
    opts: { attendance: 'onsite' }, deps,
  });
  assert.match(io.lines.join('\n'), /WARN .*invalid --attendance/);
  assert.equal(deps.calls[0].attendance, null);
});

test('runFindProjects: --json prints structured payload with ids + meta, no sections', async () => {
  let raw = '';
  const io = fakeIo();
  const r = await runFindProjects({
    io, rawOut: (s) => { raw += s; }, session: SESSION, lang: 'en', catalog: getCatalog('en'),
    opts: { json: true, page: 2, limit: 15, attendance: 'remote' },
    deps: depsCapturing({ ok: true, items: ITEMS, meta: { page: 2, pageSize: 15, total: 30, totalPages: 2 } }),
  });
  assert.equal(r.ok, true);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.page, 2);
  assert.equal(parsed.filters.attendance, 'REMOTE');
  assert.equal(parsed.meta.total, 30);
  assert.equal(parsed.items[0].positionId, 'pos-1'); // ids stay in machine output
  assert.equal(io.lines.length, 0);
});

test('runFindProjects: fetch failure -> error line + ok:false', async () => {
  const io = fakeIo();
  const r = await runFindProjects({
    io, session: SESSION, lang: 'en', catalog: getCatalog('en'),
    opts: {}, deps: depsCapturing({ ok: false, reason: 'http-500' }),
  });
  assert.equal(r.ok, false);
  assert.match(io.lines.join('\n'), /ERROR .*http-500/);
});

test('runFindProjects: empty page 1 -> noneAvailable; empty page>1 -> noneOnPage', async () => {
  const io1 = fakeIo();
  await runFindProjects({ io: io1, session: SESSION, lang: 'es', catalog: getCatalog('es'), opts: {}, deps: depsCapturing({ ok: true, items: [], meta: { total: 0 } }) });
  assert.match(io1.lines.join('\n'), /no hay proyectos disponibles/);

  const io2 = fakeIo();
  await runFindProjects({ io: io2, session: SESSION, lang: 'en', catalog: getCatalog('en'), opts: { page: 5 }, deps: depsCapturing({ ok: true, items: [], meta: { total: 3 } }) });
  assert.match(io2.lines.join('\n'), /No more projects on this page/);
});

/* -------- --recommended (client-side filter + fallback) -------- */

const MIXED = [
  { positionId: 'pos-1', title: 'Backend dev', projectName: 'Acme', match: 92, isSaved: false, company: { name: 'Acme' }, budget: null, skillNames: [], languages: [] },
  { positionId: 'pos-2', title: 'Data eng', projectName: 'Zeta', match: null, isSaved: false, company: { name: 'Zeta' }, budget: null, skillNames: [], languages: [] },
];
const NONE_MATCHED = MIXED.map((it) => ({ ...it, match: null }));

test('splitRecommended: keeps match!=null; falls back to available when none; null mode when off', () => {
  assert.deepEqual(splitRecommended(MIXED, true), { shown: [MIXED[0]], mode: 'recommended' });
  assert.deepEqual(splitRecommended(NONE_MATCHED, true), { shown: NONE_MATCHED, mode: 'fallback' });
  assert.deepEqual(splitRecommended(MIXED, false), { shown: MIXED, mode: null });
});

test('runFindProjects --recommended: shows only matched, honest footer (not "of TOTAL")', async () => {
  const deps = depsCapturing({ ok: true, items: MIXED, meta: { total: 213, totalPages: 15 } });
  const io = fakeIo();
  const r = await runFindProjects({ io, session: SESSION, lang: 'en', catalog: getCatalog('en'), opts: { recommended: true }, deps });
  const out = io.lines.join('\n');
  assert.equal(r.recommended, 'recommended');
  assert.match(out, /Backend dev/);
  assert.doesNotMatch(out, /\bData eng\b/); // pos-2 (no match) filtered out
  assert.match(out, /1 recommended on this page/);
  assert.doesNotMatch(out, /Showing .* of 213/); // never lies that TOTAL are recommended
  assert.match(out, /--page 2 to see more/); // pagination still offered
  assert.deepEqual(deps.written, [['pos-1']]); // cache follows the shown subset
});

test('runFindProjects --recommended with none matched: fallback notice + available, honest footer', async () => {
  const deps = depsCapturing({ ok: true, items: NONE_MATCHED, meta: { total: 30, totalPages: 2 } });
  const io = fakeIo();
  const r = await runFindProjects({ io, session: SESSION, lang: 'en', catalog: getCatalog('en'), opts: { recommended: true }, deps });
  const out = io.lines.join('\n');
  assert.equal(r.recommended, 'fallback');
  assert.match(out, /No recommended for you right now; showing the available ones/);
  assert.match(out, /Backend dev/);
  assert.match(out, /Data eng/); // both available shown (never empty)
  assert.match(out, /Showing 1–2 of 30/); // available -> the normal TOTAL footer is honest here
  assert.deepEqual(deps.written, [['pos-1', 'pos-2']]);
});

test('runFindProjects --recommended --json: filtered items keep match; recommended mode present', async () => {
  let raw = '';
  await runFindProjects({ io: fakeIo(), rawOut: (s) => { raw += s; }, session: SESSION, lang: 'en', catalog: getCatalog('en'), opts: { recommended: true, json: true }, deps: depsCapturing({ ok: true, items: MIXED, meta: { total: 5 } }) });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.recommended, 'recommended');
  assert.equal(parsed.filters.recommended, true);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].match, 92); // json keeps match per item
});
