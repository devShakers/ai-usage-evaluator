'use strict';

const { runInteractiveMultiSelect } = require('./interactive-select');

async function promptSelect({ ask, stdinIsTTY, out, items, labelFor = (x) => String(x), header = '', hint = '', input, output } = {}) {
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items,
      labelFor,
      header,
      hint,
      single: true,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return picked && picked.length ? picked[0] : null;
  }
  if (header) out(header);
  items.forEach((it, i) => out(`  ${i + 1}) ${labelFor(it)}`));
  const raw = (await ask('  > ')).trim();
  const n = parseInt(raw, 10);
  if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
  const lowered = raw.toLowerCase();
  return items.find((it) => labelFor(it).toLowerCase() === lowered || String(it).toLowerCase() === lowered) || null;
}

// Multi-pick variant: SPACE toggles, ENTER confirms; returns the chosen items as
// an array (possibly empty). Non-TTY fallback accepts space/comma-separated
// indices or labels.
async function promptMultiSelect({ ask, stdinIsTTY, out, items, labelFor = (x) => String(x), header = '', hint = '', initialMarked = [], input, output } = {}) {
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items,
      labelFor,
      header,
      hint,
      single: false,
      initialMarked,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return Array.isArray(picked) ? picked : [];
  }
  if (header) out(header);
  items.forEach((it, i) => out(`  ${i + 1}) ${labelFor(it)}`));
  const raw = (await ask('  > ')).trim();
  if (!raw) return [];
  const chosen = [];
  for (const tok of raw.split(/[\s,]+/).filter(Boolean)) {
    const n = parseInt(tok, 10);
    let item = null;
    if (Number.isInteger(n) && n >= 1 && n <= items.length) item = items[n - 1];
    else {
      const lowered = tok.toLowerCase();
      item = items.find((it) => labelFor(it).toLowerCase() === lowered || String(it).toLowerCase() === lowered) || null;
    }
    if (item != null && !chosen.includes(item)) chosen.push(item);
  }
  return chosen;
}

module.exports = { promptSelect, promptMultiSelect };
