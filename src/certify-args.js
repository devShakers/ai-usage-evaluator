'use strict';

/*
 * CLI argument parsing for the `ai-certify` binary (skill-code-certification,
 * issue 004), kept SEPARATE from src/cli-args.js (which parses `ai-footprint`)
 * because the two binaries have deliberately different surfaces: ai-certify
 * has no reporting/HTML/consent flags, and it adds certification-specific ones.
 * Extracted from bin/certify.js so it can be unit-tested directly (bin/*.js
 * call main() on load and can't be require()d — same constraint noted in
 * src/cli-args.js's header).
 *
 * Flags (V1 = resolve phase only; the sampling/certify phase is issue 005):
 *   --root DIR            Scan DIR for technologies instead of the cwd.
 *   --email E             Identity email (else: the one stored by ai-footprint's
 *                         consent flow, else an interactive prompt).
 *   --lang es|en          Force the output language instead of OS-locale detect.
 *   --accept-disclaimer   Pre-accept the legal disclaimer (ADR-001) so the run
 *                         is non-interactive (CI/scripts). Acceptance is still
 *                         EXPLICIT — a deliberate flag, never implied. Without
 *                         it, an interactive y/n confirmation is shown before
 *                         ANY egress.
 *   --all                 Certify ALL certifiable Skills (non-interactive
 *                         selection).
 *   --skills 1,3          Certify the certifiable Skills at these 1-based
 *                         positions (non-interactive selection).
 *   --html                Also write + open a self-contained HTML report.
 *   -h, --help            Show help.
 *
 * Unrecognized `--lang` values degrade to null (auto-detect), never guessed —
 * same rule as cli-args.js. `--all`/`--skills` let the certify phase run
 * without a TTY; without either, non-TTY input can't select Skills and the
 * certify phase aborts (no code sent).
 */
const VALID_LANGS = new Set(['es', 'en']);

function parseCertifyArgs(argv) {
  const opts = {
    root: null,
    email: null,
    lang: null,
    acceptDisclaimer: false,
    all: false,
    skills: null,
    html: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length);
    else if (a === '--email') opts.email = argv[++i];
    else if (a.startsWith('--email=')) opts.email = a.slice('--email='.length);
    else if (a === '--lang') opts.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) {
      const value = a.slice('--lang='.length);
      opts.lang = VALID_LANGS.has(value) ? value : null;
    } else if (a === '--accept-disclaimer') opts.acceptDisclaimer = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--skills') opts.skills = argv[++i];
    else if (a.startsWith('--skills=')) opts.skills = a.slice('--skills='.length);
    else if (a === '--html' || a === '-w') opts.html = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

module.exports = { parseCertifyArgs };
