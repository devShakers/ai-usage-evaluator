#!/usr/bin/env node
'use strict';

// `find-projects` — list the Positions/Projects available to the talent (src/find-projects-flow.js).

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { makeIo } = require('./register');
const { runFindProjects, makeFindProjectsDeps } = require('../src/find-projects-flow');
const { makeRevealSink } = require('../src/reveal-output');

function toInt(v) {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}

function parseFindProjectsArgs(argv = []) {
  const o = { lang: null, help: false, tab: null, json: false, limit: null, page: null, attendance: null, country: null, recommended: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--lang') { const v = argv[++i]; o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a === '--tab') o.tab = argv[++i] != null ? argv[i] : null;
    else if (a.startsWith('--tab=')) o.tab = a.slice('--tab='.length);
    else if (a === '--limit') o.limit = toInt(argv[++i]);
    else if (a.startsWith('--limit=')) o.limit = toInt(a.slice('--limit='.length));
    else if (a === '--page') o.page = toInt(argv[++i]);
    else if (a.startsWith('--page=')) o.page = toInt(a.slice('--page='.length));
    else if (a === '--attendance') o.attendance = argv[++i] != null ? argv[i] : null;
    else if (a.startsWith('--attendance=')) o.attendance = a.slice('--attendance='.length);
    else if (a === '--country') o.country = argv[++i] != null ? argv[i] : null;
    else if (a.startsWith('--country=')) o.country = a.slice('--country='.length);
    else if (a === '--recommended') o.recommended = true;
    else if (a === '--json') o.json = true;
  }
  return o;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, session: injectedSession = null, out = null } = {},
) {
  const opts = parseFindProjectsArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const fp = catalog.findProjects;
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
  const sink = makeRevealSink({ json: opts.json, out, env: process.env });
  try {
    const io = makeIo({ ask, lang, out: sink.write, stdinIsTTY });
    const result = await runFindProjects({
      io,
      rawOut: sink.write,
      session,
      lang,
      catalog,
      opts: { tab: opts.tab, json: opts.json, limit: opts.limit, page: opts.page, attendance: opts.attendance, country: opts.country, recommended: opts.recommended },
      deps: deps || makeFindProjectsDeps(),
    });
    await sink.finish();
    if (result && result.ok === false) process.exitCode = 1;
    return result;
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseFindProjectsArgs };

if (require.main === module) {
  run();
}
