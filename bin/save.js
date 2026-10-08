#!/usr/bin/env node
'use strict';

// `save` / `unsave` — bookmark a Position (src/saved-positions-flow.js).

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { makeIo } = require('./register');
const { runToggleSave, makeSavedPositionsDeps } = require('../src/saved-positions-flow');
const { makeRevealSink } = require('../src/reveal-output');

function parseSaveArgs(argv = []) {
  const o = { lang: null, help: false, json: false, id: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--lang') { const v = argv[++i]; o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a === '--json') o.json = true;
    else if (a === '--id') o.id = argv[++i] != null ? argv[i] : null;
    else if (a.startsWith('--id=')) o.id = a.slice('--id='.length);
    else if (!a.startsWith('-') && o.id == null) o.id = a; // positional <id>
  }
  return o;
}

function makeRun(mode) {
  return async function run(
    argv = process.argv.slice(2),
    { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, session: injectedSession = null, out = null } = {},
  ) {
    const opts = parseSaveArgs(argv);
    const lang = opts.lang || detectReportLang();
    const catalog = getCatalog(lang);
    const fp = catalog.savedPositions;
    const write = out || ((s) => process.stdout.write(s));

    if (opts.help) {
      write((mode === 'save' ? fp.helpSave : fp.helpUnsave) + '\n');
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
    const sink = makeRevealSink({ json: opts.json, out, env: process.env });
    try {
      const io = makeIo({ ask, lang, out: sink.write, stdinIsTTY });
      const result = await runToggleSave({
        io, rawOut: sink.write, session, catalog, mode,
        opts: { id: opts.id, json: opts.json },
        deps: deps || makeSavedPositionsDeps(),
      });
      await sink.finish();
      if (result && result.ok === false) process.exitCode = 1;
      return result;
    } finally {
      if (!injectedAsk) ask.close();
    }
  };
}

const run = makeRun('save');
const runUnsave = makeRun('unsave');

module.exports = { run, runUnsave, parseSaveArgs };

if (require.main === module) {
  run();
}
