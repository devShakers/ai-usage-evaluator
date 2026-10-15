'use strict';

// MCP: the positions the talent applied to + status.

const LIST_APPLICATIONS_SCHEMA = { type: 'object', properties: {} };

function makeApplicationsTools(deps = {}) {
  const {
    fetchApplications = (opts) => require('./applications-client').fetchApplications({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — sign in with social_signin_start (or run `shakers login`) first (list_applications is session-gated).');
    }
    return session;
  };

  async function listApplications() {
    const session = requireLoginSession();
    const res = await fetchApplications({ hubAccessToken: session.hubAccessToken });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, applications: res.items || [] };
  }

  return [
    {
      name: 'list_applications',
      title: 'Your applications',
      description: 'Shows the projects you applied to and how each application is going.',
      guidance: "List the positions the talent has applied to, with each candidature's status. Read-only. Requires an active session. Any positionId/projectId in the result are INTERNAL handles for calling tools — never show or mention them to the talent; refer to a project by its title/company.",
      inputSchema: LIST_APPLICATIONS_SCHEMA,
      handler: listApplications,
    },
  ];
}

module.exports = {
  makeApplicationsTools,
  LIST_APPLICATIONS_SCHEMA,
};
