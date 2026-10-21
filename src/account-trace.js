'use strict';

const { hasAuthSessionFile } = require('./auth-session-store');
const { loadConsentState } = require('./share-consent-state');
const { loadConfigFile } = require('./config');
const { hasAccountMarker, recordAccountMarker } = require('./account-marker');

function hasCurrentTrace(env) {
  const consent = loadConsentState(env);
  return hasAuthSessionFile(env)
    || !!(consent && consent.lastSentAt)
    || require('./report-store').hasRecordedUpload(env)
    || !!loadConfigFile(env).superadminSession;
}

function hasAccountTrace(env = process.env) {
  if (hasAccountMarker(env)) return true;
  if (!hasCurrentTrace(env)) return false;
  recordAccountMarker('existing-trace', env);
  return true;
}

module.exports = { hasAccountTrace };
