'use strict';

// `rate` flow: view the talent's per-project pricing, and `--set` to change it
// (interactive, explicit confirmation — it changes what clients pay).

const { styleLabelPrefix } = require('./ansi');

const CURRENCIES = ['EUR', 'USD', 'GBP'];
const MAX_AMOUNT = 999999.99;

function makeRateDeps(overrides = {}) {
  const client = require('./rate-client');
  return {
    fetchPricingRate: (opts) => client.fetchPricingRate({}, opts),
    savePricingRate: (opts) => client.savePricingRate({}, opts),
    promptSelect: (opts) => require('./prompt-select').promptSelect(opts),
    ...overrides,
  };
}

function priceLine(fp, money) {
  if (!money || money.amount == null) return fp.notSet;
  return `${money.amount}${money.currency ? ` ${money.currency}` : ''}`;
}

// Empty pricing when the talent has none yet (upsert still works).
const EMPTY_PRICING = { fullTimeSelected: false, fullTimePrice: null, partTimeSelected: false, partTimePrice: null };

function parseAmount(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return null;
  return n;
}

// Merge the chosen modality's new price into the current pricing → the PUT body
// (full object, so the untouched modality is preserved, never cleared).
function buildBody(current, modality, amount, currency) {
  const body = {
    fullTimeProjectSelected: current.fullTimeSelected === true,
    fullTimeProjectPrice: current.fullTimePrice ? { amount: current.fullTimePrice.amount, currency: current.fullTimePrice.currency } : null,
    partTimeProjectSelected: current.partTimeSelected === true,
    partTimeProjectPrice: current.partTimePrice ? { amount: current.partTimePrice.amount, currency: current.partTimePrice.currency } : null,
  };
  if (modality === 'full') { body.fullTimeProjectSelected = true; body.fullTimeProjectPrice = { amount, currency }; }
  else { body.partTimeProjectSelected = true; body.partTimeProjectPrice = { amount, currency }; }
  return body;
}

function renderView(io, fp, p) {
  io.section(fp.title);
  io.notify(styleLabelPrefix(fp.fullTime(priceLine(fp, p.fullTimeSelected ? p.fullTimePrice : null))));
  if (p.partTimeSelected) io.notify(styleLabelPrefix(fp.partTime(priceLine(fp, p.partTimePrice))));
  io.success(fp.done);
}

async function runSet({ io, ask, session, catalog, opts, deps }) {
  const fp = catalog.rate;
  const hubAccessToken = session ? session.hubAccessToken : null;
  if (!opts.stdinIsTTY) {
    io.error(fp.setNeedsInteractive);
    return { ok: false, reason: 'non-interactive' };
  }
  const selOut = (s) => io.notify(s);

  // Read current so we can show it, preserve the other modality, and diff.
  const read = await io.withProgress(fp.loading, () => deps.fetchPricingRate({ hubAccessToken }));
  if (!read.ok && read.reason !== 'not-found') {
    io.error(fp.fetchFailed(read.reason));
    return { ok: false, reason: read.reason };
  }
  const current = read.ok ? read.pricing : EMPTY_PRICING;

  io.section(fp.setTitle);
  io.notify(styleLabelPrefix(fp.fullTime(priceLine(fp, current.fullTimeSelected ? current.fullTimePrice : null))));
  io.notify(styleLabelPrefix(fp.partTime(priceLine(fp, current.partTimeSelected ? current.partTimePrice : null))));

  // Arrow-key pickers for every discrete choice (modality, currency).
  const modItem = await deps.promptSelect({
    ask, stdinIsTTY: opts.stdinIsTTY, out: selOut, header: fp.setWhich,
    items: [{ label: fp.modalityFull, value: 'full' }, { label: fp.modalityPart, value: 'part' }],
    labelFor: (x) => x.label, input: opts.input, output: opts.output,
  });
  if (!modItem) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }
  const modality = modItem.value;
  const modalityLabel = modality === 'full' ? fp.modalityFull : fp.modalityPart;

  const amount = parseAmount(await io.ask(fp.setAmount(modalityLabel)));
  if (amount === null) { io.error(fp.setAmountInvalid); return { ok: false, reason: 'bad-amount' }; }

  const currency = await deps.promptSelect({
    ask, stdinIsTTY: opts.stdinIsTTY, out: selOut, header: fp.setCurrency,
    items: CURRENCIES, labelFor: (x) => x, input: opts.input, output: opts.output,
  });
  if (!currency) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }

  const oldMoney = modality === 'full' ? (current.fullTimeSelected ? current.fullTimePrice : null) : (current.partTimeSelected ? current.partTimePrice : null);
  const oldStr = priceLine(fp, oldMoney);
  const newStr = `${amount} ${currency}`;
  io.notify(fp.setDiff(modalityLabel, oldStr, newStr));
  const confirmed = await io.confirm(fp.setConfirm);
  if (!confirmed) { io.notify(fp.setCancelled); return { ok: true, cancelled: true }; }

  const body = buildBody(current, modality, amount, currency);
  const res = await io.withProgress(fp.setSaving, () => deps.savePricingRate({ hubAccessToken, pricing: body }));
  if (!res.ok) { io.error(fp.setFailed(res.reason)); return { ok: false, reason: res.reason }; }
  io.success(fp.setDone(modalityLabel, newStr));
  return { ok: true, set: { modality, amount, currency } };
}

async function runRate({ io, rawOut, ask, session, catalog, opts = {}, deps = makeRateDeps() }) {
  const fp = catalog.rate;
  if (opts.set) return runSet({ io, ask, session, catalog, opts, deps });

  const hubAccessToken = session ? session.hubAccessToken : null;
  const doFetch = () => deps.fetchPricingRate({ hubAccessToken });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) {
    io.error(res.reason === 'not-found' ? fp.notFound : fp.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }
  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, pricing: res.pricing }, null, 2)}\n`);
    return { ok: true, pricing: res.pricing };
  }
  renderView(io, fp, res.pricing);
  return { ok: true, pricing: res.pricing };
}

module.exports = {
  makeRateDeps,
  runRate,
  parseAmount,
  buildBody,
  CURRENCIES,
};
