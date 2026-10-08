'use strict';

// MCP: ask Alma. Returns the AGGREGATED answer (MCP does not stream).

const ASK_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'The question / message for Alma.' },
  },
  required: ['message'],
};

function makeAskTools(deps = {}) {
  const {
    askAlma = (opts) => require('./alma-client').askAlma({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (ask is session-gated).');
    }
    return session;
  };

  async function ask(args = {}) {
    const session = requireLoginSession();
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    if (!message) return { ok: false, reason: 'no-message' };
    const res = await askAlma({ hubAccessToken: session.hubAccessToken, message });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, answer: res.text };
  }

  return [
    {
      name: 'ask',
      description: 'Ask Alma, the Shakers AI assistant, a question (about your profile, rates, availability, skills, open positions, applications). Returns Alma\'s full answer — relay it as-is; do not surface any internal Shakers ids/codes to the talent.',
      inputSchema: ASK_SCHEMA,
      handler: ask,
    },
  ];
}

module.exports = {
  makeAskTools,
  ASK_SCHEMA,
};
