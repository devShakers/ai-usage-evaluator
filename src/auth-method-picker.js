'use strict';

const { runInteractiveMultiSelect } = require('./interactive-select');
const { methodsForFlow, methodLabel } = require('./auth-methods');

// The shared interactive method picker for the CLI (talents-ai-score).
async function askNumberedChoice(ask, promptText, count) {
  const raw = (await ask(promptText)).trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > count) return null;
  return n - 1;
}

async function chooseAuthMethod({ flow, ask, stdinIsTTY, catalog, input, output } = {}) {
  const methods = methodsForFlow(flow);
  if (methods.length === 0) return null;
  if (methods.length === 1) return methods[0].id;
  if (!stdinIsTTY) return methods[0].id;

  if (ask && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items: methods,
      labelFor: (m) => methodLabel(m, catalog),
      header: catalog.chooseMethodHeading,
      hint: catalog.selectHint,
      single: true,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    if (typeof ask.resume === 'function') ask.resume();
    if (!picked || picked.length === 0) return null;
    return picked[0].id;
  }

  const stream = output || process.stdout;
  stream.write(`\n  ${catalog.chooseMethodHeading}\n`);
  methods.forEach((m, i) => stream.write(`    ${i + 1}) ${methodLabel(m, catalog)}\n`));
  const idx = await askNumberedChoice(ask, `  ${catalog.chooseMethodPrompt(methods.length)}`, methods.length);
  return idx === null ? null : methods[idx].id;
}

module.exports = { chooseAuthMethod, askNumberedChoice };
