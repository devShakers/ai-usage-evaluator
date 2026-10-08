'use strict';

// `certifications` flow: render the talent's dimension certifications by state
// (certified / uncertified / expired) + band + main role. Read-only.

const { styleLabelPrefix } = require('./ansi');

function makeCertificationsDeps(overrides = {}) {
  const client = require('./certifications-client');
  return {
    fetchMeCertifications: (opts) => client.fetchMeCertifications({}, opts),
    ...overrides,
  };
}

function groupByState(dimensions) {
  const g = { certified: [], uncertified: [], expired: [] };
  for (const d of dimensions || []) {
    if (d.state === 'CERTIFIED') g.certified.push(d);
    else if (d.state === 'EXPIRED') g.expired.push(d);
    else g.uncertified.push(d);
  }
  return g;
}

function renderGroup(io, fp, heading, items, withBand) {
  if (!items.length) return;
  io.section(heading);
  items.forEach((d) => {
    const label = d.name || d.slug || fp.untitled;
    io.notify(withBand && d.band ? `${label} — ${d.band}` : label);
  });
}

async function runCertifications({ io, rawOut, session, catalog, opts = {}, deps = makeCertificationsDeps() }) {
  const fp = catalog.certifications;
  const hubAccessToken = session ? session.hubAccessToken : null;

  const doFetch = () => deps.fetchMeCertifications({ hubAccessToken });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) {
    io.error(fp.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }

  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, mainRole: res.mainRole, dimensions: res.dimensions, growingInto: res.growingInto }, null, 2)}\n`);
    return { ok: true, mainRole: res.mainRole, dimensions: res.dimensions };
  }

  io.section(fp.title);
  if (res.mainRole && res.mainRole.name) {
    const ratio = res.mainRole.total != null ? ` (${res.mainRole.certified ?? 0}/${res.mainRole.total})` : '';
    io.notify(styleLabelPrefix(fp.mainRole(res.mainRole.name) + ratio));
  } else {
    io.notify(fp.noMainRole);
  }

  const g = groupByState(res.dimensions);
  if (g.certified.length === 0 && g.uncertified.length === 0 && g.expired.length === 0) {
    io.notify(fp.noDimensions);
    return { ok: true, mainRole: res.mainRole, dimensions: res.dimensions };
  }
  renderGroup(io, fp, fp.headingCertified, g.certified, true);
  renderGroup(io, fp, fp.headingExpired, g.expired, true);
  renderGroup(io, fp, fp.headingUncertified, g.uncertified, false);
  io.success(fp.done);
  return { ok: true, mainRole: res.mainRole, dimensions: res.dimensions };
}

module.exports = {
  makeCertificationsDeps,
  groupByState,
  runCertifications,
};
