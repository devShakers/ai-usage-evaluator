#!/usr/bin/env node
'use strict';

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { promptSelect } = require('../src/prompt-select');
const { makeIo } = require('./register');
const { runAlmaShell } = require('../src/alma-shell');
const { makeAlmaDeps } = require('../src/alma-flow');
const { run: runLogin } = require('./login');

function parseArgs(argv = []) {
  const o = { lang: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--help' || x === '-h') o.help = true;
    else if (x === '--lang') { const v = argv[++i]; o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (x.startsWith('--lang=')) { const v = x.slice(7); o.lang = v === 'es' || v === 'en' ? v : null; }
  }
  return o;
}

async function ensureSession({ lang, catalog, ask, stdinIsTTY, out }) {
  let session = loadAuthSession();
  if (sessionStatus(session) === 'active') return session;
  if (!stdinIsTTY) return null;

  const r = catalog.cli.accountReminder;
  const choice = await promptSelect({
    ask,
    stdinIsTTY,
    out: (line) => out(`  ${line}\n`),
    header: r.question,
    hint: r.hint,
    items: [{ id: 'yes', label: r.yes }, { id: 'no', label: r.no }],
    labelFor: (it) => it.label,
  });
  if (!choice || choice.id !== 'yes') return null;

  await runLogin(['--lang', lang]);
  session = loadAuthSession();
  return sessionStatus(session) === 'active' ? session : null;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, session: injectedSession = null, out = null } = {},
) {
  const opts = parseArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const a = catalog.alma;
  const write = out || ((s) => process.stdout.write(s));
  const d = deps || makeAlmaDeps();

  if (opts.help) {
    write(a.help + '\n');
    return;
  }

  const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;
  if (!stdinIsTTY && !injectedSession) {
    process.stderr.write(`\n  ${a.needTty}\n\n`);
    process.exitCode = 1;
    return;
  }

  const ask = injectedAsk || createStdinAsk();
  try {
    const session = injectedSession
      || (await ensureSession({ lang, catalog, ask, stdinIsTTY, out: write }));
    if (!session) {
      process.stderr.write(`\n  ${a.loginRequired}\n\n`);
      process.exitCode = 1;
      return;
    }
    const io = makeIo({ ask, lang, out: write, stdinIsTTY });
    return await runAlmaShell({
      io,
      ask,
      stdinIsTTY,
      streamIsTTY: !!process.stdout.isTTY,
      env: process.env,
      rawOut: write,
      session,
      catalog,
      deps: d,
    });
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run();
}
