#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { execFile } = require('child_process');
const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { renderTerminal } = require('../src/render-terminal');
const { renderHtml } = require('../src/render-html');
const { save } = require('../src/store');
const { detectReportLang, getCatalog } = require('../src/i18n');
const { parseArgs } = require('../src/cli-args');
const { loadConsentState, getConsentDecision, autoShare } = require('../src/share');
const { runDisclosureFlow } = require('../src/consent-flow');

function openInBrowser(file) {
  const cmd =
    process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  execFile(cmd, args, () => {});
}

function help() {
  return `
AI Footprint — perfil local de uso de herramientas de IA

Uso:
  ai-footprint [opciones]

Opciones:
  -w, --html          Genera y abre el dashboard HTML en el navegador
      --json          Imprime el informe en JSON por stdout
      --no-save       No guarda nada en disco (solo muestra)
      --root DIR      Escanea DIR en vez del directorio actual
  -h, --help          Muestra esta ayuda

El informe se genera y se muestra SIEMPRE en tu equipo. La primera vez que
ejecutas la herramienta se te pregunta si aceptas enviarlo (con tu correo)
a la plataforma; puedes aceptar o rechazar, y solo se te pregunta una vez.
Gestiona esa decisión con: --consent-status, --consent-revoke,
--consent-email <correo>.
`;
}

// Reads one line from real stdin. Injected as `ask` into
// src/consent-flow.js's runDisclosureFlow so that module can be tested
// without a TTY.
function createStdinAsk() {
  return (question) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${question} `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Automatic, silent sending once consent is `granted` (ADR-007). Must never
// break the local run, no matter what.
async function maybeAutoShare(report, maturity) {
  try {
    await autoShare(report, maturity);
    // Every skip/failure reason (no-decision, consent-denied, throttled,
    // no-endpoint-configured, network-error, rate-limited,
    // service-unavailable, other HTTP): silent on purpose, they aren't
    // errors of the local run.
  } catch {
    // Must never break the local report.
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(help());
    return;
  }

  const lang = detectReportLang();
  const catalog = getCatalog(lang);

  // Disclosure + consent + email: shown ONCE, before any scanning, only if
  // there's no decision persisted yet (talents-ai-score, ADR-007, issue
  // 006). Once a decision exists (granted or denied), a normal run never
  // interrupts with this again.
  const state = loadConsentState();
  if (!getConsentDecision(state)) {
    await runDisclosureFlow({ ask: createStdinAsk(), catalog });
  }

  const report = scan({ root: opts.root });
  const maturity = classify(report);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ report, maturity }, null, 2) + '\n');
    return;
  }

  process.stdout.write(renderTerminal(report, maturity, lang) + '\n');

  const html = renderHtml(report, maturity, lang);
  if (opts.save) {
    const paths = save(report, html);
    process.stdout.write(`  ${catalog.cli.saved(paths.dir)}\n\n`);
    if (opts.html) openInBrowser(paths.htmlPath);
    else process.stdout.write(`  ${catalog.cli.useHtmlHint}\n\n`);
  } else if (opts.html) {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const tmp = path.join(os.tmpdir(), `ai-footprint-${Date.now()}.html`);
    fs.writeFileSync(tmp, html);
    openInBrowser(tmp);
    process.stdout.write(`  ${catalog.cli.tempDashboard(tmp)}\n\n`);
  }

  // Automatic sending, always at the end and after seeing the local report.
  // Gated by consent + email + throttle + endpoint config (src/share.js).
  await maybeAutoShare(report, maturity);
}

main();
