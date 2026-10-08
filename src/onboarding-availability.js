'use strict';

const { loadAuthSession, sessionStatus } = require('./auth-session-store');
const { getOnboardingStatusEndpoint } = require('./config');
const { requestOnboardingStatus } = require('./onboarding-status-client');

async function checkOnboardingCompleted({
  env = process.env,
  session = null,
  loadSession = loadAuthSession,
  endpointGetter = getOnboardingStatusEndpoint,
  fetchStatus = requestOnboardingStatus,
  timeoutMs,
} = {}) {
  const active = session || loadSession();
  if (sessionStatus(active) !== 'active') return false;
  const endpoint = endpointGetter(env);
  if (!endpoint) return false;
  const res = await fetchStatus(
    { accessToken: active.accessToken },
    timeoutMs ? { endpoint, timeoutMs } : { endpoint },
  );
  return res.ok ? res.completed === true : false;
}

module.exports = { checkOnboardingCompleted };
