'use strict';

// MCP: view the talent's rates (hourly and annual, as the web shows them). Read-only.

const GET_RATE_SCHEMA = { type: 'object', properties: {} };

function makeRateTools(deps = {}) {
  const {
    fetchPricingRate = (opts) => require('./rate-client').fetchPricingRate({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (get_rate is session-gated).');
    }
    return session;
  };

  async function getRate() {
    const session = requireLoginSession();
    const res = await fetchPricingRate({ hubAccessToken: session.hubAccessToken });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, pricing: res.pricing };
  }

  return [
    {
      name: 'get_rate',
      description: "View the talent's rates as the web shows them: partTimePrice is the hourly rate (per hour) and fullTimePrice the annual target (per year); a variant not selected is not offered. Read-only. Requires an active session. Show only the human-facing amounts/currency; any internal ids in the result are handles for tools only — never show or mention them to the talent.",
      inputSchema: GET_RATE_SCHEMA,
      handler: getRate,
    },
  ];
}

module.exports = {
  makeRateTools,
  GET_RATE_SCHEMA,
};
