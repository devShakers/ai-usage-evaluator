'use strict';

const { loadAuthSession, sessionStatus, isPlatformTalent } = require('./auth-session-store');
const { getProfile } = require('./config');

// THE ONE LAYER THAT DECIDES WHAT THE REPORT SHOWS ACCORDING TO IDENTITY (talents-ai-score, issue 123 / ADR-044).

// Pure: identity in, policy out.
function resolveReportGate({ loggedIn = false, status = null, email = null, userType = null, profile = 'talent' } = {}) {
  const showEverything = !loggedIn;
  const resolvedProfile = profile === 'external' ? 'external' : 'talent';
  return Object.freeze({
    loggedIn: !!loggedIn,
    profile: resolvedProfile,
    sessionStatus: status,
    email: loggedIn && typeof email === 'string' && email ? email : null,
    // --roadmap AND its server-side computation/egress (see bin/report.js): a
    // logged-in Talent's roadmap is not merely hidden, it is not requested.
    showRoadmap: showEverything,
    // Per-agent "how to improve this agent" tips in the footprint report.
    showAgentSuggestions: showEverything,
    // The copyable remediation prompt in a `certify` verdict.
    showCertifyRemediation: showEverything,
    showFrameworkIntro: resolvedProfile === 'talent' && loggedIn && isPlatformTalent({ userType }),
  });
}

// The general-user policy, used when a renderer is called without a gate. Frozen
// and shared so callers cannot accidentally mutate the default for everyone.
const DEFAULT_REPORT_GATE = resolveReportGate({ loggedIn: false });

// Reads the auth session and resolves the policy.
function reportGateForIdentity(env = process.env, now = Date.now()) {
  const session = loadAuthSession(env);
  const status = sessionStatus(session, now);
  return resolveReportGate({
    loggedIn: status === 'active',
    status,
    email: session ? session.email : null,
    userType: session ? session.userType : null,
    profile: getProfile(env),
  });
}

module.exports = {
  resolveReportGate,
  reportGateForIdentity,
  DEFAULT_REPORT_GATE,
};
