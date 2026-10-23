#!/usr/bin/env node
'use strict';

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { run: runLogin } = require('./login');
const { runAddAgents } = require('../src/start-add-agents');

const VALID_LANGS = new Set(['es', 'en']);

const COPY = {
  es: {
    help: 'add-agent — añade a tu perfil de Talento un agente de tu inventario descubierto, o todos los nuevos con --all. Uso: add-agent [--all [--yes]] [--lang es|en] [--accept-disclaimer]',
    gate: '"add-agent" requiere una sesión activa.\n  Falta: iniciar sesión. Ejecuta primero: shakers login',
    missingAccept: 'Modo no interactivo: falta --accept-disclaimer.\n  add-agent es un flujo interactivo (elegir agente, editar campos) y su borrado por IA envía datos.\n  Reejecuta con --accept-disclaimer, aportando las respuestas por stdin.',
    missingYes: 'Modo no interactivo: falta --yes.\n  add-agent --all añade a tu perfil todos los agentes detectados que aún no tienes.\n  Reejecuta con --all --yes para confirmarlo sin terminal.',
  },
  en: {
    help: 'add-agent — add an agent from your discovered inventory to your Talent profile, or every new one with --all. Usage: add-agent [--all [--yes]] [--lang es|en] [--accept-disclaimer]',
    gate: '"add-agent" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
    missingAccept: 'Non-interactive mode: --accept-disclaimer is missing.\n  add-agent is an interactive flow (pick an agent, edit fields) and its AI draft sends data.\n  Re-run with --accept-disclaimer, feeding the answers over stdin.',
    missingYes: 'Non-interactive mode: --yes is missing.\n  add-agent --all adds every detected agent you do not have yet to your profile.\n  Re-run with --all --yes to confirm it without a terminal.',
  },
};

function parseArgs(argv) {
  const o = { root: null, lang: null, help: false, acceptDisclaimer: false, all: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = argv[++i];
    else if (a.startsWith('--root=')) o.root = a.slice(7);
    else if (a === '--lang') o.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = VALID_LANGS.has(v) ? v : null; }
    else if (a === '--accept-disclaimer') o.acceptDisclaimer = true;
    else if (a === '--all') o.all = true;
    else if (a === '--yes' || a === '-y') o.yes = true;
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

  if (!stdinIsTTY && (o.all ? !o.yes : !o.acceptDisclaimer)) {
    process.stderr.write(`\n  ${o.all ? c.missingYes : c.missingAccept}\n\n`);
    process.exitCode = 1;
    return;
  }

  const ask = injectedAsk || createStdinAsk();
  try {
    return await runAddAgents({
      ask,
      catalog,
      root: o.root || process.cwd(),
      session,
      stdinIsTTY,
      preAccepted: o.acceptDisclaimer,
      all: o.all,
      yes: o.yes,
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
