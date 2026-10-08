'use strict';

const os = require('os');

// Shared home-directory + env resolution (talents-ai-score, ADR-014 — "Alcance del tier: Talento = proyecto ∪ home", applied uniformly to every category).
function readEnv(env, suffix) {
  const next = env[`SHAKERS_CLI_${suffix}`];
  if (next !== undefined && next !== '') return next;
  return env[`AI_FOOTPRINT_${suffix}`];
}

function getHomeDir(env = process.env) {
  return readEnv(env, 'HOME_DIR') || os.homedir();
}

// `~/Documents/cv.pdf` -> absolute, so a model can pass the short form it was shown.
function expandHome(file, env = process.env) {
  if (typeof file !== 'string') return file;
  if (file === '~') return getHomeDir(env);
  if (file.startsWith('~/')) return require('path').join(getHomeDir(env), file.slice(2));
  return file;
}

// The short `~/...` form of a path under home, for showing (and copying) without typos.
function tildify(file, env = process.env) {
  const home = getHomeDir(env);
  return typeof file === 'string' && file.startsWith(`${home}/`) ? `~/${file.slice(home.length + 1)}` : file;
}

module.exports = { getHomeDir, readEnv, expandHome, tildify };
