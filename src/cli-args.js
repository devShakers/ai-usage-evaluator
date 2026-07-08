'use strict';

/*
 * CLI argument parsing, extracted from bin/report.js so it can be unit
 * tested directly (bin/report.js has no require.main guard and calls
 * main() on load, so it can't be required from a test file).
 *
 * talents-ai-score / ADR-007: `--enroll` and `--consent on|off` are RETIRED
 * (token-based enrollment model). Consent is no longer a per-run flag: it's
 * an interactive disclosure the CLI shows once (src/consent-flow.js). The
 * one-shot management flags (--consent-status / --consent-revoke /
 * --consent-email) are added on top by issue 007.
 */
function parseArgs(argv) {
  const opts = {
    html: false,
    json: false,
    save: true,
    root: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--html' || a === '-w') opts.html = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-save') opts.save = false;
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

module.exports = { parseArgs };
