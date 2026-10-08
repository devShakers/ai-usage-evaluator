'use strict';

// MCP: detail of one Position/Project (Find Positions detail view).

const SHOW_PROJECT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Position id (UUID or legacy Mongo id) — an internal handle from a prior list; never shown to the talent.' },
  },
  required: ['id'],
};

function makeShowProjectTools(deps = {}) {
  const {
    fetchPositionDetail = (opts) => require('./show-project-client').fetchPositionDetail({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (show_project is session-gated).');
    }
    return session;
  };

  async function showProject(args = {}) {
    const session = requireLoginSession();
    const positionId = typeof args.id === 'string' ? args.id.trim() : null;
    if (!positionId) return { ok: false, reason: 'no-id' };
    const res = await fetchPositionDetail({ hubAccessToken: session.hubAccessToken, positionId });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, position: res.position, redirectUrl: res.redirectUrl };
  }

  return [
    {
      name: 'show_project',
      description: "Get the full detail of one Position/Project available to the talent (Shakers Find Positions detail): title, parent project, company, budget, work mode, required skills/languages, description, goals, FAQs, and the talent's saved/applied/canApply state. Requires an active session and the position id. The `id` (and any positionId/projectId in the result) is an INTERNAL handle for calling tools — NEVER show or mention it to the talent; refer to the project by its title/company.",
      inputSchema: SHOW_PROJECT_SCHEMA,
      handler: showProject,
    },
  ];
}

module.exports = {
  makeShowProjectTools,
  SHOW_PROJECT_SCHEMA,
};
