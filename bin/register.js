#!/usr/bin/env node
'use strict';

const { detectFlowLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { run: runLogin } = require('./login');
const { run: runAiUsage } = require('./ai-usage');
const {
  runOnboarding, makeDeps, CURRENCIES, MONTHLY_HOURS, normalizeAmount,
  WORK_SITUATIONS, EMPLOYMENT_PARTICIPATIONS, FREELANCE_OPINIONS, CHANGE_MOTIVATORS, WORK_MODES,
  LANGUAGE_CODES, LANGUAGE_LEVELS, showsFreelanceOpinion, showsChangeMotivators,
} = require('../src/onboarding-flow');
const { promptSelect, promptMultiSelect } = require('../src/prompt-select');
const { chooseAuthMethod } = require('../src/auth-method-picker');
const { methodIdsForFlow } = require('../src/auth-methods');
const { palette } = require('../src/ansi');
const { BRAND_ANSI } = require('../src/brand-ansi');
const { typeOut } = require('../src/typewriter');
const { withSpinner } = require('../src/terminal-progress');
const { openPath } = require('../src/open-file');
const { c: fmt } = require('../src/terminal-format');
const red = (s) => `${fmt.danger}${s}${fmt.reset}`;

const VALID_LANGS = new Set(['es', 'en']);

const COPY = {
  es: {
    help: 'register — registro completo en Shakers (perfil, particular/empresa + precio, uso de IA y entrevista). Uso: shakers register [--lang es|en] [--accept-disclaimer] [--no-open]',
    missingAccept: 'Modo no interactivo: falta --accept-disclaimer.\n  register es un flujo interactivo con pasos que envian datos (import, evaluacion, entrevista).\n  Reejecuta con --accept-disclaimer, aportando las respuestas por stdin.',
    loginNeeded: 'Necesitas iniciar sesion para el registro.',
  },
  en: {
    help: 'register — full Shakers registration (profile, individual/company + pricing, AI usage and interview). Usage: shakers register [--lang es|en] [--accept-disclaimer] [--no-open]',
    missingAccept: 'Non-interactive mode: --accept-disclaimer is missing.\n  register is an interactive flow with steps that send data (import, evaluation, interview).\n  Re-run with --accept-disclaimer, feeding the answers over stdin.',
    loginNeeded: 'You need to sign in for registration.',
  },
};

// `--email`/`--google`/`--provider <m>` select the auth method and skip the
// picker; an unavailable method falls through to the picker rather than failing.
function parseArgs(argv) {
  const o = { lang: null, help: false, acceptDisclaimer: false, methodFlag: null, noOpen: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') o.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = VALID_LANGS.has(v) ? v : null; }
    else if (a === '--accept-disclaimer') o.acceptDisclaimer = true;
    else if (a === '--no-open') o.noOpen = true;
    else if (a === '--email') o.methodFlag = 'email';
    else if (a === '--google') o.methodFlag = 'google';
    else if (a === '--linkedin') o.methodFlag = 'linkedin';
    else if (a === '--provider' && (argv[i + 1] === 'email' || argv[i + 1] === 'google' || argv[i + 1] === 'linkedin')) o.methodFlag = argv[++i];
    else if (a === '--provider=email') o.methodFlag = 'email';
    else if (a === '--provider=google') o.methodFlag = 'google';
    else if (a === '--provider=linkedin') o.methodFlag = 'linkedin';
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

function isYes(answer) {
  const s = (answer || '').trim().toLowerCase();
  return s === 's' || s === 'si' || s === 'sí' || s === 'y' || s === 'yes';
}

function detectTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

function makeIo({ ask, lang, out, acceptDisclaimer, stdinIsTTY = false }) {
  const C = palette({ primary: BRAND_ANSI.primary, accent: BRAND_ANSI.accent, muted: BRAND_ANSI.muted, danger: BRAND_ANSI.danger, warning: BRAND_ANSI.warning, success: '\x1b[38;5;114m', bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m' });
  const write = (line) => out(`  ${line}\n`);
  const writeErr = (line) => out(`  ${C.danger}${line}${C.reset}\n`);
  const selectOut = (line) => out(`  ${line}\n`);
  return {
    lang,
    section: (text) => out(`\n  ${C.primary}${C.bold}${text}${C.reset}\n`),
    notify: (text) => write(text),
    // Success/confirmation: a distinct soft green. Error: red. Warning: yellow.
    // All degrade to plain when color is off.
    success: (text) => out(`  ${C.success}${text}${C.reset}\n`),
    error: (text) => out(`  ${C.danger}${text}${C.reset}\n`),
    warn: (text) => out(`  ${C.warning}${text}${C.reset}\n`),
    // Loader for an async wait: animated spinner on a real TTY, else a persistent
    // label line — the label ALWAYS shows (the old animate-gate ran silently off-TTY).
    withProgress: (label, task) => {
      const animate = stdinIsTTY && process.stderr.isTTY && !process.env.NO_ANIMATION;
      if (animate) return withSpinner(label, task);
      write(label);
      return task();
    },
    ask: async (text) => (await ask(`  ${text} `)),
    // Dynamic arrow selector (raw TTY, numbered fallback off-TTY) for any single choice.
    select: ({ header = '', hint = '', items = [], labelFor = (x) => String(x), initialMarked = [] } = {}) =>
      promptSelect({ ask, stdinIsTTY, out: selectOut, items, labelFor, header, hint, initialMarked }),
    confirm: async (text) => (acceptDisclaimer ? true : isYes(await ask(`  ${text} `))),
    disclaimer: (infoText, goalText) => {
      out(`  ${C.dim}${infoText}${C.reset}\n`);
      out(`  ${C.dim}${goalText}${C.reset}\n`);
    },
    askPricing: async (c) => {
      const askAmount = async (label, cur) => {
        for (;;) {
          const raw = (await ask(`  ${label(cur)} `)).trim();
          if (!stdinIsTTY || normalizeAmount(raw) !== null) return raw;
          writeErr(c.pricingAmountInvalid);
        }
      };
      // Standard per-project price: always asked (the main modality).
      const fullTimeCurrency = await promptSelect({ ask, stdinIsTTY, out: selectOut, items: CURRENCIES, header: `  ${c.askPricingFullCurrency}` });
      const fullTimeAmount = await askAmount(c.askPricingFullAmount, fullTimeCurrency);
      // Part-time price: optional second modality, gated on the y/n.
      const partTimeSelected = isYes(await ask(`  ${c.askPricingPartSelect} `));
      let partTimeAmount;
      let partTimeCurrency;
      if (partTimeSelected) {
        partTimeCurrency = await promptSelect({ ask, stdinIsTTY, out: selectOut, items: CURRENCIES, header: `  ${c.askPricingPartCurrency}` });
        partTimeAmount = await askAmount(c.askPricingPartAmount, partTimeCurrency);
      }
      return { fullTimeSelected: true, fullTimeAmount, fullTimeCurrency, partTimeSelected, partTimeAmount, partTimeCurrency };
    },
    askAvailability: async (c) => {
      const available = isYes(await ask(`  ${c.availableAsk} `));
      const monthlyHours = await promptSelect({ ask, stdinIsTTY, out: selectOut, items: MONTHLY_HOURS, header: `  ${c.monthlyHoursAsk}` });
      const workModes = await promptMultiSelect({
        ask,
        stdinIsTTY,
        out: selectOut,
        items: WORK_MODES,
        labelFor: (v) => c.workModeLabels[v] || v,
        header: `  ${c.workModesAsk}`,
        hint: c.workModesHint,
      });
      if (workModes.length === 1 && workModes[0] === 'REMOTE') selectOut(c.onlyRemoteNote);
      let country = '';
      for (;;) {
        country = (await ask(`  ${c.countryAsk} `)).trim().toUpperCase();
        if (!stdinIsTTY || country === '' || /^[A-Z]{2}$/.test(country)) break;
        writeErr(c.countryInvalid);
      }
      const subdivision = (await ask(`  ${c.subdivisionAsk} `)).trim();
      const detectedTz = detectTimezone();
      const tzAnswer = (await ask(`  ${c.timezoneAsk(detectedTz)} `)).trim();
      const timezone = tzAnswer || detectedTz;
      const longFullTimeProjects = isYes(await ask(`  ${c.longFullTimeAsk} `));
      const telephoneCode = (await ask(`  ${c.phonePrefixAsk} `)).trim();
      const telephoneNumber = (await ask(`  ${c.phoneNumberAsk} `)).trim();
      return { available, monthlyHours, workModes, country, subdivision, timezone, longFullTimeProjects, telephoneCode, telephoneNumber };
    },
    askSignUp: async (c) => {
      const name = (await ask(`  ${c.askName} `)).trim();
      const lastName = (await ask(`  ${c.askLastName} `)).trim();
      const email = (await ask(`  ${c.askEmail} `)).trim();
      const askSecret = (prompt) => (typeof ask.secret === 'function' ? ask.secret(`  ${prompt} `) : ask(`  ${prompt} `).then((v) => v.trim()));
      let password;
      for (;;) {
        password = await askSecret(c.askPassword);
        const again = await askSecret(c.askPasswordConfirm);
        if (password === again) break;
        writeErr(c.passwordMismatch);
      }
      const newsletterConsent = isYes(await ask(`  ${c.askNewsletter} `));
      // freelanceType is NOT asked here anymore: it is derived from the work
      // situation (asked once, after the sources) and sent via professional-details.
      return { name, lastName, email, password, newsletterConsent };
    },
    askGoogleSignUp: async () => {
      // Nothing to ask: Google supplies name/email; freelanceType is derived later.
      return {};
    },
    askWorkSituation: async (c) => {
      const situation = await promptSelect({
        ask,
        stdinIsTTY,
        out: (line) => out(`  ${line}\n`),
        items: WORK_SITUATIONS,
        labelFor: (v) => c.workSituationLabels[v] || v,
        header: `  ${c.askWorkSituation}`,
      });
      let participation;
      if (situation === 'EMPLOYED') {
        participation = await promptSelect({
          ask,
          stdinIsTTY,
          out: (line) => out(`  ${line}\n`),
          items: EMPLOYMENT_PARTICIPATIONS,
          labelFor: (v) => c.employmentParticipationLabels[v] || v,
          header: `  ${c.askEmploymentParticipation}`,
        });
      }
      let opinion;
      if (showsFreelanceOpinion(situation)) {
        opinion = await promptSelect({
          ask,
          stdinIsTTY,
          out: (line) => out(`  ${line}\n`),
          items: FREELANCE_OPINIONS,
          labelFor: (v) => c.freelanceOpinionLabels[v] || v,
          header: `  ${c.askFreelanceOpinion}`,
        });
      }
      const freelanceIntent = situation === 'FREELANCE' ? 'ALREADY_FREELANCE' : opinion;
      let changeMotivators;
      if (showsChangeMotivators(freelanceIntent)) {
        changeMotivators = await promptSelect({
          ask,
          stdinIsTTY,
          out: (line) => out(`  ${line}\n`),
          items: CHANGE_MOTIVATORS,
          labelFor: (v) => c.changeMotivatorLabels[v] || v,
          header: `  ${c.askChangeMotivators}`,
        });
      }
      return { situation, participation, opinion, changeMotivators };
    },
    askLanguages: async (c) => {
      const rows = [];
      for (;;) {
        const remaining = LANGUAGE_CODES.filter((code) => !rows.some((r) => r.language === code));
        const language = await promptSelect({
          ask,
          stdinIsTTY,
          out: (line) => out(`  ${line}\n`),
          items: remaining,
          labelFor: (v) => `${c.languageNames[v] || v} (${v})`,
          header: `  ${c.askLanguageCode}`,
        });
        const level = await promptSelect({
          ask,
          stdinIsTTY,
          out: (line) => out(`  ${line}\n`),
          items: LANGUAGE_LEVELS,
          labelFor: (v) => c.languageLevelLabels[v] || v,
          header: `  ${c.askLanguageLevel}`,
        });
        rows.push({ language, level });
        if (!isYes(await ask(`  ${c.askAnotherLanguage} `))) break;
      }
      return rows;
    },
    onGoogleAuthUrl: (url, userCode) => {
      const g = getCatalog(lang).login;
      out(`\n  ${g.deviceVisit}\n  ${url}\n\n  ${g.deviceCodeLabel(userCode)}\n\n  ${g.deviceWaiting}\n`);
    },
    login: async () => {
      await runLogin(['--lang', lang], { ask });
      return sessionStatus(loadAuthSession()) === 'active';
    },
    // Registration always measures the whole machine (--all-repos).
    runUsage: async () => { await runAiUsage(['--lang', lang, '--all-repos'], { ask, bypassThrottle: true, inRegistration: true }); },
    // `plain`: a certification shows Alma's messages only. "Pregunta N" and "Gracias. Sigamos:"
    // read wrong once she is playing a character in a role play or a case.
    interviewLoop: async ({ open, turn, plain = false }) => {
      const c = getCatalog(lang).onboarding;
      const animate = stdinIsTTY && !process.env.NO_ANIMATION;
      const outStream = { write: (s) => { out(s); return true; }, isTTY: animate };
      const think = (task) => (animate ? withSpinner(c.thinking, task) : task());
      let turnNum = 1;
      const showQuestion = async (text, { withHeader = true } = {}) => {
        if (withHeader && !plain) out(`\n  ${C.dim}${c.questionHeading(turnNum)}${C.reset}\n`);
        out(`\n  ${C.primary}${C.bold}`);
        await typeOut(String(text == null ? '' : text), { stream: outStream });
        out(`${C.reset}\n`);
      };
      const started = await think(open);
      if (!started.ok) { write(started.reason || c.interviewTurnError); return { ok: false, reason: started.reason }; }
      out(`\n  ${C.dim}${c.interviewIntro}${C.reset}\n`);
      await showQuestion(started.greeting);
      let ended = started.ended === true;
      while (!ended) {
        const message = (await ask(`  ${C.primary}>${C.reset} `)).trim();
        const res = await think(() => turn(message));
        if (!res.ok) { write(res.reason || c.interviewTurnError); return { ok: false, reason: res.reason }; }
        ended = res.ended === true;
        if (res.response) {
          if (ended) { out(`\n  ${C.primary}`); await typeOut(String(res.response), { stream: outStream }); out(`${C.reset}\n`); }
          else { turnNum += 1; if (!plain) out(`\n  ${C.dim}${c.interviewTransition}${C.reset}\n`); await showQuestion(res.response); }
        }
      }
      return { ok: true };
    },
  };
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, out = null, openBrowser = undefined, input = undefined, output = undefined } = {},
) {
  const o = parseArgs(argv);
  const lang = o.lang || detectFlowLang();
  const c = COPY[lang] || COPY.en;
  const write = out || ((s) => process.stdout.write(s));

  if (o.help) {
    write(`\n  ${c.help}\n\n`);
    return;
  }

  const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;
  if (!stdinIsTTY && !o.acceptDisclaimer && !injectedAsk) {
    process.stderr.write(`\n  ${red(c.missingAccept)}\n\n`);
    process.exitCode = 1;
    return;
  }

  const ask = injectedAsk || createStdinAsk();
  try {
    // Method choice (Email + Google) from the shared auth-methods registry; a
    // valid method flag skips the picker.
    const pickerCatalog = { ...getCatalog(lang).login, chooseMethodHeading: getCatalog(lang).onboarding.chooseMethodHeading };
    const wanted = o.methodFlag && methodIdsForFlow('register').includes(o.methodFlag) ? o.methodFlag : null;
    const method = wanted || (await chooseAuthMethod({ flow: 'register', ask, stdinIsTTY, catalog: pickerCatalog, input, output }));
    if (method === null) return { ok: false, reason: 'cancelled', step: 'method' };

    const io = makeIo({ ask, lang, out: write, acceptDisclaimer: o.acceptDisclaimer, stdinIsTTY });
    // At a terminal the profile opens in the browser at the end; piped runs, tests and --no-open only print it.
    const openProfile = stdinIsTTY && !o.noOpen ? (openBrowser || openPath) : undefined;
    const result = await runOnboarding(io, deps || makeDeps(), { method, openBrowser, onAuthUrl: io.onGoogleAuthUrl, openProfile });
    if (!result.ok) {
      process.stderr.write(`\n  ${red(`register: ${result.reason}${result.step ? ` (${result.step})` : ''}`)}\n\n`);
      process.exitCode = 1;
    }
    return result;
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseArgs, makeIo, isYes };

if (require.main === module) {
  run();
}
