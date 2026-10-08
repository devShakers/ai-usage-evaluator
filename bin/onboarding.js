#!/usr/bin/env node
'use strict';

const { detectFlowLang } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { runOnboardingInterview, runRepeatOnboardingInterview, makeDeps } = require('../src/onboarding-flow');
const { checkOnboardingCompleted } = require('../src/onboarding-availability');
const { makeIo } = require('./register');
const { c: fmt } = require('../src/terminal-format');
const red = (s) => `${fmt.danger}${s}${fmt.reset}`;
const yellow = (s) => `${fmt.warning}${s}${fmt.reset}`;

const VALID_LANGS = new Set(['es', 'en']);

const COPY = {
  es: {
    help: 'onboarding — solo la entrevista de onboarding de Shakers (requiere sesion). Uso: shakers onboarding [repeat] [--repeat] [--yes] [--lang es|en] [--accept-disclaimer]\n\n  repeat / --repeat  Repetir la entrevista SOBREESCRIBIENDO la anterior (pide confirmacion; --yes para confirmar sin TTY).',
    gate: '"onboarding" requiere una sesion activa.\n  Falta: iniciar sesion. Ejecuta primero: shakers login',
    missingAccept: 'Modo no interactivo: falta --accept-disclaimer.\n  onboarding es una entrevista interactiva.\n  Reejecuta con --accept-disclaimer, aportando las respuestas por stdin.',
    alreadyPrompt: 'Ya completaste la entrevista de onboarding. ¿Quieres repetirla? (s/N)',
    alreadyNeedFlag: 'Ya completaste la entrevista de onboarding.\n  Reejecutarla es opcional; si de verdad quieres repetirla, reejecuta con --confirm-repeat.',
    alreadyAbort: 'De acuerdo, no se repite la entrevista de onboarding.',
  },
  en: {
    help: 'onboarding — the Shakers onboarding interview only (requires a session). Usage: shakers onboarding [repeat] [--repeat] [--yes] [--lang es|en] [--accept-disclaimer]\n\n  repeat / --repeat  Repeat the interview OVERWRITING the previous one (asks for confirmation; --yes to confirm without a TTY).',
    gate: '"onboarding" requires an active session.\n  Missing: sign-in. Run `shakers login` first.',
    missingAccept: 'Non-interactive mode: --accept-disclaimer is missing.\n  onboarding is an interactive interview.\n  Re-run with --accept-disclaimer, feeding the answers over stdin.',
    alreadyPrompt: 'You have already completed the onboarding interview. Do you want to repeat it? (y/N)',
    alreadyNeedFlag: 'You have already completed the onboarding interview.\n  Re-running it is optional; if you really want to repeat it, re-run with --confirm-repeat.',
    alreadyAbort: 'OK, not repeating the onboarding interview.',
  },
};

function isYes(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return s === 's' || s === 'si' || s === 'sí' || s === 'y' || s === 'yes';
}

function parseArgs(argv) {
  const o = { lang: null, help: false, acceptDisclaimer: false, confirmRepeat: false, repeat: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') o.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = VALID_LANGS.has(v) ? v : null; }
    else if (a === '--accept-disclaimer') o.acceptDisclaimer = true;
    else if (a === '--confirm-repeat') o.confirmRepeat = true;
    else if (a === '--repeat' || a === 'repeat') o.repeat = true; // `shakers onboarding repeat` == --repeat
    else if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, out = null, session: injectedSession = null, checkCompleted = checkOnboardingCompleted } = {},
) {
  const o = parseArgs(argv);
  const lang = o.lang || detectFlowLang();
  const c = COPY[lang] || COPY.en;
  const write = out || ((s) => process.stdout.write(s));

  if (o.help) {
    write(`\n  ${c.help}\n\n`);
    return;
  }

  const session = injectedSession || loadAuthSession();
  if (sessionStatus(session) !== 'active') {
    process.stderr.write(`\n  ${red(c.gate)}\n\n`);
    process.exitCode = 1;
    return;
  }

  const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;

  let completed = false;
  try {
    completed = await checkCompleted({ session });
  } catch {
    completed = false;
  }

  const ask = injectedAsk || createStdinAsk();
  try {
    // Explicit overwrite-repeat: its own warning + confirmation, bypassing the legacy already-completed gate.
    if (o.repeat) {
      const io = makeIo({ ask, lang, out: write, acceptDisclaimer: o.acceptDisclaimer, stdinIsTTY });
      const result = await runRepeatOnboardingInterview(io, deps || makeDeps(), { confirmed: o.yes });
      if (result && result.ok === false) {
        process.stderr.write(`\n  ${red(`onboarding: ${result.reason}`)}\n\n`);
        process.exitCode = 1;
      }
      return result;
    }

    if (completed && !o.confirmRepeat) {
      const canPrompt = stdinIsTTY || !!injectedAsk;
      if (!canPrompt) {
        process.stderr.write(`\n  ${yellow(c.alreadyNeedFlag)}\n\n`);
        process.exitCode = 1;
        return;
      }
      const answer = await ask(`  ${c.alreadyPrompt} `);
      if (!isYes(answer)) {
        write(`\n  ${c.alreadyAbort}\n\n`);
        return;
      }
    }

    if (!stdinIsTTY && !o.acceptDisclaimer && !injectedAsk) {
      process.stderr.write(`\n  ${red(c.missingAccept)}\n\n`);
      process.exitCode = 1;
      return;
    }

    const io = makeIo({ ask, lang, out: write, acceptDisclaimer: o.acceptDisclaimer, stdinIsTTY });
    const result = await runOnboardingInterview(io, deps || makeDeps());
    if (!result.ok) {
      process.stderr.write(`\n  ${red(`onboarding: ${result.reason}${result.step ? ` (${result.step})` : ''}`)}\n\n`);
      process.exitCode = 1;
    }
    return result;
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseArgs };

if (require.main === module) {
  run();
}
