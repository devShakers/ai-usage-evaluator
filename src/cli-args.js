'use strict';

/*
 * CLI argument parsing, extracted from bin/report.js so it can be unit
 * tested directly (bin/report.js has no require.main guard and calls
 * main() on load, so it can't be required from a test file).
 *
 * talents-ai-score / ADR-007: `--enroll` and `--consent on|off` are RETIRED
 * (token-based enrollment model). Consent is no longer a per-run flag: it's
 * an interactive disclosure the CLI shows once (src/consent-flow.js), plus
 * three one-shot management flags (issue 007) that mirror the retired
 * `--enroll` pattern — they act immediately and do NOT scan:
 *   --consent-status          view the current decision/email/last send
 *   --consent-revoke          revoke consent (-> denied), no more sends
 *   --consent-email <correo>  change the persisted email, decision untouched
 *
 * talents-ai-score, issue 021: `--build-next-level` is an OPTIONAL,
 * explicitly-invoked phase (never runs during a normal scan) that writes
 * the deterministic starter artifact(s) for the next tier
 * (src/build-next-level.js). `--force` only matters alongside it, to
 * authorize overwriting an existing file — a separate, deliberate flag,
 * never implied by `--build-next-level` alone.
 */
function parseArgs(argv) {
  const opts = {
    html: false,
    json: false,
    save: true,
    root: null,
    help: false,
    consentStatus: false,
    consentRevoke: false,
    consentEmail: null,
    buildNextLevel: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--html' || a === '-w') opts.html = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-save') opts.save = false;
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--consent-status') opts.consentStatus = true;
    else if (a === '--consent-revoke') opts.consentRevoke = true;
    else if (a === '--consent-email') opts.consentEmail = argv[++i];
    else if (a.startsWith('--consent-email=')) opts.consentEmail = a.slice('--consent-email='.length);
    else if (a === '--build-next-level') opts.buildNextLevel = true;
    else if (a === '--force') opts.force = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

module.exports = { parseArgs };
