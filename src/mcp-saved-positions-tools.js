'use strict';

// MCP: bookmark / un-bookmark a Position. Both idempotent, reversible, low-risk.

const ID_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string', description: 'Position id (UUID) — an internal handle from a prior list; never shown or mentioned to the talent.' } },
  required: ['id'],
};

function makeSavedPositionsTools(deps = {}) {
  const {
    savePosition = (opts) => require('./saved-positions-client').savePosition({}, opts),
    unsavePosition = (opts) => require('./saved-positions-client').unsavePosition({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (this tool is session-gated).');
    }
    return session;
  };

  const toggle = (op) => async (args = {}) => {
    const session = requireLoginSession();
    const positionId = typeof args.id === 'string' ? args.id.trim() : null;
    if (!positionId) return { ok: false, reason: 'no-id' };
    const res = await op({ hubAccessToken: session.hubAccessToken, positionId });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, positionId };
  };

  return [
    {
      name: 'save_project',
      description: 'Bookmark a project/Position for the talent (Find Positions "Saved"). Idempotent — saving twice is a no-op. Requires an active session and the position id. The position id is an INTERNAL handle for calling tools — never show or mention it to the talent.',
      inputSchema: ID_SCHEMA,
      handler: toggle(savePosition),
    },
    {
      name: 'unsave_project',
      description: 'Remove a project/Position bookmark for the talent. Idempotent — un-saving something not saved is not an error. Requires an active session and the position id. The position id is an INTERNAL handle for calling tools — never show or mention it to the talent.',
      inputSchema: ID_SCHEMA,
      handler: toggle(unsavePosition),
    },
  ];
}

module.exports = {
  makeSavedPositionsTools,
  ID_SCHEMA,
};
