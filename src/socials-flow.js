'use strict';

// `socials` flow: view the talent's social links, and `--set` (interactive,
// confirmation) to add/update/clear one. The write upserts the WHOLE object, so
// we merge the chosen field into the current object and PUT it.

const { styleLabelPrefix } = require('./ansi');
const { NETWORKS } = require('./socials-client');

function makeSocialsDeps(overrides = {}) {
  const client = require('./socials-client');
  return {
    fetchSocials: (opts) => client.fetchSocials({}, opts),
    saveSocials: (opts) => client.saveSocials({}, opts),
    promptSelect: (opts) => require('./prompt-select').promptSelect(opts),
    ...overrides,
  };
}

function setNetworks(social) {
  return NETWORKS.filter((k) => social && social[k]);
}

function renderView(io, fp, social) {
  io.section(fp.title);
  const present = setNetworks(social);
  if (!present.length) { io.notify(fp.none); io.success(fp.done); return; }
  present.forEach((k) => io.notify(styleLabelPrefix(fp.line(fp.networkLabel(k), social[k]))));
  io.success(fp.done);
}

async function runSet({ io, ask, session, catalog, opts, deps }) {
  const fp = catalog.socials;
  const hubAccessToken = session ? session.hubAccessToken : null;
  if (!opts.stdinIsTTY) { io.error(fp.setNeedsInteractive); return { ok: false, reason: 'non-interactive' }; }
  const selOut = (s) => io.notify(s);

  const cur = await io.withProgress(fp.loading, () => deps.fetchSocials({ hubAccessToken }));
  if (!cur.ok) { io.error(fp.fetchFailed(cur.reason)); return { ok: false, reason: cur.reason }; }
  const social = { ...cur.social };

  io.section(fp.setTitle);
  const present = setNetworks(social);
  if (present.length) present.forEach((k) => io.notify(styleLabelPrefix(fp.line(fp.networkLabel(k), social[k]))));

  const net = await deps.promptSelect({
    ask, stdinIsTTY: opts.stdinIsTTY, out: selOut, header: fp.pickNetwork,
    items: NETWORKS.map((k) => ({ label: fp.networkLabel(k), value: k })), labelFor: (x) => x.label, input: opts.input, output: opts.output,
  });
  if (!net) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }
  const key = net.value;

  const raw = (await io.ask(fp.askUrl(fp.networkLabel(key)))).trim();
  const value = raw === '' ? null : raw;
  social[key] = value;

  io.notify(value ? fp.setDiffSet(fp.networkLabel(key), value) : fp.setDiffClear(fp.networkLabel(key)));
  const confirmed = await io.confirm(fp.setConfirm);
  if (!confirmed) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }

  const res = await io.withProgress(fp.setSaving, () => deps.saveSocials({ hubAccessToken, social }));
  if (!res.ok) { io.error(fp.setFailed(res.reason)); return { ok: false, reason: res.reason }; }
  io.success(value ? fp.setDone(fp.networkLabel(key)) : fp.setCleared(fp.networkLabel(key)));
  return { ok: true, set: { key, value } };
}

async function runSocials({ io, rawOut, ask, session, catalog, opts = {}, deps = makeSocialsDeps() }) {
  const fp = catalog.socials;
  if (opts.set) return runSet({ io, ask, session, catalog, opts, deps });

  const hubAccessToken = session ? session.hubAccessToken : null;
  const doFetch = () => deps.fetchSocials({ hubAccessToken });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) { io.error(fp.fetchFailed(res.reason)); return { ok: false, reason: res.reason }; }
  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, social: res.social }, null, 2)}\n`);
    return { ok: true, social: res.social };
  }
  renderView(io, fp, res.social);
  return { ok: true, social: res.social };
}

module.exports = { makeSocialsDeps, runSocials, setNetworks, renderView };
