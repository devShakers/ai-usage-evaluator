'use strict';

// MCP: view the talent's availability. Read-only (no set tool — an AI agent
// must not write the talent's availability).

const GET_AVAILABILITY_SCHEMA = { type: 'object', properties: {} };

function makeAvailabilityTools(deps = {}) {
  const {
    fetchAvailability = (opts) => require('./availability-client').fetchAvailability({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (get_availability is session-gated).');
    }
    return session;
  };

  async function getAvailability() {
    const session = requireLoginSession();
    const res = await fetchAvailability({ hubAccessToken: session.hubAccessToken });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, availability: res.availability };
  }

  return [
    {
      name: 'get_availability',
      description: "View the talent's availability: open-to-work, monthly hours, work modes (a combinable array of REMOTE/HYBRID/IN_PERSON), and location. Read-only. Requires an active session. Any internal ids in the result (e.g. numeric city id) are handles for tools only — never show or mention them to the talent.",
      inputSchema: GET_AVAILABILITY_SCHEMA,
      handler: getAvailability,
    },
  ];
}

module.exports = {
  makeAvailabilityTools,
  GET_AVAILABILITY_SCHEMA,
};
