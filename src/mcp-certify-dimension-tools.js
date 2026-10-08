'use strict';

// MCP: list the offerable dimensions (the certification interview itself is done on the web).

const LIST_CERTIFIABLE_DIMENSIONS_SCHEMA = {
  type: 'object',
  properties: {},
};

function makeCertifyDimensionTools(deps = {}) {
  const {
    discoverOfferableDimensions = (opts) => require('./certify-dimension-client').discoverOfferableDimensions({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (certification is session-gated).');
    }
    return session;
  };

  async function listCertifiableDimensions() {
    const session = requireLoginSession();
    const res = await discoverOfferableDimensions({
      accessToken: session.accessToken,
      hubAccessToken: session.hubAccessToken,
    });
    if (!res.ok) return { ok: false, reason: res.reason };
    return {
      ok: true,
      mainRole: res.mainRole || null,
      dimensions: (res.offerable || []).map((d) => ({
        dimensionKey: d.dimensionKey,
        slug: d.slug,
        clusterId: d.clusterId,
        state: d.state,
        band: d.band || null,
      })),
    };
  }

  return [
    {
      name: 'list_certifiable_dimensions',
      description: "List the dimensions the talent can certify right now: their main role's hub dimensions whose interview runs by text (terminal or spoken-case templates) and not already CERTIFIED (UNCERTIFIED/EXPIRED). Requires an active session. The certification interview itself is done on the web; running `shakers certify` in the terminal hands the talent the web link to take it. The dimensionKey/clusterId in each item are INTERNAL handles for tools only — never show or mention them to the talent; refer to a dimension by its name.",
      inputSchema: LIST_CERTIFIABLE_DIMENSIONS_SCHEMA,
      handler: listCertifiableDimensions,
    },
  ];
}

module.exports = {
  makeCertifyDimensionTools,
  LIST_CERTIFIABLE_DIMENSIONS_SCHEMA,
};
