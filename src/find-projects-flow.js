'use strict';

// `find-projects` flow: list the Positions/Projects available to the talent,
// paginated and filtered server-side via the endpoint's `criteria`. Read-only.

const { TABS, ATTENDANCE, DEFAULT_LIMIT } = require('./find-projects-client');
const { styleLabelPrefix } = require('./ansi');

function makeFindProjectsDeps(overrides = {}) {
  const client = require('./find-projects-client');
  return {
    fetchFindProjects: (opts) => client.fetchFindProjects({}, opts),
    writePositionCache: (ids) => require('./find-projects-cache').writePositionCache(ids),
    ...overrides,
  };
}

// Normalize CLI/agent inputs to the shapes the endpoint's criteria expects.
function resolveQuery(opts = {}) {
  const tab = TABS.includes(opts.tab) ? opts.tab : 'all';
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, 50) : DEFAULT_LIMIT;
  const page = Number.isInteger(opts.page) && opts.page > 0 ? opts.page : 1;
  const offset = (page - 1) * limit;
  const attRaw = typeof opts.attendance === 'string' ? opts.attendance.trim().toLowerCase() : null;
  const attendance = attRaw && ATTENDANCE[attRaw] ? ATTENDANCE[attRaw] : null;
  const attendanceInvalid = !!(attRaw && !ATTENDANCE[attRaw]);
  const countryRaw = typeof opts.country === 'string' ? opts.country.trim().toUpperCase() : null;
  const country = countryRaw && /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;
  const countryInvalid = !!(countryRaw && !/^[A-Z]{2}$/.test(countryRaw));
  return { tab, limit, page, offset, attendance, country, attendanceInvalid, countryInvalid, recommended: !!opts.recommended };
}

// `--recommended` is a CLIENT-SIDE filter over the fetched page (the hub has no
// server-side "recommended" criterion — `match` is output-only). Recommended =
// items that have a match. If none on this page, fall back to the available
// items so the user is never left with an empty screen.
function splitRecommended(items, recommended) {
  if (!recommended) return { shown: items, mode: null };
  const rec = items.filter((it) => it.match != null);
  if (rec.length > 0) return { shown: rec, mode: 'recommended' };
  return { shown: items, mode: 'fallback' };
}

function budgetLine(item, fp) {
  if (item.budget && item.budget.display) return item.budget.display;
  if (item.budget && (item.budget.from != null || item.budget.to != null)) {
    return `${item.budget.from ?? '·'}–${item.budget.to ?? '·'}${item.budget.unit ? ` ${item.budget.unit}` : ''}`;
  }
  return fp.budgetUnknown;
}

function formatItem(item, index, fp) {
  const headline = item.title || item.projectName || fp.untitled;
  const company = item.company && item.company.name
    ? item.company.name
    : (item.company && item.company.restricted ? fp.companyRestricted : null);
  // No type segment (positions-only, always "position" → redundant).
  const metaBits = [
    item.attendance || null,
    item.country || null,
    item.requiredMonthlyHours != null ? fp.hoursPerMonth(item.requiredMonthlyHours) : null,
    budgetLine(item, fp),
    item.match != null ? fp.matchScore(item.match) : null,
    item.isSaved ? fp.savedBadge : null,
  ].filter(Boolean);
  // Human render never prints positionId/projectId (they stay in --json only).
  const lines = [`${index}) ${headline}${company ? ` — ${company}` : ''}`];
  if (item.projectName && item.projectName !== headline) lines.push(`   ${styleLabelPrefix(fp.projectLabel(item.projectName))}`);
  lines.push(`   ${metaBits.join(' · ')}`);
  return lines.join('\n  ');
}

// "Showing X–Y of TOTAL" (+ a next-page hint while more pages remain).
function paginationFooter(fp, meta, q, shown) {
  if (!meta || typeof meta.total !== 'number') return null;
  if (meta.total === 0) return null;
  const from = q.offset + 1;
  const to = q.offset + shown;
  let line = fp.showing(from, to, meta.total);
  if (meta.totalPages && q.page < meta.totalPages) line += ` · ${fp.morePages(q.page + 1)}`;
  return line;
}

// Honest footer while showing the client-side recommended SUBSET of a page:
// never "X of TOTAL" (TOTAL is all available, not recommended). Pagination still
// works to pull more pages (which may carry more recommended).
function recommendedFooter(fp, count, meta, q) {
  let line = fp.recommendedOnPage(count);
  if (meta && meta.totalPages && q.page < meta.totalPages) line += ` · ${fp.morePages(q.page + 1)}`;
  return line;
}

async function runFindProjects({ io, rawOut, session, lang, catalog, opts = {}, deps = makeFindProjectsDeps() }) {
  const fp = catalog.findProjects;
  const hubAccessToken = session ? session.hubAccessToken : null;
  const q = resolveQuery(opts);

  if (!opts.json) {
    if (q.attendanceInvalid) io.warn(fp.attendanceIgnored);
    if (q.countryInvalid) io.warn(fp.countryIgnored);
  }

  // In --json the loading label must not print (it would corrupt the JSON on a
  // non-TTY stdout); only decorate the human path with the progress spinner.
  const fetchPage = () => deps.fetchFindProjects({
    hubAccessToken, tab: q.tab, limit: q.limit, offset: q.offset, attendance: q.attendance, country: q.country,
  });
  const res = opts.json ? await fetchPage() : await io.withProgress(fp.loading, fetchPage);
  if (!res.ok) {
    io.error(fp.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }

  const items = Array.isArray(res.items) ? res.items : [];
  // Client-side recommended filter (+ fallback to available), applied to both
  // the human render and --json so an agent sees the same view (json keeps match).
  const { shown, mode } = splitRecommended(items, q.recommended);

  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({
      ok: true,
      tab: q.tab,
      page: q.page,
      limit: q.limit,
      filters: { attendance: q.attendance, country: q.country, recommended: q.recommended },
      recommended: mode,
      meta: res.meta || null,
      items: shown,
    }, null, 2)}\n`);
    return { ok: true, items: shown, meta: res.meta || null, recommended: mode };
  }

  // Persist the ordinal -> positionId map of what is SHOWN so `show-project N`
  // matches the render. Human path only; a write failure never breaks the listing.
  try { deps.writePositionCache(shown.map((it) => it.positionId)); } catch { /* cache is best-effort */ }

  io.section(q.tab === 'saved' ? fp.titleSaved : fp.title);
  if (items.length === 0) {
    io.notify(q.page > 1 ? fp.noneOnPage : fp.noneAvailable);
    return { ok: true, items: shown, meta: res.meta || null, recommended: mode };
  }
  // No recommended on this page -> we show the available ones, with a clear notice.
  if (mode === 'fallback') io.notify(fp.recommendedNoneFallback);
  shown.forEach((item, i) => {
    if (i > 0) io.notify('');
    io.notify(formatItem(item, i + 1, fp));
  });
  const footer = mode === 'recommended'
    ? recommendedFooter(fp, shown.length, res.meta, q)
    : paginationFooter(fp, res.meta, q, shown.length);
  if (footer) io.notify(footer);
  io.success(fp.done);
  return { ok: true, items: shown, meta: res.meta || null, recommended: mode };
}

module.exports = {
  makeFindProjectsDeps,
  runFindProjects,
  resolveQuery,
  splitRecommended,
  formatItem,
  paginationFooter,
  recommendedFooter,
};
