'use strict';

// MCP: view the talent's languages. Read-only (editing is CLI-only).

const GET_LANGUAGES_SCHEMA = { type: 'object', properties: {} };

function makeLangTools(deps = {}) {
  const {
    fetchLanguages = (opts) => require('./lang-client').fetchLanguages({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (get_languages is session-gated).');
    }
    return session;
  };

  async function getLanguages() {
    const session = requireLoginSession();
    const res = await fetchLanguages({ hubAccessToken: session.hubAccessToken });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, languages: res.languages };
  }

  return [
    {
      name: 'get_languages',
      description: "View the talent's languages and proficiency levels (NATIVE/ADVANCED/INTERMEDIATE/INTERMEDIATE_WRITTEN). Read-only. Requires an active session. Any language ids in the result are internal handles for tools only — never show or mention them to the talent; refer to a language by its name.",
      inputSchema: GET_LANGUAGES_SCHEMA,
      handler: getLanguages,
    },
  ];
}

module.exports = { makeLangTools, GET_LANGUAGES_SCHEMA };
