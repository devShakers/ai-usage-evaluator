'use strict';

// MCP: the talent's summary (role + rate + "My work with AI").

const GET_PROFILE_SCHEMA = { type: 'object', properties: {} };

function makeProfileTools(deps = {}) {
  const {
    runProfile = require('./profile-flow').runProfile,
    makeProfileDeps = require('./profile-flow').makeProfileDeps,
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
    getCatalog = require('./i18n').getCatalog,
    detectFlowLang = require('./i18n').detectFlowLang,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (get_profile is session-gated).');
    }
    return session;
  };

  async function getProfile() {
    const session = requireLoginSession();
    // A silent io: the tool returns structured data, not printed lines.
    const io = { section() {}, notify() {}, error() {}, warn() {}, success() {}, withProgress: (_l, task) => task() };
    const catalog = getCatalog(detectFlowLang());
    return runProfile({ io, rawOut: () => {}, session, catalog, opts: {}, deps: makeProfileDeps() });
  }

  return [
    {
      name: 'get_profile',
      description: "Get the talent's summary: main role, per-project rate, and the 'My work with AI' read model (setup/usage tier+level, 3x3 cell, vision, how-I-work). Requires an active session. Present it in human terms; any internal ids/codes in the result are handles for tools only — never show or mention them to the talent.",
      inputSchema: GET_PROFILE_SCHEMA,
      handler: getProfile,
    },
  ];
}

module.exports = {
  makeProfileTools,
  GET_PROFILE_SCHEMA,
};
