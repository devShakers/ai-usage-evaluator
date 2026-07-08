#!/usr/bin/env node
'use strict';

const { execFile } = require('child_process');
const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { renderTerminal } = require('../src/render-terminal');
const { renderHtml } = require('../src/render-html');
const { save } = require('../src/store');
const { detectReportLang, getCatalog } = require('../src/i18n');

function parseArgs(argv) {
  const opts = { html: false, json: false, save: true, root: null, enroll: null, consent: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--html' || a === '-w') opts.html = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-save') opts.save = false;
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--enroll') opts.enroll = argv[++i];
    else if (a.startsWith('--enroll=')) opts.enroll = a.slice('--enroll='.length);
    else if (a === '--consent') opts.consent = argv[++i];
    else if (a.startsWith('--consent=')) opts.consent = a.slice('--consent='.length);
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

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
      --enroll CODE   Enrola este equipo con el código de tu panel de Shakers
      --consent on|off  Activa/desactiva el envío automático de tu informe
  -h, --help          Muestra esta ayuda

El informe se genera y se muestra SIEMPRE en tu equipo. Si estás enrolado y el
envío está activado (--consent on), tu informe se envía automáticamente al
final de cada ejecución (máx. 1 vez por hora), sin preview ni confirmación.
Sin enrolar, o con el envío desactivado, todo se queda en local.
`;
}

async function doEnroll(code) {
  const { enroll } = require('../src/share');
  process.stdout.write('\n  Enrolando este equipo...\n');
  try {
    const r = await enroll(code);
    if (r.ok) {
      process.stdout.write(`  Listo. Enrolado${r.cred.talentId ? ` como ${r.cred.talentId}` : ''}.\n`);
      process.stdout.write(
        '  El envío automático está DESACTIVADO por defecto. Actívalo con:\n' +
        '    ai-footprint --consent=on\n\n',
      );
    } else {
      process.stdout.write(`  No se pudo enrolar: ${r.reason}\n\n`);
      process.exitCode = 1;
    }
  } catch (e) {
    process.stdout.write(`  Error: ${e.message}\n\n`);
    process.exitCode = 1;
  }
}

async function doConsent(value) {
  const { setConsent } = require('../src/share');
  const enabled = /^on$/i.test(value);
  const disabled = /^off$/i.test(value);
  if (!enabled && !disabled) {
    process.stdout.write('  Valor no válido para --consent: usa "on" u "off".\n\n');
    process.exitCode = 1;
    return;
  }
  const r = setConsent(enabled);
  if (r.ok) {
    process.stdout.write(`  Envío automático de tu informe ${enabled ? 'ACTIVADO' : 'DESACTIVADO'}.\n\n`);
  } else {
    process.stdout.write(`  ${r.reason}\n\n`);
    process.exitCode = 1;
  }
}

// Envío automático, silencioso: sin preview ni confirmación (ADR-005,
// talents-ai-score). Nunca debe romper el run local, pase lo que pase.
async function maybeAutoShare(report, maturity) {
  const { autoShare } = require('../src/share');
  try {
    const r = await autoShare(report, maturity);
    if (!r.ok && r.notice) process.stdout.write(`  ${r.notice}\n\n`);
    // Resto de motivos para no enviar (no enrolado, consentimiento OFF,
    // throttle, red, 429, otros HTTP): silenciosos a propósito, no son
    // errores del run local.
  } catch {
    // Nunca debe romper el informe local.
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(help());
    return;
  }

  // Enrolamiento: no necesita escanear nada.
  if (opts.enroll) {
    await doEnroll(opts.enroll);
    return;
  }

  // Activar/desactivar el envío automático: no necesita escanear nada.
  if (opts.consent) {
    await doConsent(opts.consent);
    return;
  }

  const report = scan({ root: opts.root });
  const maturity = classify(report);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ report, maturity }, null, 2) + '\n');
    return;
  }

  // Idioma del informe: se detecta UNA vez a partir del locale del SO (ver
  // src/locale.js) y se propaga a los dos renderers y a los avisos de CLI
  // ligados al informe (guardado/dashboard). No afecta a enroll/share, que
  // son un mecanismo aparte (talents-ai-score, report-i18n).
  const lang = detectReportLang();
  const cli = getCatalog(lang).cli;

  process.stdout.write(renderTerminal(report, maturity, lang) + '\n');

  const html = renderHtml(report, maturity, lang);
  if (opts.save) {
    const paths = save(report, html);
    process.stdout.write(`  ${cli.saved(paths.dir)}\n\n`);
    if (opts.html) openInBrowser(paths.htmlPath);
    else process.stdout.write(`  ${cli.useHtmlHint}\n\n`);
  } else if (opts.html) {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const tmp = path.join(os.tmpdir(), `ai-footprint-${Date.now()}.html`);
    fs.writeFileSync(tmp, html);
    openInBrowser(tmp);
    process.stdout.write(`  ${cli.tempDashboard(tmp)}\n\n`);
  }

  // Envío automático, siempre al final y tras haber visto el informe local.
  // Gated por enrolamiento + consentimiento + throttle (src/share.js).
  await maybeAutoShare(report, maturity);
}

main();
