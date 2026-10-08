'use strict';

// `availability` flow: view (hours/month, open-to-work, location), and `--set`
// (interactive, explicit confirmation — it writes your profile). Talent Bearer.

const { styleLabelPrefix } = require('./ansi');
const { WORK_MODES, validateAvailability } = require('./onboarding-flow');

function makeAvailabilityDeps(overrides = {}) {
  const client = require('./availability-client');
  return {
    fetchAvailability: (opts) => client.fetchAvailability({}, opts),
    saveAvailability: (opts) => client.saveAvailability({}, opts),
    promptSelect: (opts) => require('./prompt-select').promptSelect(opts),
    promptMultiSelect: (opts) => require('./prompt-select').promptMultiSelect(opts),
    ...overrides,
  };
}

function workModesLine(fp, modes) {
  return modes && modes.length ? modes.map((m) => fp.workModeLabels[m] || m).join(', ') : fp.unknown;
}

function locationLine(a) {
  return [a.country, a.subdivision, a.timezone].filter(Boolean).join(' · ') || null;
}

function renderView(io, fp, a) {
  io.section(fp.title);
  io.notify(styleLabelPrefix(fp.openToWork(a.available === true ? fp.yes : a.available === false ? fp.no : fp.unknown)));
  io.notify(styleLabelPrefix(fp.monthlyHours(a.monthlyHours != null ? a.monthlyHours : fp.unknown)));
  io.notify(styleLabelPrefix(fp.workModes(workModesLine(fp, a.workModes))));
  const loc = locationLine(a);
  if (loc) io.notify(styleLabelPrefix(fp.location(loc)));
  if (a.availabilityExpiringDate) io.notify(styleLabelPrefix(fp.expires(a.availabilityExpiringDate)));
  io.success(fp.done);
}

async function runSet({ io, ask, session, catalog, opts, deps }) {
  const fp = catalog.availability;
  const hubAccessToken = session ? session.hubAccessToken : null;
  if (!opts.stdinIsTTY) {
    io.error(fp.setNeedsInteractive);
    return { ok: false, reason: 'non-interactive' };
  }
  const selOut = (s) => io.notify(s);
  const yesNo = [{ label: fp.yes, value: true }, { label: fp.no, value: false }];
  const pickYesNo = (header) => deps.promptSelect({ ask, stdinIsTTY: opts.stdinIsTTY, out: selOut, header, items: yesNo, labelFor: (x) => x.label, input: opts.input, output: opts.output });

  const read = await io.withProgress(fp.loading, () => deps.fetchAvailability({ hubAccessToken }));
  const current = read.ok ? read.availability : null;
  if (!read.ok && read.reason !== 'not-found') {
    io.error(fp.fetchFailed(read.reason));
    return { ok: false, reason: read.reason };
  }

  io.section(fp.setTitle);
  if (current) renderView({ section: () => {}, notify: io.notify, success: () => {} }, fp, current);

  // Arrow-key yes/no pickers for the discrete fields.
  const openPick = await pickYesNo(fp.askOpenToWork);
  if (!openPick) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }
  const available = openPick.value;
  const hoursRaw = (await io.ask(fp.askMonthlyHours)).trim();
  if (hoursRaw && !/^\d{1,3}$/.test(hoursRaw)) { io.error(fp.monthlyHoursInvalid); return { ok: false, reason: 'bad-hours' }; }
  const pickedModes = await deps.promptMultiSelect({
    ask,
    stdinIsTTY: opts.stdinIsTTY,
    out: selOut,
    items: WORK_MODES,
    labelFor: (v) => fp.workModeLabels[v] || v,
    header: fp.workModesAsk,
    hint: fp.workModesHint,
    initialMarked: (current && Array.isArray(current.workModes)) ? current.workModes.map((m) => WORK_MODES.indexOf(m)).filter((i) => i >= 0) : [],
    input: opts.input,
    output: opts.output,
  });
  // Reuse the register validation (dedupe/upcase, enum check) — no duplicated logic.
  const workModes = validateAvailability({ workModes: pickedModes }).availability.workModes || [];
  if (workModes.length === 1 && workModes[0] === 'REMOTE') io.notify(fp.onlyRemoteNote);

  // Only the asked fields ride the partial upsert.
  const body = { available };
  if (hoursRaw) body.monthlyHours = hoursRaw;
  if (workModes.length) body.workModes = workModes;

  io.notify(fp.setDiff(
    `${available ? fp.yes : fp.no}`,
    hoursRaw || (current && current.monthlyHours) || fp.unknown,
    workModesLine(fp, workModes),
  ));
  const confirmed = await io.confirm(fp.setConfirm);
  if (!confirmed) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }

  const res = await io.withProgress(fp.setSaving, () => deps.saveAvailability({ hubAccessToken, availability: body }));
  if (!res.ok) { io.error(fp.setFailed(res.reason)); return { ok: false, reason: res.reason }; }
  io.success(fp.setDone);
  return { ok: true, set: body };
}

async function runAvailability({ io, rawOut, ask, session, catalog, opts = {}, deps = makeAvailabilityDeps() }) {
  const fp = catalog.availability;
  if (opts.set) return runSet({ io, ask, session, catalog, opts, deps });

  const hubAccessToken = session ? session.hubAccessToken : null;
  const doFetch = () => deps.fetchAvailability({ hubAccessToken });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) {
    io.error(res.reason === 'not-found' ? fp.notFound : fp.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }
  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, availability: res.availability }, null, 2)}\n`);
    return { ok: true, availability: res.availability };
  }
  renderView(io, fp, res.availability);
  return { ok: true, availability: res.availability };
}

module.exports = {
  makeAvailabilityDeps,
  runAvailability,
  locationLine,
};
