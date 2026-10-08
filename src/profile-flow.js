'use strict';

// `me` / `profile` flow: a summary combining the "My work with AI" read model,
// the main role (from certifications) and the per-project rate. Read-only.

const { styleLabelPrefix } = require('./ansi');

function makeProfileDeps(overrides = {}) {
  const profile = require('./profile-client');
  const rate = require('./rate-client');
  const certs = require('./certifications-client');
  const availability = require('./availability-client');
  return {
    fetchAiProfile: (opts) => profile.fetchAiProfile({}, opts),
    fetchPricingRate: (opts) => rate.fetchPricingRate({}, opts),
    fetchMeCertifications: (opts) => certs.fetchMeCertifications({}, opts),
    fetchMeProfile: (opts) => profile.fetchMeProfile({}, opts),
    fetchTalentMeProfile: (opts) => profile.fetchTalentMeProfile({}, opts),
    fetchLanguages: (opts) => profile.fetchLanguages({}, opts),
    fetchAvailability: (opts) => availability.fetchAvailability({}, opts),
    ...overrides,
  };
}

function trim(text, max) {
  if (!text) return null;
  const t = String(text).trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function runProfile({ io, rawOut, session, catalog, opts = {}, deps = makeProfileDeps() }) {
  const fp = catalog.profile;
  const hubAccessToken = session ? session.hubAccessToken : null;

  // Independent reads; each degrades to null so one outage never blanks the
  // whole summary.
  const doFetch = () => Promise.all([
    deps.fetchAiProfile({ hubAccessToken }),
    deps.fetchPricingRate({ hubAccessToken }),
    deps.fetchMeCertifications({ hubAccessToken }),
    deps.fetchMeProfile({ hubAccessToken }),
    deps.fetchTalentMeProfile({ hubAccessToken }),
    deps.fetchLanguages({ hubAccessToken }),
    deps.fetchAvailability({ hubAccessToken }),
  ]);
  const [ai, rate, certs, meProfile, talentProfile, languages, availability] = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);

  if (!ai.ok && !rate.ok && !certs.ok && !meProfile.ok && !talentProfile.ok) {
    io.error(fp.fetchFailed(ai.reason || rate.reason || certs.reason));
    return { ok: false, reason: ai.reason || rate.reason || certs.reason };
  }

  const aiProfile = ai.ok ? ai.aiProfile : null;
  const pricing = rate.ok ? rate.pricing : null;
  const mainRole = certs.ok ? certs.mainRole : null;
  const headline = meProfile.ok ? meProfile.headline : null;
  const completion = talentProfile.ok ? talentProfile.completedProfilePercentage : null;
  const freelanceType = talentProfile.ok ? talentProfile.freelanceType : null;
  const languageCodes = languages.ok ? languages.languageCodes : [];
  const availabilitySummary = availability.ok ? availability.availability : null;
  const skillsCount = certs.ok && certs.skillsRatio && typeof certs.skillsRatio.total === 'number' ? certs.skillsRatio.total : null;
  const agentsCount = aiProfile ? aiProfile.agentsOnProfile : null;

  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({
      ok: true, mainRole, headline, completedProfilePercentage: completion, freelanceType,
      languageCodes, skillsCount, agentsCount, availability: availabilitySummary, aiProfile, pricing,
    }, null, 2)}\n`);
    return { ok: true, mainRole, aiProfile, pricing };
  }

  io.section(fp.title);
  if (headline) io.notify(styleLabelPrefix(fp.headline(headline)));
  if (mainRole && mainRole.name) io.notify(styleLabelPrefix(fp.role(mainRole.name)));
  if (freelanceType) io.notify(styleLabelPrefix(fp.freelanceType(freelanceType)));
  if (completion != null) io.notify(styleLabelPrefix(fp.completion(completion)));
  if (pricing) {
    const m = pricing.fullTimeSelected ? pricing.fullTimePrice : null;
    io.notify(styleLabelPrefix(fp.rate(m && m.amount != null ? `${m.amount}${m.currency ? ` ${m.currency}` : ''}` : fp.rateNotSet)));
  }
  if (availabilitySummary) {
    io.notify(styleLabelPrefix(fp.availability(
      availabilitySummary.available === true ? fp.availYes : availabilitySummary.available === false ? fp.availNo : fp.availUnknown,
      availabilitySummary.monthlyHours || fp.availUnknown,
    )));
  }
  if (languageCodes.length) io.notify(styleLabelPrefix(fp.languages(languageCodes.join(', '))));
  const counts = [
    skillsCount != null ? fp.skillsCount(skillsCount) : null,
    agentsCount != null ? fp.agentsCount(agentsCount) : null,
  ].filter(Boolean);
  if (counts.length) io.notify(counts.join(' · '));
  if (aiProfile) {
    if (aiProfile.cell) io.notify(styleLabelPrefix(fp.cell(aiProfile.cell)));
    const axes = [
      aiProfile.setupTier ? styleLabelPrefix(fp.setup(aiProfile.setupTier, aiProfile.setupLevel || '—')) : null,
      aiProfile.usageLevel ? styleLabelPrefix(fp.usage(aiProfile.usageLevel)) : null,
    ].filter(Boolean);
    if (axes.length) io.notify(axes.join(' · '));
    if (aiProfile.isAiNative) io.notify(fp.aiNative);
    const vision = trim(aiProfile.vision, 240);
    if (vision) { io.section(fp.visionHeading); io.notify(vision); }
    const howIWork = trim(aiProfile.howIWork, 240);
    if (howIWork) { io.section(fp.howIWorkHeading); io.notify(howIWork); }
  } else {
    io.notify(fp.noAiProfile);
  }
  io.success(fp.done);
  return { ok: true, mainRole, aiProfile, pricing };
}

module.exports = {
  makeProfileDeps,
  runProfile,
};
