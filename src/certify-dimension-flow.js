'use strict';

// `certify` dimension flow: discover -> pick -> hand over the web deep link. The interview runs on the web.

const { runInteractiveMultiSelect } = require('./interactive-select');

function makeCertifyDimensionDeps(overrides = {}) {
  const config = require('./config');
  const client = require('./certify-dimension-client');
  return {
    getTalentProfileUrl: config.getTalentProfileUrl,
    discoverOfferableDimensions: (opts) => client.discoverOfferableDimensions({}, opts),
    buildWebLink,
    ...overrides,
  };
}

// The web route validates the decoded `dimension` param against `^[^/]+\/[^/]+$`,
// so the separator slash stays literal and each segment is url-encoded.
function buildWebLink(profileUrl, { clusterId, slug } = {}) {
  if (!profileUrl || !clusterId || !slug) return null;
  let origin;
  try {
    origin = new URL(profileUrl).origin;
  } catch {
    return null;
  }
  return `${origin}/certifications?dimension=${encodeURIComponent(clusterId)}/${encodeURIComponent(slug)}`;
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

  const link = deps.buildWebLink(deps.getTalentProfileUrl(), { clusterId: chosen.clusterId, slug: chosen.slug });
  if (!link) {
    io.warn(cd.webHandoffNoLink);
    return { ok: true, handoff: null, dimension: chosen.dimensionKey };
  }

  io.notify(cd.webHandoff);
  io.notify(cd.webHandoffLink(link));
  return { ok: true, handoff: link, dimension: chosen.dimensionKey };
}

module.exports = {
  makeCertifyDimensionDeps,
  runCertifyDimension,
  buildWebLink,
  chooseDimension,
  resolveDimensionArg,
};
