#!/usr/bin/env node
'use strict';

var _nodeMajor = parseInt((process.versions && process.versions.node || '0').split('.')[0], 10);
if (_nodeMajor < 18) {
  process.stderr.write(
    '\n  shakers requires Node 18 or newer (you have ' + process.version + ').\n'
    + '  Update Node from https://nodejs.org and re-run.\n\n',
  );
  process.exit(1);
}

const { detectReportLang, getCatalog } = require('../src/i18n');
const { promptSelect } = require('../src/prompt-select');
const { createStdinAsk } = require('../src/stdin-ask');
const { migrateLegacyConfigDir } = require('../src/config-dir');
const { sanitizeStaleBakedEndpoints } = require('../src/config');
const { ensureFreshSession } = require('../src/session-refresh');
const { hasUsableSession } = require('../src/session-gate');
const { run: runAiUsage } = require('./ai-usage');
const { run: runCertify } = require('./certify');
const { run: runShare } = require('./share');
const { run: runReport } = require('./report-html');
const { run: runSuperadmin } = require('./superadmin');
const { run: runLogin, runLogout } = require('./login');
const { run: runAddSkill } = require('./add-skill');
const { run: runAddAgent } = require('./add-agent');
const { run: runAddProject } = require('./add-project');
const { run: runAddRole } = require('./add-role');
const { run: runChangeRole } = require('./change-role');
const { run: runFindProjects } = require('./find-projects');
const { run: runShowProject } = require('./show-project');
const { run: runSave, runUnsave } = require('./save');
const { run: runInvitations } = require('./invitations');
const { run: runApplications } = require('./applications');
const { run: runAvailability } = require('./availability');
const { run: runCertifications } = require('./certifications');
const { run: runMe } = require('./me');
const { run: runRate } = require('./rate');
const { run: runLang } = require('./lang');
const { run: runSocials } = require('./socials');
const { run: runExperiences } = require('./experiences');
const { run: runPortfolios } = require('./portfolios');
const { run: runAlma } = require('./alma');
const { run: runRegister } = require('./register');
const { run: runOnboarding } = require('./onboarding');
const { run: runConfig } = require('./config');
const { run: runMcp } = require('./mcp');
const { checkOnboardingCompleted } = require('../src/onboarding-availability');

let VERSION = '';
try {
  VERSION = require('../package.json').version || '';
} catch {
  VERSION = '';
}

function parseLang(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang' && (argv[i + 1] === 'es' || argv[i + 1] === 'en')) return argv[i + 1];
    if (a === '--lang=es') return 'es';
    if (a === '--lang=en') return 'en';
  }
  return null;
}

const HANDLERS = {
  'ai-usage': runAiUsage,
  certify: runCertify,
  share: runShare,
  report: runReport,
  sheet: runReport,
  'add-skill': runAddSkill,
  'add-agent': runAddAgent,
  'add-project': runAddProject,
  'add-role': runAddRole,
  'change-role': runChangeRole,
  'find-projects': runFindProjects,
  'show-project': runShowProject,
  'save-project': runSave,
  'unsave-project': runUnsave,
  invitations: runInvitations,
  applications: runApplications,
  availability: runAvailability,
  certifications: runCertifications,
  me: runMe,
  profile: runMe,
  rate: runRate,
  lang: runLang,
  socials: runSocials,
  experiences: runExperiences,
  portfolios: runPortfolios,
  alma: runAlma,
  register: runRegister,
  onboarding: runOnboarding,
  config: runConfig,
  login: runLogin,
  logout: runLogout,
  superadmin: runSuperadmin,
  mcp: runMcp,
};

const SESSION_EXEMPT = new Set(['ai-usage', 'register', 'config', 'login', 'logout', 'superadmin', 'mcp', 'share', 'alma']);

