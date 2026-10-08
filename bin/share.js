#!/usr/bin/env node
'use strict';

// `share` — turns the project's AI-usage FOOTPRINT result into a branded card to post on LinkedIn (skill-code-certification).

const { detectReportLang, getCatalog } = require('./../src/i18n');
const { generateShareCard } = require('./../src/share-card');
const { oscLink } = require('./../src/osc-link');

const VALID_LANGS = new Set(['es', 'en']);

const SHARE_DISABLED = true;

// Minimal, share-specific arg parsing: --root <dir>, --lang es|en, --help.
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

  if (SHARE_DISABLED) {
    process.stdout.write(`\n  ${s.disabled}\n\n`);
    return;
  }

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

  // OSC 8: clickable file:// link to the card in iTerm2 &c.; plain URL elsewhere.
  process.stdout.write(`\n  ${s.ready(oscLink(result.fileUrl))}\n`);
  process.stdout.write(`  ${s.hint}\n\n`);
}

module.exports = { run, parseShareArgs };

// Only auto-run when executed directly (guarded so the REPL can require() it).
if (require.main === module) {
  run();
}
