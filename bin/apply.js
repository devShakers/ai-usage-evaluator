#!/usr/bin/env node
'use strict';

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { makeIo } = require('./register');
const { runApply, makeApplyDeps } = require('../src/apply-flow');

function parseApplyArgs(argv = []) {
  const o = { lang: null, help: false, id: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--lang') { const v = argv[++i]; o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a === '--id') o.id = argv[++i] != null ? argv[i] : null;
    else if (a.startsWith('--id=')) o.id = a.slice('--id='.length);
    else if (!a.startsWith('-') && o.id == null) o.id = a;
  }
  return o;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, session: injectedSession = null, out = null, input, output } = {},
) {
  const opts = parseApplyArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const fp = catalog.apply;
  const write = out || ((s) => process.stdout.write(s));

  if (opts.help) {
    write(fp.help + '\n');
    return;
  }

  const session = injectedSession || loadAuthSession();
  if (sessionStatus(session) !== 'active') {
    process.stderr.write(`\n  ${fp.loginRequired}\n\n`);
    process.exitCode = 1;
    return;
  }

  const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;
  const ask = injectedAsk || createStdinAsk();
  try {
    const io = makeIo({ ask, lang, out: write, stdinIsTTY });
    const result = await runApply({
      io, ask, session, catalog,
      opts: { id: opts.id, stdinIsTTY, input, output },
      deps: deps || makeApplyDeps(),
    });
    if (result && result.ok === false) process.exitCode = 1;
    return result;
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseApplyArgs };

if (require.main === module) {
  run();
}