// Command FAMILIES — a navigation layer over the flat commands (which all stay
// valid as aliases). `shakers <family> <sub>` resolves to the flat handler; every
// sub is just a friendlier name for an existing command. Additive, never breaking.
const FAMILIES = {
  add: { skill: 'add-skill', agent: 'add-agent', project: 'add-project', role: 'add-role' },
  role: { add: 'add-role', change: 'change-role', main: 'change-role' },
  profile: {
    show: 'me', rate: 'rate', languages: 'lang', lang: 'lang', socials: 'socials',
    experiences: 'experiences', portfolios: 'portfolios', availability: 'availability',
    certifications: 'certifications',
  },
  projects: {
    find: 'find-projects', show: 'show-project', save: 'save-project', unsave: 'unsave-project',
    invitations: 'invitations', applications: 'applications',
  },
  usage: { run: 'ai-usage', report: 'report', share: 'share' },
  account: { login: 'login', logout: 'logout', register: 'register', config: 'config' },
  certs: { list: 'certifications', certify: 'certify' },
};

// `shakers <family>` with no sub: obvious default, else the family help.
const FAMILY_DEFAULTS = { usage: 'ai-usage', profile: 'me', certs: 'certifications' };

function familyHelpText(family, lang) {
  const map = FAMILIES[family] || {};
  const subs = Object.keys(map);
  // Show `shakers <family> <sub>` next to the flat alias it maps to, so both forms are discoverable.
  const lines = subs.map((s) => `    shakers ${family} ${s}   (alias: shakers ${map[s]})`).join('\n');
  if (lang === 'es') {
    return `\n  Familia "${family}" — subcomandos (los comandos planos entre paréntesis siguen valiendo):\n${lines}\n\n  Ejecuta \`shakers ${family} <subcomando> --help\` para las opciones.\n\n`;
  }
  return `\n  "${family}" family — subcommands (the flat commands in parentheses still work):\n${lines}\n\n  Run \`shakers ${family} <subcommand> --help\` for the options.\n\n`;
}

// Resolves a family + sub into a flat command, mutating nothing the flat path relies on.
function resolveFamily(command, args) {
  const family = FAMILIES[command];
  if (!family) return { command, args };
  const subToken = args.find((a) => !a.startsWith('-'));
  const sub = subToken ? subToken.toLowerCase() : null;
  if (sub && family[sub]) {
    return { command: family[sub], args: args.filter((_, i) => i !== args.indexOf(subToken)) };
  }
  if (!sub && FAMILY_DEFAULTS[command]) return { command: FAMILY_DEFAULTS[command], args };
  // A pure family (not also a flat handler) with no valid sub → signal "show family help".
  if (!HANDLERS[command]) return { command, args, familyHelp: true };
  return { command, args };
}

async function remindAccountForAiUsage(lang, args) {
  if (!process.stdin.isTTY || args.includes('--json')) return;
  const r = getCatalog(lang).cli.accountReminder;
  const ask = createStdinAsk();
  let choice;
  try {
    choice = await promptSelect({
      ask,
      stdinIsTTY: true,
      out: (line) => process.stdout.write(`  ${line}\n`),
      header: r.question,
      hint: r.hint,
      items: [{ id: 'yes', label: r.yes }, { id: 'no', label: r.no }],
      labelFor: (it) => it.label,
    });
  } finally {
    ask.close();
  }
  if (choice && choice.id === 'yes') {
    await runLogin(['--lang', lang]);
  }
}

