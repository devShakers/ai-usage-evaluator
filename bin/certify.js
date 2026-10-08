#!/usr/bin/env node
'use strict';

// `certify` — dimension certification interview over LiveKit (src/certify-dimension-flow.js).

const { detectReportLang, getCatalog } = require('../src/i18n');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { createStdinAsk } = require('../src/stdin-ask');
const { makeIo } = require('./register');
const { runCertifyDimension, makeCertifyDimensionDeps } = require('../src/certify-dimension-flow');

function parseCertifyArgs(argv = []) {
  const o = { lang: null, help: false, dimension: null, acceptDisclaimer: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--lang') { const v = argv[++i]; o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a.startsWith('--lang=')) { const v = a.slice(7); o.lang = v === 'es' || v === 'en' ? v : null; }
    else if (a === '--dimension') o.dimension = argv[++i] != null ? argv[i] : null;
    else if (a.startsWith('--dimension=')) o.dimension = a.slice('--dimension='.length);
    else if (a === '--accept-disclaimer') o.acceptDisclaimer = true;
  }
  return o;
}

async function run(
  argv = process.argv.slice(2),
  { ask: injectedAsk = null, stdinIsTTY: ttyOverride = undefined, deps = null, session: injectedSession = null, out = null, input = undefined, output = undefined } = {},
) {
  const opts = parseCertifyArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const cd = catalog.certifyDimension;
  const write = out || ((s) => process.stdout.write(s));

  if (opts.help) {
    write(cd.help + '\n');
    return;
  }

  const session = injectedSession || loadAuthSession();
  if (sessionStatus(session) !== 'active') {
    process.stderr.write(`\n  ${cd.loginRequired}\n\n`);
    process.exitCode = 1;
    return;
  }

  const stdinIsTTY = ttyOverride !== undefined ? ttyOverride : !!process.stdin.isTTY;
  const ask = injectedAsk || createStdinAsk();
  try {
    const io = makeIo({ ask, lang, out: write, acceptDisclaimer: opts.acceptDisclaimer, stdinIsTTY });
    const result = await runCertifyDimension({
      io,
      ask,
      stdinIsTTY,
      session,
      lang,
      catalog,
      opts: { dimension: opts.dimension, input, output },
      deps: deps || makeCertifyDimensionDeps(),
    });
    if (result && result.ok === false) process.exitCode = 1;
    return result;
  } finally {
    if (!injectedAsk) ask.close();
  }
}

module.exports = { run, parseCertifyArgs };

if (require.main === module) {
  run();
}
