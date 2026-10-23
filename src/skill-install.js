'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { askTerminal, cliOnPath, codexDetected, codexHomeDir, writeFileAtomic } = require('./mcp-install');
const { cliSkill, CLI_SKILL_NAME } = require('./cli-skill');

function skillTargets({ env, platform, homedir, spawn }) {
  return [
    {
      agent: 'claudeCode',
      file: path.join(homedir, '.claude', 'skills', CLI_SKILL_NAME, 'SKILL.md'),
      detected: () => cliOnPath(spawn, 'claude') || fs.existsSync(path.join(homedir, '.claude')) || fs.existsSync(path.join(homedir, '.claude.json')),
    },
    {
      agent: 'codex',
      file: path.join(codexHomeDir({ env, homedir }), 'skills', CLI_SKILL_NAME, 'SKILL.md'),
      detected: () => codexDetected({ env, platform, homedir, spawn }),
    },
  ];
}

function isDetected(target) {
  try {
    return target.detected() === true;
  } catch {
    return false;
  }
}

function writeSkill(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, cliSkill(), 0o600);
    return { status: 'installed' };
  } catch (e) {
    return { status: 'failed', error: e.code || e.message };
  }
}

function parseSkillArgs(args) {
  const flags = new Set(args);
  return {
    sub: args.find((a) => !a.startsWith('-')) || null,
    yes: flags.has('--yes') || flags.has('-y'),
    json: flags.has('--json'),
    help: flags.has('--help') || flags.has('-h'),
  };
}

async function installSkill({ c, opts, out, ask, deps }) {
  const targets = skillTargets(deps).map((t) => ({ ...t, found: isDetected(t) }));
  const found = targets.filter((t) => t.found);
  const rows = (status) => targets.map((t) => ({ agent: t.agent, file: t.file, status: t.found ? status : 'not-detected' }));
  out(`\n  ${c.title}\n\n`);
  if (found.length === 0) {
    out(`  ${c.noneFound}\n\n`);
    return { reason: 'no-agents', targets: rows('skipped') };
  }
  out(`  ${c.found(found.map((t) => c.agents[t.agent]).join(', '))}\n`);
  let yes = opts.yes;
  if (!yes) {
    const answer = await ask(`  ${c.confirm} `);
    if (answer === null) {
      out(`\n  ${c.noTerminal}\n  ${c.yesHint}\n\n`);
      return { reason: 'no-terminal', targets: rows('skipped') };
    }
    yes = !/^\s*(n|no)\s*$/i.test(answer);
  }
  if (!yes) {
    out(`\n  ${c.declined}\n\n`);
    return { reason: 'declined', targets: rows('skipped') };
  }

  const results = targets.map((t) => ({ agent: t.agent, file: t.file, ...(t.found ? writeSkill(t.file) : { status: 'not-detected' }) }));
  out('\n');
  for (const r of results.filter((x) => x.status !== 'not-detected')) {
    out(`  ${c.agents[r.agent]}: ${c.status[r.status]} (${r.file})\n`);
  }
  const installed = results.filter((r) => r.status === 'installed').map((r) => c.agents[r.agent]);
  out(`\n  ${installed.length ? c.done(installed.join(', ')) : c.failedAll}\n\n`);
  if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
  return { reason: null, targets: results };
}

async function runSkillInstall({ args = [], out = (s) => process.stdout.write(s), lang = null, ask = askTerminal, env = process.env, platform = process.platform, homedir = os.homedir(), spawn = spawnSync } = {}) {
  const { getCatalog, detectFlowLang } = require('./i18n');
  const c = getCatalog(lang || detectFlowLang()).skillInstall;
  const opts = parseSkillArgs(args);
  if (opts.help || opts.sub !== 'install') {
    out(`\n  ${c.help}\n\n`);
    if (!opts.help && opts.sub !== null) process.exitCode = 1;
    return { reason: 'help', targets: [] };
  }
  const outcome = await installSkill({ c, opts, out: opts.json ? () => {} : out, ask, deps: { env, platform, homedir, spawn } });
  if (opts.json) out(`${JSON.stringify({ skill: CLI_SKILL_NAME, ...outcome })}\n`);
  return outcome;
}

module.exports = { runSkillInstall, skillTargets };
