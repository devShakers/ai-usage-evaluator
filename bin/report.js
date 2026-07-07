#!/usr/bin/env node
'use strict';

const { execFile } = require('child_process');
const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { renderTerminal } = require('../src/render-terminal');
const { renderHtml } = require('../src/render-html');
const { save } = require('../src/store');

function parseArgs(argv) {
  const opts = { html: false, json: false, save: true, root: null, enroll: null, share: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--html' || a === '-w') opts.html = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-save') opts.save = false;
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--share') opts.share = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--enroll') opts.enroll = argv[++i];
    else if (a.startsWith('--enroll=')) opts.enroll = a.slice('--enroll='.length);
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
  -w, --html         Genera y abre el dashboard HTML en el navegador
      --json         Imprime el informe en JSON por stdout
      --no-save      No guarda nada en disco (solo muestra)
      --root DIR     Escanea DIR en vez del directorio actual
      --enroll CODE  Enrola este equipo con el código de tu panel de Shakers
      --share        Envía tu informe a la plataforma (pide confirmación)
  -y, --yes          En --share, no preguntar (usar con cuidado)
  -h, --help         Muestra esta ayuda

El informe se genera y se muestra SIEMPRE en tu equipo. El envío (--share) es
opt-in, requiere estar enrolado y te muestra el payload exacto antes de mandar.
`;
}

async function doEnroll(code) {
  const { enroll } = require('../src/share');
  process.stdout.write('\n  Enrolando este equipo...\n');
  try {
    const r = await enroll(code);
    if (r.ok) {
      process.stdout.write(`  Listo. Enrolado${r.cred.talentId ? ` como ${r.cred.talentId}` : ''}.\n`);
      process.stdout.write('  Ya puedes usar: ai-footprint --share\n\n');
    } else {
      process.stdout.write(`  No se pudo enrolar: ${r.reason}\n\n`);
      process.exitCode = 1;
    }
  } catch (e) {
    process.stdout.write(`  Error: ${e.message}\n\n`);
    process.exitCode = 1;
  }
}

async function doShare(report, maturity, assumeYes) {
  const { share } = require('../src/share');
  try {
    const r = await share(report, maturity, { assumeYes });
    if (r.ok) process.stdout.write('  Informe enviado. Gracias.\n\n');
    else process.stdout.write(`  ${r.reason}\n\n`);
  } catch (e) {
    process.stdout.write(`  Error al enviar: ${e.message}\n\n`);
    process.exitCode = 1;
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

  const report = scan({ root: opts.root });
  const maturity = classify(report);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ report, maturity }, null, 2) + '\n');
    return;
  }

  process.stdout.write(renderTerminal(report, maturity) + '\n');

  const html = renderHtml(report, maturity);
  if (opts.save) {
    const paths = save(report, html);
    process.stdout.write(`  Guardado en ${paths.dir}\n\n`);
    if (opts.html) openInBrowser(paths.htmlPath);
    else process.stdout.write(`  Usa --html para abrir el dashboard visual.\n\n`);
  } else if (opts.html) {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const tmp = path.join(os.tmpdir(), `ai-footprint-${Date.now()}.html`);
    fs.writeFileSync(tmp, html);
    openInBrowser(tmp);
    process.stdout.write(`  Dashboard temporal: ${tmp}\n\n`);
  }

  // Envío opt-in, siempre al final y tras haber visto el informe.
  if (opts.share) {
    await doShare(report, maturity, opts.yes);
  }
}

main();
