'use strict';

// `lang` flow: view the talent's languages + levels, and `--set` (interactive,
// confirmation) to add/update one. The write is REPLACE-ALL, so we merge the
// chosen language into the current set and PATCH the whole list.

const { styleLabelPrefix } = require('./ansi');
const { LEVELS } = require('./lang-client');

function makeLangDeps(overrides = {}) {
  const client = require('./lang-client');
  return {
    fetchLanguages: (opts) => client.fetchLanguages({}, opts),
    fetchLanguageCatalog: (opts) => client.fetchLanguageCatalog({}, opts),
    saveLanguages: (opts) => client.saveLanguages({}, opts),
    promptSelect: (opts) => require('./prompt-select').promptSelect(opts),
    ...overrides,
  };
}

function renderView(io, fp, languages) {
  io.section(fp.title);
  if (!languages.length) { io.notify(fp.none); io.success(fp.done); return; }
  languages.forEach((l) => io.notify(styleLabelPrefix(fp.line(l.name || l.code || fp.unknownLang, l.level ? fp.levelLabel(l.level) : fp.unknownLevel))));
  io.success(fp.done);
}

async function runSet({ io, ask, session, catalog, opts, deps }) {
  const fp = catalog.lang;
  const hubAccessToken = session ? session.hubAccessToken : null;
  if (!opts.stdinIsTTY) { io.error(fp.setNeedsInteractive); return { ok: false, reason: 'non-interactive' }; }
  const selOut = (s) => io.notify(s);

  const cur = await io.withProgress(fp.loading, () => deps.fetchLanguages({ hubAccessToken }));
  if (!cur.ok) { io.error(fp.fetchFailed(cur.reason)); return { ok: false, reason: cur.reason }; }
  const cat = await io.withProgress(fp.loadingCatalog, () => deps.fetchLanguageCatalog({}));
  if (!cat.ok) { io.error(fp.catalogFailed(cat.reason)); return { ok: false, reason: cat.reason }; }

  const current = Array.isArray(cur.languages) ? cur.languages : [];
  io.section(fp.setTitle);
  if (current.length) current.forEach((l) => io.notify(styleLabelPrefix(fp.line(l.name || l.code, l.level ? fp.levelLabel(l.level) : fp.unknownLevel))));

  const langItem = await deps.promptSelect({
    ask, stdinIsTTY: opts.stdinIsTTY, out: selOut, header: fp.pickLanguage,
    items: cat.catalog, labelFor: (l) => l.name, input: opts.input, output: opts.output,
  });
  if (!langItem) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }

  const levelItem = await deps.promptSelect({
    ask, stdinIsTTY: opts.stdinIsTTY, out: selOut, header: fp.pickLevel,
    items: LEVELS.map((v) => ({ label: fp.levelLabel(v), value: v })), labelFor: (x) => x.label, input: opts.input, output: opts.output,
  });
  if (!levelItem) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }

  // Merge into the full set (replace-all): keep every other language, upsert this one.
  const merged = current.filter((l) => l.id !== langItem.id).map((l) => ({ id: l.id, level: l.level }));
  merged.push({ id: langItem.id, level: levelItem.value });

  io.notify(fp.setDiff(langItem.name, fp.levelLabel(levelItem.value)));
  const confirmed = await io.confirm(fp.setConfirm);
  if (!confirmed) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }

  const res = await io.withProgress(fp.setSaving, () => deps.saveLanguages({ hubAccessToken, languages: merged }));
  if (!res.ok) { io.error(fp.setFailed(res.reason)); return { ok: false, reason: res.reason }; }
  io.success(fp.setDone(langItem.name));
  return { ok: true, set: { id: langItem.id, level: levelItem.value } };
}

async function runLang({ io, rawOut, ask, session, catalog, opts = {}, deps = makeLangDeps() }) {
  const fp = catalog.lang;
  if (opts.set) return runSet({ io, ask, session, catalog, opts, deps });

  const hubAccessToken = session ? session.hubAccessToken : null;
  const doFetch = () => deps.fetchLanguages({ hubAccessToken });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) { io.error(fp.fetchFailed(res.reason)); return { ok: false, reason: res.reason }; }
  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, languages: res.languages }, null, 2)}\n`);
    return { ok: true, languages: res.languages };
  }
  renderView(io, fp, res.languages);
  return { ok: true, languages: res.languages };
}

module.exports = { makeLangDeps, runLang, renderView };
