#!/usr/bin/env node
'use strict';

const { detectReportLang, getCatalog } = require('../src/i18n');
const { parseArgs } = require('../src/cli-args');
const { handleOneShotCommand } = require('../src/usage-oneshot-commands');
const { createLazyStdinAsk } = require('../src/stdin-ask');
const { computeUsage } = require('../src/usage-scan');
const { hasAccountTrace } = require('../src/account-trace');
const {
  resolveRepoScope,
  machineWideToplevels,
  promptScope,
} = require('../src/usage-repo-scope');
const {
  prepareIdentityAndUsage,
  resolveAiConsent,
  renderAndFinalize,
} = require('../src/usage-run-steps');

// Shared by the dispatcher and register flow: an injected `ask` is caller-owned, `bypassThrottle` is register-only.
async function run(argv = process.argv.slice(2), { ask: injectedAsk = null, bypassThrottle = false, inRegistration = false } = {}) {
  const opts = parseArgs(argv);

  // Resolve language first so even --help is localized.
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);

  if (opts.help) {
    process.stdout.write(catalog.cli.help);
    return;
  }

  // One-shot commands (consent/endpoint config): act immediately, do NOT scan.
  if (await handleOneShotCommand({ opts, catalog, injectedAsk })) return;

  if (opts.roadmap && hasAccountTrace()) {
    process.stdout.write(`\n  ${catalog.cli.roadmapNotForAccounts}\n\n`);
    return;
  }

  const ask = injectedAsk || createLazyStdinAsk();
  try {
    const { report, maturity, root, gate, repos } = await computeUsage({
      opts,
      catalog,
      lang,
      inRegistration,
      prepareIdentity: prepareIdentityAndUsage,
      resolveConsent: (args) => resolveAiConsent({ ...args, injectedAsk: ask }),
      resolveScope: async (args) => {
        if (injectedAsk) return resolveRepoScope({ ...args, injectedAsk });
        ask.suspend();
        try {
          return await resolveRepoScope(args);
        } finally {
          ask.resume();
        }
      },
    });

    await renderAndFinalize({ report, maturity, lang, opts, root, gate, catalog, bypassThrottle, repos, injectedAsk: ask });
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, resolveRepoScope, machineWideToplevels, promptScope };

// Auto-run only when executed directly, not when require()'d by the dispatcher.
if (require.main === module) {
  run();
}
