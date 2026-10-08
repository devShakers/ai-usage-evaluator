#!/usr/bin/env node
'use strict';

const { detectReportLang } = require('../src/i18n');
const {
  loadConfigFile,
  saveConfigFile,
  validateEndpoint,
  getCertsBase,
  getHubBase,
  getTalentProfileUrl,
  getIngestEndpoint,
} = require('../src/config');

const VALID_LANGS = new Set(['es', 'en']);
const ENDPOINT_KEYS = new Set(['certsBase', 'hubBase', 'ingestEndpoint', 'profileUrl']);
const PROFILE_VALUES = new Set(['external', 'talent']);
const SETTABLE = new Set([...ENDPOINT_KEYS, 'profile', 'lang']);

const COPY = {
  es: {
    help: 'config — lee/escribe la configuracion NO sensible del CLI (bases de hub/certs, perfil, idioma). Uso: shakers config <list|get [clave]|set clave valor>\n  Claves: certsBase, hubBase, ingestEndpoint, profileUrl, profile, lang.\n  Los secretos (tokens/credenciales) NUNCA se guardan aqui: se obtienen con `shakers login` o por entorno.',
    unknownKey: (k) => `clave desconocida: ${k}. Claves validas: ${[...SETTABLE].join(', ')}.`,
    needValue: 'set necesita <clave> <valor>.',
    badEndpoint: (k, r) => `valor invalido para ${k} (${r}). Debe ser una URL http de loopback o https.`,
    badProfile: 'profile debe ser "external" o "talent".',
    badLang: 'lang debe ser "es" o "en".',
    saved: (k, v) => `guardado ${k} = ${v}`,
    resolvedHeading: 'Resueltos (env > config.json > default local):',
  },
  en: {
    help: 'config — read/write the CLI NON-sensitive configuration (hub/certs bases, profile, language). Usage: shakers config <list|get [key]|set key value>\n  Keys: certsBase, hubBase, ingestEndpoint, profileUrl, profile, lang.\n  Secrets (tokens/credentials) are NEVER stored here: get them via `shakers login` or the environment.',
    unknownKey: (k) => `unknown key: ${k}. Valid keys: ${[...SETTABLE].join(', ')}.`,
    needValue: 'set needs <key> <value>.',
    badEndpoint: (k, r) => `invalid value for ${k} (${r}). Must be a loopback http URL or https.`,
    badProfile: 'profile must be "external" or "talent".',
    badLang: 'lang must be "es" or "en".',
    saved: (k, v) => `saved ${k} = ${v}`,
    resolvedHeading: 'Resolved (env > config.json > local default):',
  },
};

function parseArgs(argv) {
  const o = { lang: null, help: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang') o.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = VALID_LANGS.has(v) ? v : null; }
    else if (a === '--help' || a === '-h') o.help = true;
    else o.rest.push(a);
  }
  return o;
}

function resolvedView(env) {
  return {
    certsBase: getCertsBase(env),
    hubBase: getHubBase(env),
    ingestEndpoint: getIngestEndpoint(env),
    profileUrl: getTalentProfileUrl(env),
  };
}

async function run(argv = process.argv.slice(2), { env = process.env, out = null } = {}) {
  const o = parseArgs(argv);
  const lang = o.lang || detectReportLang();
  const c = COPY[lang] || COPY.en;
  const write = out || ((s) => process.stdout.write(s));
  const line = (s) => write(`  ${s}\n`);

  if (o.help || o.rest.length === 0) {
    write(`\n  ${c.help}\n\n`);
    return;
  }

  const [sub, key, ...valueParts] = o.rest;

  if (sub === 'list') {
    const config = loadConfigFile(env);
    for (const k of SETTABLE) {
      if (config[k] !== undefined) line(`${k} = ${config[k]}`);
    }
    line(c.resolvedHeading);
    const r = resolvedView(env);
    for (const k of Object.keys(r)) line(`  ${k} = ${r[k] === null ? '(unset)' : r[k]}`);
    return;
  }

  if (sub === 'get') {
    if (!key) { line(c.needValue); process.exitCode = 1; return; }
    if (!SETTABLE.has(key)) { line(c.unknownKey(key)); process.exitCode = 1; return; }
    const config = loadConfigFile(env);
    line(config[key] !== undefined ? String(config[key]) : '(unset)');
    return;
  }

  if (sub === 'set') {
    const value = valueParts.join(' ').trim();
    if (!key || !value) { line(c.needValue); process.exitCode = 1; return; }
    if (!SETTABLE.has(key)) { line(c.unknownKey(key)); process.exitCode = 1; return; }
    if (key === 'profile') {
      if (!PROFILE_VALUES.has(value)) { line(c.badProfile); process.exitCode = 1; return; }
    } else if (key === 'lang') {
      if (!VALID_LANGS.has(value)) { line(c.badLang); process.exitCode = 1; return; }
    } else if (key !== 'profileUrl') {
      const v = validateEndpoint(value);
      if (!v.ok) { line(c.badEndpoint(key, v.reason)); process.exitCode = 1; return; }
    }
    const config = loadConfigFile(env);
    config[key] = value;
    try { saveConfigFile(config, env); } catch { line('could not write config.json'); process.exitCode = 1; return; }
    line(c.saved(key, value));
    return;
  }

  write(`\n  ${c.help}\n\n`);
  process.exitCode = 1;
}

module.exports = { run, parseArgs, SETTABLE, ENDPOINT_KEYS };

if (require.main === module) {
  run();
}
