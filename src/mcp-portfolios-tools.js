'use strict';

// MCP: list the talent's experiences (type=EXPERIENCE) and portfolio pieces
// (type=PORTFOLIO). Both read-only.

const SCHEMA = { type: 'object', properties: {} };

function makePortfolioTools(deps = {}) {
  const {
    fetchPortfolios = (opts) => require('./portfolios-client').fetchPortfolios({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = (tool) => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error(`no active Shakers session — call the login tool (or run \`shakers login\`) first (${tool} is session-gated).`);
    }
    return session;
  };

  const lister = (kind, tool) => async () => {
    const session = requireLoginSession(tool);
    const res = await fetchPortfolios({ hubAccessToken: session.hubAccessToken, kind });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, items: res.items };
  };

  return [
    {
      name: 'list_experiences',
      description: "List the talent's work experiences (company, role/title, dates, location, skills). Read-only. Requires an active session. Any ids in the result are internal handles for tools only — never show or mention them to the talent.",
      inputSchema: SCHEMA,
      handler: lister('experiences', 'list_experiences'),
    },
    {
      name: 'list_portfolios',
      description: "List the talent's portfolio showcase pieces (name, dates, location, skills, link). Read-only. Requires an active session. Any ids in the result are internal handles for tools only — never show or mention them to the talent.",
      inputSchema: SCHEMA,
      handler: lister('portfolios', 'list_portfolios'),
    },
  ];
}

module.exports = { makePortfolioTools, SCHEMA };
