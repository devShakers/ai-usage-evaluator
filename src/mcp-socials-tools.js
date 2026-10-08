'use strict';

// MCP: view the talent's social links. Read-only (editing is CLI-only).

const LIST_SOCIALS_SCHEMA = { type: 'object', properties: {} };

function makeSocialsTools(deps = {}) {
  const {
    fetchSocials = (opts) => require('./socials-client').fetchSocials({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (list_socials is session-gated).');
    }
    return session;
  };

  async function listSocials() {
    const session = requireLoginSession();
    const res = await fetchSocials({ hubAccessToken: session.hubAccessToken });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, social: res.social };
  }

  return [
    {
      name: 'list_socials',
      description: "View the talent's social links (linkedin/github/website/twitter/instagram/facebook/dribbble/behance — null when unset). Read-only. Requires an active session.",
      inputSchema: LIST_SOCIALS_SCHEMA,
      handler: listSocials,
    },
  ];
}

module.exports = { makeSocialsTools, LIST_SOCIALS_SCHEMA };
