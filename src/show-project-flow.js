'use strict';

// `show-project` flow: render the detail of one Position/Project. Read-only.

const { styleLabel, styleLabelPrefix } = require('./ansi');
const { resolveName } = require('./translations-client');

function makeShowProjectDeps(overrides = {}) {
  const client = require('./show-project-client');
  return {
    fetchPositionDetail: (opts) => client.fetchPositionDetail({}, opts),
    resolveRef: (raw) => require('./find-projects-cache').resolvePositionRef(raw),
    fetchTranslationMap: (opts) => require('./translations-client').fetchTranslationMap({}, opts),
    ...overrides,
  };
}

// Skill names come as static-data i18n KEYS; resolve them to readable names
// (only fetch the translations map when there is a key to resolve).
async function resolvePositionSkills(position, { deps, hubAccessToken, lang }) {
  const skills = position && Array.isArray(position.skills) ? position.skills : null;
  if (!skills || !skills.some((s) => s && /^staticData/.test(s.name))) return position;
  const tm = await deps.fetchTranslationMap({ hubAccessToken, lang });
  const map = tm && tm.ok ? tm.map : null;
  if (!map) return position;
  return { ...position, skills: skills.map((s) => ({ ...s, name: resolveName(map, s && s.name) })) };
}

function budgetLine(budget, fp) {
  if (!budget) return fp.budgetUnknown;
  if (budget.display) return budget.display;
  if (budget.from != null || budget.to != null) {
    return `${budget.from ?? '·'}–${budget.to ?? '·'}${budget.unit ? ` ${budget.unit}` : ''}`;
  }
  return fp.budgetUnknown;
}

// The human render never prints the position/project ids (they stay in --json).
function renderDetail(io, fp, p) {
  const company = p.company && p.company.name ? p.company.name : (p.company && p.company.restricted ? fp.companyRestricted : null);
  io.section(p.title || fp.untitled);
  if (company) io.notify(styleLabelPrefix(fp.companyLine(company)));
  if (p.subtitle) io.notify(styleLabelPrefix(fp.projectLine(p.subtitle)));

  const meta = [
    p.attendance || null,
    p.country || null,
    p.requiredMonthlyHours != null ? fp.hoursPerMonth(p.requiredMonthlyHours) : null,
    budgetLine(p.budget, fp),
    p.match != null ? fp.matchScore(p.match) : null,
  ].filter(Boolean);
  io.notify(meta.join(' · '));

  const skills = Array.isArray(p.skills) ? p.skills.map((s) => s && s.name).filter(Boolean) : [];
  if (skills.length) io.notify(styleLabelPrefix(fp.skillsLine(skills.join(', '))));
  const langs = Array.isArray(p.languages) ? p.languages.filter(Boolean) : [];
  if (langs.length) io.notify(styleLabelPrefix(fp.languagesLine(langs.join(', '))));

  const flags = [
    p.isSaved ? fp.savedBadge : null,
    p.hasApplied ? fp.appliedBadge : (p.canApply ? fp.canApplyBadge : null),
  ].filter(Boolean);
  if (flags.length) io.notify(flags.join(' · '));

  if (p.description) { io.section(fp.descriptionHeading); io.notify(p.description.trim()); }
  if (p.goals) { io.section(fp.goalsHeading); io.notify(p.goals.trim()); }
  const faqs = Array.isArray(p.faqs) ? p.faqs : [];
  if (faqs.length) {
    io.section(fp.faqsHeading);
    faqs.forEach((f) => { if (f && f.question) io.notify(`${styleLabel(f.question)}${f.answer ? `\n  ${f.answer}` : ''}`); });
  }
}

async function runShowProject({ io, rawOut, lang = 'en', session, catalog, opts = {}, deps = makeShowProjectDeps() }) {
  const fp = catalog.showProject;
  const hubAccessToken = session ? session.hubAccessToken : null;
  // A pure integer resolves against the last `find-projects` listing; a UUID/Mongo id passes through.
  const resolved = deps.resolveRef(opts.id);
  if (!resolved.ok) {
    io.error(resolved.reason === 'no-cache' ? fp.refNoCache
      : resolved.reason === 'out-of-range' ? fp.refOutOfRange(resolved.count)
        : fp.idRequired);
    return { ok: false, reason: resolved.reason };
  }
  const positionId = resolved.id;

  const doFetch = () => deps.fetchPositionDetail({ hubAccessToken, positionId });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) {
    io.error(res.reason === 'not-found' ? fp.notFound : fp.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }
  if (!res.position) {
    // --json must stay machine-readable even when the position is hidden.
    if (opts.json) {
      (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, position: null, redirectUrl: res.redirectUrl }, null, 2)}\n`);
      return { ok: true, position: null, redirectUrl: res.redirectUrl };
    }
    io.notify(fp.notVisible);
    return { ok: true, position: null, redirectUrl: res.redirectUrl };
  }

  const position = await resolvePositionSkills(res.position, { deps, hubAccessToken, lang });

  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, position, redirectUrl: res.redirectUrl }, null, 2)}\n`);
    return { ok: true, position };
  }

  renderDetail(io, fp, position);
  io.success(fp.done);
  return { ok: true, position };
}

module.exports = {
  makeShowProjectDeps,
  runShowProject,
  renderDetail,
};
