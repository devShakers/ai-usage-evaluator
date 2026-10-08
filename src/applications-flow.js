'use strict';

// `applications` flow: list the positions the talent applied to + status.
// Read-only. Writes the SAME ordinal->positionId cache as find-projects, so
// `show-project N` / `save-project N` work after `applications` too.

const { styleLabelPrefix } = require('./ansi');

function makeApplicationsDeps(overrides = {}) {
  const client = require('./applications-client');
  return {
    fetchApplications: (opts) => client.fetchApplications({}, opts),
    writePositionCache: (ids) => require('./find-projects-cache').writePositionCache(ids),
    ...overrides,
  };
}

async function runApplications({ io, rawOut, session, catalog, opts = {}, deps = makeApplicationsDeps() }) {
  const fp = catalog.applications;
  const hubAccessToken = session ? session.hubAccessToken : null;

  const doFetch = () => deps.fetchApplications({ hubAccessToken });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) {
    io.error(fp.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }
  const items = Array.isArray(res.items) ? res.items : [];

  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, items }, null, 2)}\n`);
    return { ok: true, items };
  }

  // Human path: refresh the number->positionId cache (last listing wins).
  try { deps.writePositionCache(items.map((it) => it.positionId)); } catch { /* best-effort */ }

  io.section(fp.title);
  if (items.length === 0) {
    io.notify(fp.none);
    return { ok: true, items };
  }
  // No ids in the human render (they ride the cache + --json).
  items.forEach((a, i) => {
    if (i > 0) io.notify('');
    const headline = a.title || a.projectName || fp.untitled;
    io.notify(`${i + 1}) ${headline}${a.company ? ` — ${a.company}` : ''}`);
    io.notify(styleLabelPrefix(fp.statusLine(a.status || fp.statusUnknown)));
  });
  io.notify(styleLabelPrefix(fp.countNote(items.length)));
  io.success(fp.done);
  return { ok: true, items };
}

module.exports = {
  makeApplicationsDeps,
  runApplications,
};
