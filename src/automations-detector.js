'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getHomeDir } = require('./env-paths');

// Deterministic (no-LLM) automations detector (talents-ai-score, issue 017 / ADR-013-014).

const AI_CLI_NAMES = ['claude', 'aider', 'gemini', 'codex'];
const AI_CLI_RE = new RegExp(`\\b(${AI_CLI_NAMES.join('|')})\\b`, 'i');

function mentionsAiCli(text) {
  return typeof text === 'string' && AI_CLI_RE.test(text);
}

function looksLikeJsonPiping(text) {
  if (typeof text !== 'string') return false;
  return mentionsAiCli(text) && /\|/.test(text) && /(--json\b|(^|\s)-p\b)/.test(text);
}

const MAX_SHELL_SCRIPT_BYTES = 200_000; // safety cap, never a product requirement
const MAX_SHELL_SCRIPTS = 50;

/* ---------- 1 & 2: scripts (npm + shell) ---------- */

function scanNpmScripts(root) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  } catch {
    return { aiMentions: 0, jsonPiping: 0 };
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return { aiMentions: 0, jsonPiping: 0 };
  }
  const scripts = pkg && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  let aiMentions = 0;
  let jsonPiping = 0;
  for (const command of Object.values(scripts)) {
    if (mentionsAiCli(command)) aiMentions += 1;
    if (looksLikeJsonPiping(command)) jsonPiping += 1;
  }
  return { aiMentions, jsonPiping };
}

function scanShellScripts(root) {
  const dir = path.join(root, 'scripts');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { aiMentions: 0, jsonPiping: 0 };
  }
  let aiMentions = 0;
  let jsonPiping = 0;
  let scanned = 0;
  for (const entry of entries) {
    if (scanned >= MAX_SHELL_SCRIPTS) break;
    if (!entry.isFile() || !entry.name.endsWith('.sh')) continue;
    scanned += 1;
    const file = path.join(dir, entry.name);
    let content;
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_SHELL_SCRIPT_BYTES) continue;
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (mentionsAiCli(content)) aiMentions += 1;
    if (looksLikeJsonPiping(content)) jsonPiping += 1;
  }
  return { aiMentions, jsonPiping };
}

/* ---------- 3: schedulers (inspected-where-possible) ---------- */

// cron: the CURRENT user's own crontab only (`crontab -l`), never the system-wide crontab (would need elevated permissions, not attempted).
function probeCron() {
  let out;
  try {
    out = execFileSync('crontab', ['-l'], { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8');
  } catch {
    return { inspected: false, matches: 0 }; // no crontab / binary missing / not permitted: not invented
  }
  const lines = out.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  return { inspected: true, matches: lines.filter(mentionsAiCli).length };
}

// launchd (macOS): the user's own ~/Library/LaunchAgents only (never LaunchDaemons, system-wide, needs root).
function probeLaunchd(home) {
  const dir = path.join(home, 'Library', 'LaunchAgents');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { inspected: false, matches: 0 };
  }
  let matches = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.plist')) continue;
    try {
      const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      if (mentionsAiCli(content)) matches += 1;
    } catch {
      /* unreadable: skip, never invented */
    }
  }
  return { inspected: true, matches };
}

// pm2: the user's own process dump (~/.pm2/dump.pm2, JSON). Counts AI-CLI
// mentions across the whole dump — coarse but derived, never returns it.
function probePm2(home) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(home, '.pm2', 'dump.pm2'), 'utf8');
  } catch {
    return { inspected: false, matches: 0 };
  }
  const matches = (raw.match(new RegExp(AI_CLI_RE.source, 'gi')) || []).length;
  return { inspected: true, matches };
}

// systemd (Linux, user-level only): ~/.config/systemd/user/*.service.
// Never the system-wide /etc/systemd (needs root, not attempted).
function probeSystemdUser(home) {
  const dir = path.join(home, '.config', 'systemd', 'user');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { inspected: false, matches: 0 };
  }
  let matches = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.service')) continue;
    try {
      const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      if (mentionsAiCli(content)) matches += 1;
    } catch {
      /* unreadable: skip, never invented */
    }
  }
  return { inspected: true, matches };
}

// Deterministic (no-LLM) automations detection.
function detectAutomations(root) {
  const home = getHomeDir();
  const npm = scanNpmScripts(root);
  const shell = scanShellScripts(root);

  return {
    scripts: { npm: npm.aiMentions, shell: shell.aiMentions },
    jsonPiping: npm.jsonPiping + shell.jsonPiping,
    schedulers: {
      cron: probeCron(),
      launchd: probeLaunchd(home),
      pm2: probePm2(home),
      systemd: probeSystemdUser(home),
    },
  };
}

module.exports = { detectAutomations, mentionsAiCli, looksLikeJsonPiping };
