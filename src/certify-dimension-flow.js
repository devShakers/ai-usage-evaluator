'use strict';

// `certify` dimension flow: discover -> pick -> create -> LiveKit interview -> poll verdict.

const { runInteractiveMultiSelect } = require('./interactive-select');

function makeCertifyDimensionDeps(overrides = {}) {
  const config = require('./config');
  const client = require('./certify-dimension-client');
  const onboardingFlow = require('./onboarding-flow');
  return {
    getCertificationInterviewsEndpoint: config.getCertificationInterviewsEndpoint,
    // `{certsBase}/interviews` — shared base for LiveKit start/complete + the report poll.
    getInterviewsBase: config.getOnboardingInterviewsEndpoint,
    discoverOfferableDimensions: (opts) => client.discoverOfferableDimensions({}, opts),
    requestCreateCertificationInterview: client.requestCreateCertificationInterview,
    requestCertificationReport: client.requestCertificationReport,
    requestDimensionCase: client.requestDimensionCase,
    conductLivekitInterview: onboardingFlow.conductLivekitInterview,
    onboardingDeps: onboardingFlow.makeDeps(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ...overrides,
  };
}

// Numbered fallback when `ask` can't release stdin for raw mode.
async function askNumberedChoice(ask, promptText, count) {
  const raw = (await ask(promptText)).trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > count) return null;
  return n - 1;
}

async function chooseDimension(ask, stdinIsTTY, items, cd, out, { input, output } = {}) {
  const labelFor = (d) => `${d.slug}${d.state === 'EXPIRED' ? ` (${cd.stateExpired})` : ''}`;
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items,
      labelFor,
      header: cd.selectHeading,
      hint: cd.selectHint,
      single: true,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return picked && picked.length ? picked[0] : null;
  }
  out(`\n  ${cd.selectHeading}\n`);
  items.forEach((d, i) => out(`    ${i + 1}) ${labelFor(d)}\n`));
  const idx = await askNumberedChoice(ask, `  ${cd.selectPrompt(items.length)}`, items.length);
  return idx === null ? null : items[idx];
}

function resolveDimensionArg(arg, items) {
  if (arg == null) return null;
  const raw = String(arg).trim();
  const n = Number.parseInt(raw, 10);
  if (Number.isInteger(n) && String(n) === raw && n >= 1 && n <= items.length) return items[n - 1];
  return items.find((d) => d.dimensionKey === raw || d.slug === raw) || undefined;
}

// The evaluation lands one to two minutes after the interview ends, four when the queue is busy.
async function pollReport(deps, { interviewId, accessToken }, { base, attempts = 60, intervalMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const res = await deps.requestCertificationReport({ interviewId, accessToken }, { base });
    if (!res.ok) return { ok: false, reason: res.reason };
    if (res.ready) return { ok: true, report: res.report };
    if (i < attempts - 1) await deps.sleep(intervalMs);
  }
  return { ok: false, reason: 'timeout' };
}

function formatDay(iso, lang) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function renderVerdict(report, cd) {
  const lines = [];
  const band = report.band || report.level || report.combinedLevel;
  const dimension = report.dimensionName || report.dimension || report.dimensionKey;
  if (dimension) lines.push(cd.verdictDimension(dimension));
  if (band) lines.push(cd.verdictBand(band));
  if (typeof report.certified === 'boolean') lines.push(report.certified ? cd.verdictCertified : cd.verdictNotCertified);
  const summary = report.summary || report.rationale || report.feedback;
  if (typeof summary === 'string' && summary.trim()) lines.push(summary.trim());
  const areas = Array.isArray(report.areas) ? report.areas : null;
  if (areas && areas.length) {
    for (const a of areas) {
      const name = a && (a.name || a.area || a.tag);
      const note = a && (a.note || a.comment);
      if (name) lines.push(`- ${name}${note ? `: ${note}` : ''}`);
    }
  }
  return lines.join('\n  ');
}

// The statement is Markdown; the terminal shows it without the emphasis markers.
function renderCase(dimensionCase, cd) {
  const brief = dimensionCase.brief.replace(/(\*\*|__)(.+?)\1/g, '$2');
  const expectations = cd.caseExpectations[dimensionCase.testType];
  const lines = brief.split('\n');
  if (expectations) lines.push('', cd.caseExpectationsTitle, ...Object.values(expectations).map((e) => `- ${e}`));
  lines.push('', cd.caseBeforeStart);
  return lines.join('\n  ');
}

