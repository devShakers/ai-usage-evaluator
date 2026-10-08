'use strict';

// MCP: the talent's dimension certifications (by role).

const LIST_CERTIFICATIONS_SCHEMA = { type: 'object', properties: {} };

function makeCertificationsTools(deps = {}) {
  const {
    fetchMeCertifications = (opts) => require('./certifications-client').fetchMeCertifications({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (list_certifications is session-gated).');
    }
    return session;
  };

  async function listCertifications() {
    const session = requireLoginSession();
    const res = await fetchMeCertifications({ hubAccessToken: session.hubAccessToken });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, mainRole: res.mainRole, growingInto: res.growingInto, dimensions: res.dimensions };
  }

  return [
    {
      name: 'list_certifications',
      description: "List the talent's role dimensions with their certification state (CERTIFIED/UNCERTIFIED/EXPIRED), band and main role. Requires an active session. Any dimension/cluster ids in the result are INTERNAL handles for calling tools — never show or mention them to the talent; refer to a dimension by its name.",
      inputSchema: LIST_CERTIFICATIONS_SCHEMA,
      handler: listCertifications,
    },
  ];
}

module.exports = {
  makeCertificationsTools,
  LIST_CERTIFICATIONS_SCHEMA,
};
