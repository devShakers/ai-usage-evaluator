'use strict';

// MCP: the talent's unread position invitations.

const LIST_INVITATIONS_SCHEMA = { type: 'object', properties: {} };

function makeInvitationsTools(deps = {}) {
  const {
    fetchInvitations = (opts) => require('./invitations-client').fetchInvitations({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — sign in with social_signin_start (or run `shakers login`) first (list_invitations is session-gated).');
    }
    return session;
  };

  async function listInvitations() {
    const session = requireLoginSession();
    const res = await fetchInvitations({ hubAccessToken: session.hubAccessToken });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, invitations: res.items || [] };
  }

  return [
    {
      name: 'list_invitations',
      title: 'Your invitations',
      description: 'Shows the projects that invited you and that you have not read yet.',
      guidance: "List the talent's unread position invitations (projects that invited them). Requires an active session. Any projectId/chatId in the result are INTERNAL handles for calling tools — never show or mention them to the talent; refer to a project by its name.",
      inputSchema: LIST_INVITATIONS_SCHEMA,
      handler: listInvitations,
    },
  ];
}

module.exports = {
  makeInvitationsTools,
  LIST_INVITATIONS_SCHEMA,
};
