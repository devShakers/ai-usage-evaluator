#!/usr/bin/env node
'use strict';

/*
 * `share` — turns the project's AI-usage FOOTPRINT result into a branded card
 * to post on LinkedIn (skill-code-certification). Like the other commands it is
 * exposed as `run(argv, { ask })` (ADR-014) so the branded REPL (bin/sh-eval.js)
 * can dispatch it; standalone `node bin/share.js` also works via the
 * require.main guard.
 *
 * It reads the LAST footprint stored for the current project (report-state.json)
 * and writes a self-contained HTML card under ~/.config/ai-footprint/, then
 * prints its file:// link. The card is generated ENTIRELY offline; the PNG is
 * built in the browser (SVG->canvas->PNG). No footprint for this project ->
 * an actionable "run footprint first" message (never a fabricated result).
 *
 * The card surface is English-fixed (brand); THIS CLI copy is localized via
 * the machine locale (or --lang), like every other command's output.
 */

const { detectReportLang, getCatalog } = require('./../src/i18n');
const { generateShareCard } = require('./../src/share-card');

const VALID_LANGS = new Set(['es', 'en']);

// Minimal, share-specific arg parsing: --root <dir>, --lang es|en, --help.
// (bin/report.js's parseArgs carries many footprint-only flags that don't
// apply here, so `share` keeps its own tiny parser.)
function parseShareArgs(argv) {
  const opts = { root: null, lang: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length);
    else if (a === '--lang') opts.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) {
      const value = a.slice('--lang='.length);
      opts.lang = VALID_LANGS.has(value) ? value : null;
    } else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

// `ask` is accepted for signature parity with the other REPL commands (the
// shared nested-stdin reader); `share` is non-interactive, so it isn't used.
async function run(argv = process.argv.slice(2), { ask } = {}) { // eslint-disable-line no-unused-vars
  const opts = parseShareArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const s = catalog.cli.share;

  if (opts.help) {
    process.stdout.write(`\n  ${s.help}\n\n`);
    return;
  }

  let result;
  try {
    result = generateShareCard({ root: opts.root });
  } catch {
    // Never crash the shell over a failed card write.
    process.stdout.write(`\n  ${s.error}\n\n`);
    return;
  }

  if (!result.ok) {
    process.stdout.write(`\n  ${s.noFootprint}\n\n`);
    return;
  }

  process.stdout.write(`\n  ${s.ready(result.fileUrl)}\n`);
  process.stdout.write(`  ${s.hint}\n\n`);
}

module.exports = { run, parseShareArgs };

// Only auto-run when executed directly (guarded so the REPL can require() it).
if (require.main === module) {
  run();
}