function usageText(lang, { hideOnboarding = false } = {}) {
  const title = VERSION ? `shakers v${VERSION}` : 'shakers';
  if (lang === 'es') {
    const onboardingLine = hideOnboarding ? '' : `    onboarding   La entrevista de onboarding (por voz/texto, LiveKit)\n`;
    return `\n  ${title} — evaluación de uso de IA y skills\n\n`
      + `  Uso: shakers <comando> [opciones]\n\n`
      + `  Público (sin sesión):\n`
      + `    ai-usage     Escanea este proyecto + tu máquina y puntúa tu setup de IA\n`
      + `    register     Registro completo: perfil, precio, uso de IA y entrevista\n`
      + `    mcp          Servidor MCP local (stdio) para apps de IA de escritorio\n\n`
      + `  Requieren sesión (ejecuta antes: shakers login):\n`
      + onboardingLine
      + `    certify      Certifica una dimensión de tu rol (entrevista por LiveKit)\n`
      + `    add-skill    Declara Skills detectadas en tu perfil\n`
      + `    add-agent    Declara un agente detectado en tu perfil\n`
      + `    add-project  Añade este proyecto a tu portfolio\n`
      + `    add-role     Añade un rol a tu perfil (rol de crecimiento)\n`
      + `    change-role  Cambia tu rol principal por uno de los que ya tienes\n`
      + `    find-projects Lista los proyectos/posiciones disponibles para ti\n`
      + `    show-project Detalle de un proyecto/posición por id\n`
      + `    save-project/unsave-project  Guarda o quita un proyecto de tus guardados\n`
      + `    invitations  Tus invitaciones a proyectos\n`
      + `    applications Proyectos a los que has aplicado + estado\n`
      + `    availability Ver o fijar tu disponibilidad\n`
      + `    certifications Tus dimensiones certificadas/sin certificar\n`
      + `    me           Tu resumen de perfil\n`
      + `    rate         Ver o fijar tu tarifa por proyecto\n`
      + `    lang         Ver o fijar tus idiomas y nivel\n`
      + `    socials      Ver o fijar tus enlaces sociales\n`
      + `    experiences  Tus experiencias laborales\n`
      + `    portfolios   Tus piezas de portfolio\n`
      + `    alma         Mini-shell interactivo para conversar con Alma\n`
      + `    report       Abre el informe HTML completo y compartible\n`
      + `    share        Tarjeta de uso con marca para LinkedIn\n\n`
      + `  Sesión:\n`
      + `    login        Inicia sesión en tu cuenta de Shakers\n`
      + `    logout       Cierra la sesión\n`
      + `    config       Lee/escribe la configuración (bases de hub/certs)\n\n`
      + `  Familias (agrupan los comandos de arriba; los nombres planos siguen valiendo como alias):\n`
      + `    add <skill|agent|project|role>     ·  role <add|change>\n`
      + `    profile <show|rate|languages|socials|experiences|portfolios|availability|certifications>\n`
      + `    projects <find|show|save|unsave|invitations|applications>\n`
      + `    usage <run|report|share>  ·  certs <list|certify>  ·  account <login|logout|register|config>\n`
      + `    Ejecuta \`shakers <familia>\` (sin subcomando) para ver sus subcomandos.\n\n`
      + `  Ejecuta shakers <comando> --help para las opciones de cada comando.\n\n`;
  }
  const onboardingLine = hideOnboarding ? '' : `    onboarding   The onboarding interview (over voice/text, LiveKit)\n`;
  return `\n  ${title} — AI usage & skills evaluator\n\n`
    + `  Usage: shakers <command> [options]\n\n`
    + `  Public (no session):\n`
    + `    ai-usage     Scan this project + machine and score your AI setup\n`
    + `    register     Full registration: profile, pricing, AI usage and interview\n`
    + `    mcp          Local MCP server (stdio) for desktop AI apps\n\n`
    + `  Require a session (run \`shakers login\` first):\n`
    + onboardingLine
    + `    certify      Certify a dimension of your role (LiveKit interview)\n`
    + `    add-skill    Declare detected Skills on your profile\n`
    + `    add-agent    Declare a detected agent on your profile\n`
    + `    add-project  Add this project to your portfolio\n`
    + `    add-role     Add a role to your profile (a growth role)\n`
    + `    change-role  Switch your main role to one you already have\n`
    + `    find-projects List the Projects/Positions available to you\n`
    + `    show-project Detail of a project/position by id\n`
    + `    save-project/unsave-project  Save or remove a project from your saved list\n`
    + `    invitations  Your project invitations\n`
    + `    applications Projects you applied to + status\n`
    + `    availability View or set your availability\n`
    + `    certifications Your certified/uncertified dimensions\n`
    + `    me           Your profile summary\n`
    + `    rate         View or set your per-project rate\n`
    + `    lang         View or set your languages and level\n`
    + `    socials      View or set your social links\n`
    + `    experiences  Your work experiences\n`
    + `    portfolios   Your portfolio pieces\n`
    + `    alma         Interactive mini-shell to converse with Alma\n`
    + `    report       Open the full shareable HTML report\n`
    + `    share        Branded usage card for LinkedIn\n\n`
    + `  Session:\n`
    + `    login        Sign in to your Shakers account\n`
    + `    logout       Sign out\n`
    + `    config       Read/write configuration (hub/certs bases)\n\n`
    + `  Families (group the commands above; the flat names still work as aliases):\n`
    + `    add <skill|agent|project|role>     ·  role <add|change>\n`
    + `    profile <show|rate|languages|socials|experiences|portfolios|availability|certifications>\n`
    + `    projects <find|show|save|unsave|invitations|applications>\n`
    + `    usage <run|report|share>  ·  certs <list|certify>  ·  account <login|logout|register|config>\n`
    + `    Run \`shakers <family>\` (no subcommand) to list its subcommands.\n\n`
    + `  Run \`shakers <command> --help\` for a command's options.\n\n`;
}

