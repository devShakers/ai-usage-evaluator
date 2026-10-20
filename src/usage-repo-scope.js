'use strict';

// Repo-scoping for the `ai-usage` command, extracted from bin/ai-usage.js.

const core = require('./repo-scope');
const { promptSelect } = require('./prompt-select');
const { createStdinAsk } = require('./stdin-ask');

const { SCOPE_MACHINE, SCOPE_REPO, machineWideToplevels } = core;

async function promptScope({ catalog, stdinIsTTY = true, mkAsk = createStdinAsk } = {}) {
  const c = (catalog && catalog.cli) || {};
  const items = [
    { key: SCOPE_MACHINE, label: c.reposScopeOptionMachine || 'Whole machine' },
    { key: SCOPE_REPO, label: c.reposScopeOptionRepo || 'Current repo' },
  ];
  const ask = mkAsk();
  try {
    const picked = await promptSelect({
      ask,
      stdinIsTTY,
      out: (s) => process.stdout.write(`${s}\n`),
      items,
      labelFor: (it) => it.label,
      header: c.reposScopePromptHeader || '',
      hint: c.reposScopePromptHint || '',
    });
    return picked ? picked.key : null;
  } finally {
    if (ask && typeof ask.close === 'function') ask.close();
  }
}

function resolveRepoScope(args) {
  return core.resolveRepoScope({
    ...args,
    chooseScope: args.chooseScope || promptScope,
    note: (s) => {
      if (!args.opts.json) process.stdout.write(`\n  ${s}\n`);
    },
  });
}

module.exports = { resolveRepoScope, machineWideToplevels, promptScope };
