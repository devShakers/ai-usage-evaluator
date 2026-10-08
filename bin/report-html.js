#!/usr/bin/env node
'use strict';

// `report` — materializes and OPENS the shareable, cumulative HTML report for the current project (ADR-016).

const { detectReportLang, getCatalog } = require('../src/i18n');
const { materializeProjectReport } = require('../src/report-store');
const { openPath } = require('../src/open-file');
const { oscLink } = require('../src/osc-link');
const { loadAuthSession, sessionStatus } = require('../src/auth-session-store');
const { getUsageReportEndpoint } = require('../src/config');
const { requestUsageReport } = require('../src/report-view-client');
const { renderUsageReportText } = require('../src/render-usage-report-text');

const VALID_LANGS = new Set(['es', 'en']);

const STORED_COPY = {
  es: {
    noSession: '"report --stored" requiere una sesion activa. Ejecuta primero: shakers login',
    noEndpoint: 'No hay endpoint de certs configurado para leer el informe almacenado.',
    noReport: 'Aún no hay ningún informe almacenado: sale de tu evaluación de AI-usage. Ejecuta `shakers ai-usage` (y comparte el informe cuando te lo pida) y vuelve a ejecutar esto.',
    error: 'No se pudo leer el informe almacenado (motivo: %r).',
  },
  en: {
    noSession: '"report --stored" requires an active session. Run `shakers login` first.',
    noEndpoint: 'No certs endpoint configured to read the stored report.',
    noReport: "There's no stored report yet — it comes from your AI-usage evaluation. Run `shakers ai-usage` (and share the report when prompted), then run this again.",
    error: 'Could not read the stored report (reason: %r).',
  },
};

// Minimal, report-specific arg parsing: --root <dir>, --lang es|en, --no-open, --help.
function parseReportArgs(argv) {
  const opts = { root: null, lang: null, open: true, help: false, stored: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a.startsWith('--root=')) opts.root = a.slice('--root='.length);
    else if (a === '--lang') opts.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) {
      const value = a.slice('--lang='.length);
      opts.lang = VALID_LANGS.has(value) ? value : null;
    } else if (a === '--no-open') opts.open = false;
    else if (a === '--stored' || a === '--text') opts.stored = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

async function runStored(lang, { session = null, loadSession = loadAuthSession, endpoint, fetchReport = requestUsageReport, out } = {}) {
  const c = STORED_COPY[lang] || STORED_COPY.en;
  const write = out || ((s) => process.stdout.write(s));

  const active = session || loadSession();
  if (sessionStatus(active) !== 'active') {
    process.stderr.write(`\n  ${c.noSession}\n\n`);
    process.exitCode = 1;
    return { ok: false, reason: 'no-session' };
  }

  const url = endpoint || getUsageReportEndpoint();
  if (!url) {
    process.stderr.write(`\n  ${c.noEndpoint}\n\n`);
    process.exitCode = 1;
    return { ok: false, reason: 'no-endpoint' };
  }

  const res = await fetchReport({ accessToken: active.accessToken }, { endpoint: url });
  if (!res.ok) {
    process.stderr.write(`\n  ${c.error.replace('%r', res.reason || 'unknown')}\n\n`);
    process.exitCode = 1;
    return res;
  }
  if (!res.report) {
    write(`\n  ${c.noReport}\n\n`);
    return { ok: true, hasReport: false };
  }
  write(renderUsageReportText(res, { lang }));
  return { ok: true, hasReport: true };
}

// `ask` is accepted for signature parity with the other REPL commands; `report`
// is non-interactive so it isn't used.
async function run(argv = process.argv.slice(2), { ask } = {}) { // eslint-disable-line no-unused-vars
  const opts = parseReportArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const r = catalog.cli.report;

  if (opts.help) {
    process.stdout.write(`\n  ${r.help}\n`);
    process.stdout.write(
      lang === 'es'
        ? `  --stored   Imprime en texto plano tu informe completo almacenado (uso + fluidez + interaccion), sin re-escanear.\n\n`
        : `  --stored   Print your full stored report as plain text (usage + fluency + interaction), without re-scanning.\n\n`,
    );
    return;
  }

  if (opts.stored) {
    await runStored(lang);
    return;
  }

  let result;
  try {
    result = materializeProjectReport({ root: opts.root, lang });
  } catch {
    // Never crash the shell over a failed report write.
    process.stdout.write(`\n  ${r.error}\n\n`);
    return;
  }

  if (!result.hasData) {
    process.stdout.write(`\n  ${r.noData}\n\n`);
    return;
  }

  const opened = opts.open ? openPath(result.htmlPath) : false;

  // Clear "the report was UPDATED" notice (fires once per run — this is the sole
  // report write point, ADR-016). OSC 8: clickable file:// link where supported.
  const updatedLabel = lang === 'es' ? 'Report actualizado' : 'Report updated';
  process.stdout.write(`\n  ✓ ${updatedLabel} · ${oscLink(result.fileUrl)}\n`);
  if (opened) process.stdout.write(`  ${r.opening}\n`);
  process.stdout.write('\n');
}

module.exports = { run, parseReportArgs, runStored };

// Only auto-run when executed directly (guarded so the REPL can require() it).
if (require.main === module) {
  run();
}