async function runCertifyDimension({ io, ask, stdinIsTTY, session, lang, catalog, opts = {}, deps = makeCertifyDimensionDeps() }) {
  const cd = catalog.certifyDimension;
  const accessToken = session ? session.accessToken : null;
  const hubAccessToken = session ? session.hubAccessToken : null;

  io.section(cd.title);

  const discovered = await io.withProgress(cd.discovering, () =>
    deps.discoverOfferableDimensions({ accessToken, hubAccessToken }));
  if (!discovered.ok) {
    io.error(cd.discoverFailed(discovered.reason));
    return { ok: false, reason: discovered.reason, step: 'discover' };
  }

  if (Array.isArray(discovered.unmatched) && discovered.unmatched.length > 0) {
    io.warn(cd.unmatchedNote(discovered.unmatched.join(', ')));
  }

  const offerable = Array.isArray(discovered.offerable) ? discovered.offerable : [];
  if (offerable.length === 0) {
    io.notify(cd.noneOfferable);
    return { ok: true, none: true };
  }
  const mainRole = discovered.mainRole;
  // The hub sends the main role as { clusterId, name, ... }.
  const mainRoleName = mainRole && typeof mainRole === 'object' ? mainRole.name || mainRole.clusterId : mainRole;
  if (mainRoleName) io.notify(cd.mainRole(mainRoleName));

  let chosen;
  if (opts.dimension != null) {
    const resolved = resolveDimensionArg(opts.dimension, offerable);
    if (!resolved) {
      io.error(cd.dimensionInvalid);
      return { ok: false, reason: 'bad-dimension', step: 'select' };
    }
    chosen = resolved;
    io.notify(cd.dimensionUsing(chosen.slug));
  } else if (!stdinIsTTY) {
    io.error(cd.selectNonInteractive);
    return { ok: false, reason: 'non-interactive', step: 'select' };
  } else {
    chosen = await chooseDimension(ask, stdinIsTTY, offerable, cd, (s) => io.notify(s.replace(/\n$/, '')), opts);
    if (!chosen) {
      io.notify(cd.selectNoneChosen);
      return { ok: true, cancelled: true };
    }
  }

  const createEndpoint = deps.getCertificationInterviewsEndpoint();
  const created = await io.withProgress(cd.creating, () =>
    deps.requestCreateCertificationInterview(
      { dimensionKey: chosen.dimensionKey, languageCode: lang, accessToken },
      { endpoint: createEndpoint },
    ));
  if (!created.ok) {
    io.error(created.reason === 'dimension-on-cooldown'
      ? cd.onCooldown(formatDay(created.availableOn, lang))
      : cd.createFailed(created.reason));
    return { ok: false, reason: created.reason, step: 'create' };
  }

  // A failed read leaves the run as it was before the case existed, like the web preview does.
  const caseRead = await deps.requestDimensionCase(
    { dimensionKey: chosen.dimensionKey, accessToken },
    { base: deps.getInterviewsBase() },
  );
  if (caseRead.ok && caseRead.case) {
    io.section(cd.caseTitle);
    io.notify(renderCase(caseRead.case, cd));
    if (stdinIsTTY) await ask(`  ${cd.caseReadyPrompt}`);
  }

  const interview = await deps.conductLivekitInterview(io, deps.onboardingDeps, {
    interviewId: created.interviewId,
    language: lang,
    plain: true,
  });
  if (!interview.ok) {
    io.warn(interview.reason === 'needs-web' ? cd.needsWeb : cd.interviewUnavailable(interview.reason));
    return { ok: false, reason: interview.reason, step: 'interview' };
  }

  const reportBase = deps.getInterviewsBase();
  const polled = await io.withProgress(cd.reportPolling, () =>
    pollReport(deps, { interviewId: created.interviewId, accessToken }, { base: reportBase }));
  if (!polled.ok) {
    io.warn(polled.reason === 'timeout' ? cd.reportTimeout : cd.reportFailed(polled.reason));
    return { ok: true, completed: 'interview', verdict: null };
  }

  io.section(cd.verdictTitle);
  io.notify(renderVerdict(polled.report, cd));
  io.success(cd.done);
  return { ok: true, completed: 'interview', verdict: polled.report };
}

module.exports = {
  makeCertifyDimensionDeps,
  runCertifyDimension,
  chooseDimension,
  resolveDimensionArg,
  pollReport,
  renderVerdict,
  renderCase,
};
