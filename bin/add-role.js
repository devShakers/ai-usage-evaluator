#!/usr/bin/env node
'use strict';

// `add-role` — add a role (GROWTH cluster) to the talent's profile (src/roles-flow.js).

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { makeIo } = require('./register');
const { runAddRole, makeRolesDeps } = require('../src/roles-flow');

function parseArgs(argv = []) {
  const o = { lang: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--lang') { const v = argv[++i]; o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = v === 'es' || v === 'en' ? v : null; }
  }
  return o;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, session: injectedSession = null, out = null } = {},
) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const r = catalog.roles;
  const write = out || ((s) => process.stdout.write(s));

  if (opts.help) {
    write(r.addHelp + '\n');
    return;
  }

  const session = injectedSession || loadAuthSession();
  if (sessionStatus(session) !== 'active') {
    process.stderr.write(`\n  ${r.loginRequired}\n\n`);
    process.exitCode = 1;
    return;
  }

  const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;
  const ask = injectedAsk || createStdinAsk();
  try {
    const io = makeIo({ ask, lang, out: write, stdinIsTTY });
    const result = await runAddRole({ io, session, catalog, deps: deps || makeRolesDeps() });
    if (result && result.ok === false) process.exitCode = 1;
    return result;
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run();
}
