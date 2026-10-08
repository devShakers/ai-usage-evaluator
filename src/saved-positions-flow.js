'use strict';

// `save` / `unsave` flows: bookmark a Position. Reversible + idempotent, so no
// confirmation (owner: low risk). Talent Bearer.

function makeSavedPositionsDeps(overrides = {}) {
  const client = require('./saved-positions-client');
  return {
    savePosition: (opts) => client.savePosition({}, opts),
    unsavePosition: (opts) => client.unsavePosition({}, opts),
    resolveRef: (raw) => require('./find-projects-cache').resolvePositionRef(raw),
    ...overrides,
  };
}

async function runToggleSave({ io, rawOut, session, catalog, mode, opts = {}, deps = makeSavedPositionsDeps() }) {
  const fp = catalog.savedPositions;
  const hubAccessToken = session ? session.hubAccessToken : null;
  // A pure integer resolves against the last `find-projects` listing; a UUID/Mongo id passes through.
  const resolved = deps.resolveRef(opts.id);
  if (!resolved.ok) {
    const idRequired = mode === 'save' ? fp.saveIdRequired : fp.unsaveIdRequired;
    io.error(resolved.reason === 'no-cache' ? fp.refNoCache
      : resolved.reason === 'out-of-range' ? fp.refOutOfRange(resolved.count)
        : idRequired);
    return { ok: false, reason: resolved.reason };
  }
  const positionId = resolved.id;

  const label = mode === 'save' ? fp.saving : fp.unsaving;
  const res = await io.withProgress(label, () => (mode === 'save'
    ? deps.savePosition({ hubAccessToken, positionId })
    : deps.unsavePosition({ hubAccessToken, positionId })));
  if (!res.ok) {
    io.error(res.reason === 'not-found' ? fp.notFound : fp.failed(res.reason));
    return { ok: false, reason: res.reason };
  }

  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, mode, positionId }, null, 2)}\n`);
    return { ok: true };
  }
  io.success(mode === 'save' ? fp.saved : fp.unsaved);
  return { ok: true };
}

module.exports = {
  makeSavedPositionsDeps,
  runToggleSave,
};
