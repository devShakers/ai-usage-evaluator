'use strict';

// Local context SUGGESTIONS for the register flow: the environment timezone, the
// local git identity, the GitHub login and CV candidates. These are proposals the
// model offers the talent to confirm — they are NEVER auto-written. No file
// content, no commit scanning, no network, no session: CV candidates are file
// NAMES only. This is deliberately NOT the authorship/evidence path.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getHomeDir, tildify } = require('./env-paths');

// Where a talent keeps a CV, and how deep we look under each folder. iCloud
// Drive holds Desktop/Documents for many Mac users.
const CV_DIRS = ['Desktop', 'Documents', 'Downloads', 'Escritorio', 'Documentos', 'Descargas', 'Library/Mobile Documents/com~apple~CloudDocs'];
const CV_MAX_DEPTH = 3;
const CV_MAX_RESULTS = 8;
const CV_EXTENSIONS = /\.(pdf|docx?)$/i;
const CV_NAME = /(^|[^a-z])(cv|curriculum|curr[ií]culum|resume|r[ée]sum[ée])([^a-z]|$)/i;

function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function gitConfig(key, cwd) {
  try {
    const out = execFileSync('git', ['config', '--get', key], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: cwd || process.cwd(),
    });
    const value = String(out || '').trim();
    return value || null;
  } catch {
    return null;
  }
}

// The login the GitHub CLI is signed in with, read from its local hosts file
// (no network), else the conventional `github.user` git key.
function detectGithubUser(home, cwd) {
  try {
    const hosts = fs.readFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), 'utf8');
    const block = hosts.split(/^github\.com:\s*$/m)[1];
    const match = block && block.match(/^\s+user:\s*(\S+)\s*$/m);
    if (match) return match[1];
  } catch {
    // no gh CLI config
  }
  return gitConfig('github.user', cwd);
}

const fold = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const nameTokens = (personName) => fold(personName).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);

// Whether a file name carries a token of the person's name. People who hire keep
// other people's CVs in Downloads; only a name match makes a candidate theirs.
function matchesName(fileName, personName) {
  const file = fold(fileName);
  return nameTokens(personName).some((t) => file.includes(t));
}

// A file named after the person but without a CV word (`Alvaro Torro.pdf`) is a
// candidate only when it carries their full name, so one common first name does
// not pull in every contract and invoice.
function carriesFullName(fileName, personName) {
  const tokens = nameTokens(personName);
  const file = fold(fileName);
  return tokens.length >= 2 && tokens.every((t) => file.includes(t));
}

// Words that say nothing about whose CV it is: `cv.pdf`, `Curriculum_2024_ES.pdf`,
// `resume-final-v2.pdf`. Such a file may be the talent's own, so it is worth asking.
const GENERIC_WORDS = /\b(cv|curriculum|curriculo|resume|vitae|mi|my|el|the|de|of|final|actualizado|updated|nuevo|new|latest|es|en|esp|eng|spanish|english|espanol|ingles|v\d+|copia|copy)\b/g;

function isGenericCvName(fileName) {
  const rest = fold(fileName.replace(/\.pdf$/i, '')).replace(/[^a-z0-9]+/g, ' ').replace(GENERIC_WORDS, ' ').replace(/\d+/g, ' ');
  return rest.trim().length === 0;
}

// PDF/Word files whose NAME looks like a CV or carries the person's full name:
// name matches first, then generic names, then newest. Never opens a file.
function findCvCandidates(home, personName) {
  // Without a name there is nothing to match: null says unknown, never a mismatch.
  const known = nameTokens(personName).length > 0;
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < CV_MAX_DEPTH) walk(full, depth + 1);
      } else if (entry.isFile() && CV_EXTENSIONS.test(entry.name)
        && (CV_NAME.test(entry.name.replace(CV_EXTENSIONS, '')) || carriesFullName(entry.name, personName))) {
        try {
          found.push({
            path: full,
            nameMatch: known ? matchesName(entry.name, personName) : null,
            generic: isGenericCvName(entry.name),
            mtimeMs: fs.statSync(full).mtimeMs,
          });
        } catch {
          // vanished between readdir and stat
        }
      }
    }
  };
  for (const name of CV_DIRS) walk(path.join(home, name), 1);
  return found
    .sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch) || Number(b.generic) - Number(a.generic) || b.mtimeMs - a.mtimeMs)
    .slice(0, CV_MAX_RESULTS)
    .map(({ path: cvPath, nameMatch, generic }) => ({ path: tildify(cvPath, { SHAKERS_CLI_HOME_DIR: home }), nameMatch, generic }));
}

// Returns the signals found, each clearly a SUGGESTION to confirm. `talentName`
// (what the AI already knows) sharpens the CV match beyond the git name.
function readRegisterContextSuggestions({ cwd, env = process.env, talentName } = {}) {
  const home = getHomeDir(env);
  const githubUser = detectGithubUser(home, cwd);
  const gitName = gitConfig('user.name', cwd);
  const personName = [talentName, gitName].filter((n) => typeof n === 'string' && n.trim()).join(' ');
  return {
    timezone: detectTimezone(),
    gitName,
    gitEmail: gitConfig('user.email', cwd),
    githubUser,
    githubUrl: githubUser ? `https://github.com/${githubUser}` : null,
    cvCandidates: findCvCandidates(home, personName),
  };
}

module.exports = { readRegisterContextSuggestions, detectTimezone, findCvCandidates, detectGithubUser, isGenericCvName, nameTokens, fold };
