#!/usr/bin/env node
'use strict';

// `update` — update the CLI to the latest published version (CLI-only, never an MCP tool); `--check` reports without installing. Logic in src/update-flow.js.

const { detectReportLang, getCatalog } = require('../src/i18n');
const updateFlow = require('../src/update-flow');

function parseUpdateArgs(argv = []) {
  const o = { help: false, check: false, json: false, lang: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--check' || a === '--dry-run') o.check = true;
    else if (a === '--json') o.json = true;
    else if (a === '--lang') {
      const v = argv[++i];
      o.lang = v === 'es' || v === 'en' ? v : null;
    } else if (a.startsWith('--lang=')) {
      const v = a.slice(7);
      o.lang = v === 'es' || v === 'en' ? v : null;
    }
  }
  return o;
}

async function run(
  argv = process.argv.slice(2),
  { out = null, env = process.env, deps = null } = {},
) {
  const opts = parseUpdateArgs(argv);
  const lang = opts.lang || detectReportLang();
  const t = getCatalog(lang).cli.update;
  const write = out || ((s) => process.stdout.write(s));
  const flow = deps || updateFlow;

  if (opts.help) {
    write(t.help + '\n');
    return;
  }

  const info = flow.readPackageInfo();
  const install = flow.detectInstall(env);
  const current = info.version;

  if (!opts.json) write(`  ${t.checking}\n`);
  const latest = flow.fetchLatestVersion(info);

  if (opts.json) {
    const updateAvailable =
      latest.ok && current ? flow.compareVersions(current, latest.version) < 0 : null;
    write(
      `${JSON.stringify({
        package: info.name,
        current: current || null,
        latest: latest.ok ? latest.version : null,
        install: install.kind,
        updateAvailable,
        reason: latest.ok ? null : latest.reason,
      })}\n`,
    );
    if (!latest.ok) process.exitCode = 1;
    return;
  }

  if (current) write(`  ${t.current(current)}\n`);

  if (!latest.ok) {
    write(`  ${t.latestUnknown(latest.reason)}\n`);
    process.exitCode = 1;
    return;
  }

  if (!current || flow.compareVersions(current, latest.version) >= 0) {
    write(`  ${t.upToDate(latest.version)}\n`);
    return;
  }

  write(`  ${t.available(current, latest.version)}\n`);

  // `--check`: report only, never install.
  if (opts.check) {
    write(`  ${t.checkHint}\n`);
    return;
  }

  const plan = flow.buildUpdatePlan(install, info, env);
  if (!plan) {
    if (install.kind === 'source') write(`  ${t.sourceCheckout}\n`);
    else write(`  ${t.unknownInstall(flow.manualCommand(info))}\n`);
    process.exitCode = 1;
    return;
  }

  write(`  ${t.detected(plan.label)}\n`);
  write(`  ${t.updating(info.name, current, latest.version)}\n\n`);

  const result = flow.runInstall(plan, env);
  if (result.ok) {
    write(`\n  ${t.success(latest.version)}\n  ${t.reRun}\n`);
    return;
  }
  write(`\n  ${t.failInstall(result.reason)}\n  ${t.failHint(flow.manualCommand(info))}\n`);
  process.exitCode = 1;
}

module.exports = { run, parseUpdateArgs };

if (require.main === module) {
  run();
}
