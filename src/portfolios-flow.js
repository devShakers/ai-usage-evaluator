'use strict';

// Shared flow for `experiences` (type=EXPERIENCE) and `portfolios`
// (type=PORTFOLIO): both list the talent's portfolio entries, read-only, with
// the same shape. `kind` selects the `?type=` subset and the i18n namespace.

const { styleLabelPrefix } = require('./ansi');
const { resolveName } = require('./translations-client');

function makePortfoliosDeps(overrides = {}) {
  const client = require('./portfolios-client');
  return {
    fetchPortfolios: (opts) => client.fetchPortfolios({}, opts),
    fetchTranslationMap: (opts) => require('./translations-client').fetchTranslationMap({}, opts),
    ...overrides,
  };
}

// Skill names arrive as static-data i18n KEYS; resolve them to readable names
// (only fetch the translations map when there is at least one key to resolve).
async function resolveSkillNames(items, { deps, hubAccessToken, lang }) {
  const needs = items.some((it) => (it.skills || []).some((s) => /^staticData/.test(s)));
  if (!needs) return items;
  const tm = await deps.fetchTranslationMap({ hubAccessToken, lang });
  const map = tm && tm.ok ? tm.map : null;
  if (!map) return items;
  return items.map((it) => ({ ...it, skills: (it.skills || []).map((s) => resolveName(map, s)) }));
}

function dateRange(item, fp) {
  const start = item.startDate ? item.startDate.slice(0, 10) : null;
  const end = item.isCurrent ? fp.current : (item.endDate ? item.endDate.slice(0, 10) : null);
  if (!start && !end) return null;
  return `${start || '—'} → ${end || '—'}`;
}

// Human render never prints ids (they ride --json / the tools).
function formatItem(item, index, fp) {
  const headline = item.name || fp.untitled;
  const lines = [`${index}) ${headline}${item.company ? ` — ${item.company}` : ''}`];
  const range = dateRange(item, fp);
  if (range) lines.push(`   ${styleLabelPrefix(fp.datesLabel(range))}`);
  if (item.location) lines.push(`   ${styleLabelPrefix(fp.locationLabel(item.location))}`);
  if (item.skills.length) lines.push(`   ${styleLabelPrefix(fp.skillsLabel(item.skills.join(', ')))}`);
  return lines.join('\n  ');
}

async function runPortfolioList({ io, rawOut, lang = 'en', session, catalog, kind, opts = {}, deps = makePortfoliosDeps() }) {
  const fp = catalog[kind];
  const hubAccessToken = session ? session.hubAccessToken : null;

  const doFetch = () => deps.fetchPortfolios({ hubAccessToken, kind });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) {
    io.error(fp.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }
  const items = await resolveSkillNames(Array.isArray(res.items) ? res.items : [], { deps, hubAccessToken, lang });

  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, items }, null, 2)}\n`);
    return { ok: true, items };
  }

  io.section(fp.title);
  if (items.length === 0) {
    io.notify(fp.none);
    return { ok: true, items };
  }
  items.forEach((item, i) => {
    if (i > 0) io.notify('');
    io.notify(formatItem(item, i + 1, fp));
  });
  io.notify(styleLabelPrefix(fp.countNote(items.length)));
  io.success(fp.done);
  return { ok: true, items };
}

module.exports = { makePortfoliosDeps, runPortfolioList, formatItem };