function gateText(command, lang) {
  if (lang === 'es') {
    return `\n  "${command}" requiere una sesión activa.\n`
      + `  Inicia sesión:  shakers login\n`
      + `  ¿Sin cuenta?:   shakers register\n\n`;
  }
  return `\n  "${command}" requires an active session.\n`
    + `  Sign in:      shakers login\n`
    + `  No account?:  shakers register\n\n`;
}

function unknownText(command, lang) {
  if (lang === 'es') {
    return `\n  Comando desconocido: "${command}".\n`
      + `  Ejecuta shakers para ver los comandos disponibles.\n\n`;
  }
  return `\n  Unknown command: "${command}".\n`
    + `  Run \`shakers\` to see the available commands.\n\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const lang = parseLang(argv) || detectReportLang();

  migrateLegacyConfigDir(process.env);
  sanitizeStaleBakedEndpoints(process.env);
  // Mint a fresh hub JWT from the stored cookie once per command (email sessions only; a no-op for Google/legacy or when no session exists).
  try { await ensureFreshSession(process.env); } catch { /* never blocks a command */ }

  const token = argv.find((a) => !a.startsWith('-'));
  if (!token || token.toLowerCase() === 'help') {
    let hideOnboarding = false;
    try {
      hideOnboarding = await checkOnboardingCompleted({ timeoutMs: 3000 });
    } catch {
      hideOnboarding = false;
    }
    process.stdout.write(usageText(lang, { hideOnboarding }));
    return;
  }

  const rawCommand = token.toLowerCase();
  const rawArgs = argv.filter((_, i) => i !== argv.indexOf(token));

  // Family navigation layer (flat commands still work as aliases).
  const resolved = resolveFamily(rawCommand, rawArgs);
  if (resolved.familyHelp) {
    process.stdout.write(familyHelpText(rawCommand, lang));
    return;
  }
  const command = resolved.command;
  const args = resolved.args;

  const handler = HANDLERS[command];
  if (!handler) {
    process.stderr.write(unknownText(command, lang));
    process.exitCode = 1;
    return;
  }

  const wantsHelp = args.includes('--help') || args.includes('-h');
  const loggedIn = await hasUsableSession(process.env);

  if (!wantsHelp && !SESSION_EXEMPT.has(command) && !loggedIn) {
    process.stderr.write(gateText(command, lang));
    process.exitCode = 1;
    return;
  }

  if (command === 'ai-usage' && !wantsHelp && !loggedIn) {
    await remindAccountForAiUsage(lang, args);
  }

  await handler(args);
}

main();
