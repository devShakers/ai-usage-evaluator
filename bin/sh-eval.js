#!/usr/bin/env node
'use strict';

// Runtime Node preflight — a CLEAR message instead of a cryptic failure when the
// tool is launched on too-old Node (the installed `sh-eval` shim also checks
// before invoking node; this covers a direct `node bin/sh-eval.js`). ES5-only so
// it always parses.
var _nodeMajor = parseInt((process.versions && process.versions.node || '0').split('.')[0], 10);
if (_nodeMajor < 18) {
  process.stderr.write(
    '\n  sh-eval requires Node 18 or newer (you have ' + process.version + ').\n'
    + '  Update Node from https://nodejs.org and re-run.\n\n',
  );
  process.exit(1);
}

/*
 * `sh-eval` — the SINGLE entrypoint of this tool (ADR-014). Opens a branded
 * Shakers mini-shell (REPL, Claude-Code style) where the commands run:
 *   footprint [args]   scan this project + machine, score the AI setup
 *   certify   [args]   certify Skills from this project's code
 *   report    [args]   open the full shareable HTML report (footprint + certs)
 *   share     [args]   branded footprint card for LinkedIn
 *   help | clear | exit/quit
 *
 * No behaviour change to the commands — they're the SAME `run(args,{ask})` from
 * bin/report.js / bin/certify.js, just wrapped in the REPL. The former
 * `ai-footprint`/`ai-certify` binaries are no longer installed (install.sh only
 * exposes `sh-eval`); their logic stays here for the REPL to import.
 *
 * Zero-dependency: readline + ANSI (src/repl-shell.js / src/repl-stdin.js).
 *
 * Nested stdin (the delicate bit): a SINGLE shared reader (src/repl-stdin.js)
 * drives both the prompt loop and the running command, so piped input is never
 * lost between them. See src/repl-stdin.js's header for the full rationale.
 */

const { detectReportLang } = require('../src/i18n');
const { createReplStdin } = require('../src/repl-stdin');
const { runRepl, renderGoodbye } = require('../src/repl-shell');
const { run: runFootprint } = require('./report');
const { run: runCertify } = require('./certify');
const { run: runShare } = require('./share');
const { run: runReport } = require('./report-html');
const { run: runMap } = require('./map');
const { run: runSuperadmin } = require('./superadmin');

let VERSION = '';
try {
  VERSION = require('../package.json').version || '';
} catch {
  VERSION = '';
}

// `--lang es|en` before opening the shell forces the chrome language; otherwise
// the OS locale decides (same detection the reports use). Env vars (endpoints,
// config dir) are inherited by the child command logic straight from
// process.env — the REPL adds nothing and strips nothing.
function parseLang(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang' && (argv[i + 1] === 'es' || argv[i + 1] === 'en')) return argv[i + 1];
    if (a === '--lang=es') return 'es';
    if (a === '--lang=en') return 'en';
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const lang = parseLang(argv) || detectReportLang();

  let stdin;
  const onInterrupt = () => {
    // Ctrl-C on a TTY: say goodbye and exit cleanly rather than dumping a stack.
    // Same farewell (goodbye + Shakers link) as exit/quit/Ctrl-D.
    process.stdout.write(`\n${renderGoodbye({ lang, color: !!process.stdout.isTTY })}`);
    if (stdin) stdin.close();
    process.exit(0);
  };
  stdin = createReplStdin({ onInterrupt });

  await runRepl({
    stdin,
    lang,
    version: VERSION,
    deps: { runFootprint, runCertify, runShare, runReport, runMap, runSuperadmin },
  });

  stdin.close();

  // A cleanly-closed interactive shell exits 0. A command run inside may have
  // set process.exitCode (e.g. certify with no endpoint) to signal ITS failure
  // in-band; that must not become a sticky, misleading exit code for the whole
  // session. CI/scripting on per-command exit codes is out of scope now that
  // the REPL is the only entrypoint (ADR-014) — the error was already shown.
  process.exitCode = 0;
}

main();
