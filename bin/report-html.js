#!/usr/bin/env node
'use strict';

/*
 * `report` — materializes and OPENS the shareable, cumulative HTML report for
 * the current project (ADR-016). This is the FULL report meant to be shared
 * with the team: the footprint (tier, score, agents with per-agent scores +
 * rationale + usage, technologies, roadmap) AND any certified Skills for this
 * project, in one self-contained HTML page.
 *
 * ADR-016 moved the HTML out of `footprint`/`certify`: those now persist state
 * only and print NO link — `report` is the single way to produce/open the HTML.
 * Like the other REPL commands it's exposed as `run(argv,{ask})` so the branded
 * shell (bin/sh-eval.js) can dispatch it; standalone `node bin/report-html.js`
 * also works via the require.main guard.
 *
 * It reads the per-project state (report-state.json) written by footprint/
 * certify. No footprint/cert for this project yet -> an actionable "run
 * footprint first" message (never a fabricated report). It opens the HTML in
 * the OS default browser (best-effort, degrades to just printing the link) and
 * always prints the clickable file:// link. THIS CLI copy is localized; the
 * report page itself follows the run language.
 */

const { detectReportLang, getCatalog } = require('../src/i18n');
const { materializeProjectReport } = require('../src/report-store');
const { openPath } = require('../src/open-file');
const { oscLink } = require('../src/osc-link');

const VALID_LANGS = new Set(['es', 'en']);

// Minimal, report-specific arg parsing: --root <dir>, --lang es|en, --no-open,
// --help. (--no-open suppresses the browser launch — useful for CI / headless /
// tests; the link is still printed.)
function parseReportArgs(argv) {
  const opts = { root: null, lang: null, open: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length);
    else if (a === '--lang') opts.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) {
      const value = a.slice('--lang='.length);
      opts.lang = VALID_LANGS.has(value) ? value : null;
    } else if (a === '--no-open') opts.open = false;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

// `ask` is accepted for signature parity with the other REPL commands; `report`
// is non-interactive so it isn't used.
async function run(argv = process.argv.slice(2), { ask } = {}) { // eslint-disable-line no-unused-vars
  const opts = parseReportArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const r = catalog.cli.report;

  if (opts.help) {
    process.stdout.write(`\n  ${r.help}\n\n`);
    return;
  }

  let result;
  try {
    result = materializeProjectReport({ root: opts.root, lang });
  } catch {
    // Never crash the shell over a failed report write.
    process.stdout.write(`\n  ${r.error}\n\n`);
    return;
  }

  if (!result.hasData) {
    process.stdout.write(`\n  ${r.noData}\n\n`);
    return;
  }

  const opened = opts.open ? openPath(result.htmlPath) : false;

  // Clear "the report was UPDATED" notice (fires once per run — this is the sole
  // report write point, ADR-016). OSC 8: clickable file:// link where supported.
  const updatedLabel = lang === 'es' ? 'Report actualizado' : 'Report updated';
  process.stdout.write(`\n  ✓ ${updatedLabel} · ${oscLink(result.fileUrl)}\n`);
  if (opened) process.stdout.write(`  ${r.opening}\n`);
  process.stdout.write('\n');
}

module.exports = { run, parseReportArgs };

// Only auto-run when executed directly (guarded so the REPL can require() it).
if (require.main === module) {
  run();
}
