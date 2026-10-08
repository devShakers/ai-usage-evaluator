'use strict';

const fs = require('fs');
const path = require('path');

const { getConfigDir } = require('./config-dir');
const { loadConfigFile, saveConfigFile, VALID_PROFILES } = require('./config');
const { clearAuthSession } = require('./auth-session-store');

function reportStatePath(env) {
  return path.join(getConfigDir(env), 'report-state.json');
}
function consentStatePath(env) {
  return path.join(getConfigDir(env), 'consent.json');
}

// Best-effort delete: a file that doesn't exist (nothing to purge yet, e.g.
// a superadmin who never ran `usage` in this profile) is not a failure.
function unlinkIfExists(p) {
  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

// `switchProfile(target, env)`.
function switchProfile(target, env = process.env) {
  if (!VALID_PROFILES.has(target)) return { ok: false, reason: 'invalid-profile' };

  const config = loadConfigFile(env);
  const from = VALID_PROFILES.has(config.profile) ? config.profile : 'talent';
  config.profile = target;
  saveConfigFile(config, env);

  const purged = {
    reportState: unlinkIfExists(reportStatePath(env)),
    consent: unlinkIfExists(consentStatePath(env)),
    authSession: clearAuthSession(env),
  };

  return { ok: true, from, to: target, purged };
}

module.exports = { switchProfile, reportStatePath, consentStatePath };
