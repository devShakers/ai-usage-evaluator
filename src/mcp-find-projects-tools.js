'use strict';

// MCP: list the Positions/Projects available to the talent (Find Positions),
// paginated + filtered server-side. Same params as the CLI so an agent can page.

const { TABS, ATTENDANCE, DEFAULT_LIMIT } = require('./find-projects-client');
const { splitRecommended } = require('./find-projects-flow');

const FIND_PROJECTS_SCHEMA = {
  type: 'object',
  properties: {
    tab: { type: 'string', enum: TABS, description: 'all (default order, match desc) or saved (bookmarked).' },
    page: { type: 'integer', minimum: 1, description: '1-based page. offset = (page-1)*limit.' },
    limit: { type: 'integer', minimum: 1, maximum: 50, description: `Items per page (default ${DEFAULT_LIMIT}, max 50).` },
    attendance: { type: 'string', enum: Object.keys(ATTENDANCE), description: 'Work mode filter (server-side).' },
    country: { type: 'string', description: 'ISO 3166-1 alpha-2 country filter (server-side).' },
    recommended: { type: 'boolean', description: 'Client-side: keep only items with a match on this page. If none, falls back to the available items (never empty). `recommended` in the result is "recommended" | "fallback" | null.' },
  },
};

function makeFindProjectsTools(deps = {}) {
  const {
    fetchFindProjects = (opts) => require('./find-projects-client').fetchFindProjects({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (find_projects is session-gated).');
    }
    return session;
  };

  async function findProjects(args = {}) {
    const session = requireLoginSession();
    const tab = TABS.includes(args.tab) ? args.tab : 'all';
    const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 50) : DEFAULT_LIMIT;
    const page = Number.isInteger(args.page) && args.page > 0 ? args.page : 1;
    const offset = (page - 1) * limit;
    const attRaw = typeof args.attendance === 'string' ? args.attendance.trim().toLowerCase() : null;
    const attendance = attRaw && ATTENDANCE[attRaw] ? ATTENDANCE[attRaw] : null;
    const countryRaw = typeof args.country === 'string' ? args.country.trim().toUpperCase() : null;
    const country = countryRaw && /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;

    const res = await fetchFindProjects({ hubAccessToken: session.hubAccessToken, tab, limit, offset, attendance, country });
    if (!res.ok) return { ok: false, reason: res.reason };
    // Same client-side recommended filter (+ fallback to available) as the CLI.
    const { shown, mode } = splitRecommended(res.items || [], !!args.recommended);
    return { ok: true, tab, page, limit, filters: { attendance, country, recommended: !!args.recommended }, recommended: mode, meta: res.meta || null, items: shown };
  }

  return [
    {
      name: 'find_projects',
      description: "List the Positions/Projects available to the talent right now (Shakers Find Positions), paginated and ordered by match desc. Each item carries its parent Project id/name, title, company, budget, work mode and match. Supports server-side pagination (page/limit) and filters (tab all|saved, attendance, country ISO2). `meta` carries {page,pageSize,total,totalPages}. Requires an active session. The positionId/projectId in each item are INTERNAL handles for calling other tools (e.g. show_project, save_project) — NEVER show or mention them to the talent; refer to a project by its title/company only.",
      inputSchema: FIND_PROJECTS_SCHEMA,
      handler: findProjects,
    },
  ];
}

module.exports = {
  makeFindProjectsTools,
  FIND_PROJECTS_SCHEMA,
};
