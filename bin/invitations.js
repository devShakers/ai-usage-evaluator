#!/usr/bin/env node
'use strict';

// `invitations` — the talent's unread position invitations (src/invitations-flow.js).

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { makeIo } = require('./register');
const { makeRevealSink } = require('../src/reveal-output');
const { runInvitations, makeInvitationsDeps } = require('../src/invitations-flow');

function parseInvitationsArgs(argv = []) {
  const o = { lang: null, help: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--lang') { const v = argv[++i]; o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a === '--json') o.json = true;
  }
  return o;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, session: injectedSession = null, out = null } = {},
) {
  const opts = parseInvitationsArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const fp = catalog.invitations;
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
  const sink = makeRevealSink({ json: opts.json, interactive: false, out, env: process.env });
  try {
    const io = makeIo({ ask, lang, out: sink.write, stdinIsTTY });
    const result = await runInvitations({
      io, rawOut: sink.write, session, catalog,
      opts: { json: opts.json },
      deps: deps || makeInvitationsDeps(),
    });
    await sink.finish();
    if (result && result.ok === false) process.exitCode = 1;
    return result;
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseInvitationsArgs };

if (require.main === module) {
  run();
}
