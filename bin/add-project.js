#!/usr/bin/env node
'use strict';

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { run: runLogin } = require('./login');
const { runAddPortfolio } = require('../src/start-add-portfolio');

const VALID_LANGS = new Set(['es', 'en']);

const COPY = {
  es: {
    help: 'add-project — añade este proyecto a tu portfolio de Talento. Uso: add-project [--root <dir>] [--lang es|en] [--accept-disclaimer]',
    gate: '"add-project" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
    missingAccept: 'Modo no interactivo: falta --accept-disclaimer.\n  add-project es un flujo interactivo (título, tipo, descripción, skills) y su borrador por IA envía datos.\n  Reejecuta con --accept-disclaimer, aportando las respuestas por stdin.',
  },
  en: {
    help: 'add-project — add this project to your Talent portfolio. Usage: add-project [--root <dir>] [--lang es|en] [--accept-disclaimer]',
    gate: '"add-project" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
    missingAccept: 'Non-interactive mode: --accept-disclaimer is missing.\n  add-project is an interactive flow (title, type, description, skills) and its AI draft sends data.\n  Re-run with --accept-disclaimer, feeding the answers over stdin.',
  },
};

function parseArgs(argv) {
  const o = { root: null, lang: null, help: false, acceptDisclaimer: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = argv[++i];
    else if (a.startsWith('--root=')) o.root = a.slice(7);
    else if (a === '--lang') o.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = VALID_LANGS.has(v) ? v : null; }
    else if (a === '--accept-disclaimer') o.acceptDisclaimer = true;
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, session: injectedSession = null } = {},
) {
  const o = parseArgs(argv);
  const lang = o.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const c = COPY[lang] || COPY.en;

  if (o.help) {
    process.stdout.write(`\n  ${c.help}\n\n`);
    return;
  }

  const session = injectedSession || loadAuthSession();
  if (sessionStatus(session) !== 'active') {
    process.stderr.write(`\n  ${c.gate}\n\n`);
    process.exitCode = 1;
    return;
  }

  const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;

  if (!stdinIsTTY && !o.acceptDisclaimer) {
    process.stderr.write(`\n  ${c.missingAccept}\n\n`);
    process.exitCode = 1;
    return;
  }

  const ask = injectedAsk || createStdinAsk();
  try {
    await runAddPortfolio({
      ask,
      catalog,
      root: o.root || process.cwd(),
      session,
      stdinIsTTY,
      preAccepted: o.acceptDisclaimer,
      deps: { runLogin },
    });
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run();
}
