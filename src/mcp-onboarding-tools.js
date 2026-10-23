'use strict';

const path = require('path');
const { askConsent } = require('./mcp-choice');
const { tildify } = require('./env-paths');

const LOGOUT_SCHEMA = { type: 'object', properties: {} };

const LIST_ADDABLE_SCHEMA = { type: 'object', properties: {} };

const ADD_SKILL_SCHEMA = {
  type: 'object',
  properties: {
    skillId: { type: 'integer', description: 'The skillId to declare, from list_addable.skills[].skillId.' },
    relatedPortfolioIds: {
      type: 'array',
      items: { type: 'string' },
      description: "Optional portfolio/experience IDs to relate this skill to (from a prior response's `portfolios[].id`, or from add_project). Omit to declare without a relation — the response always returns the talent's current `portfolios` so you know the IDs for the NEXT add_skill call.",
    },
  },
  required: ['skillId'],
};

const ADD_AGENT_SCHEMA = {
  type: 'object',
  properties: {
    agentName: { type: 'string', description: 'The agent name to declare, from list_addable.agents[].name.' },
    whatItDoes: { type: 'string' },
    humanDecides: { type: 'string' },
    relatedPortfolios: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          portfolioId: { type: 'string', description: "A portfolio/experience id (from a prior response's `portfolios[].id`, or from add_project)." },
        },
        required: ['portfolioId'],
      },
      description: "Optional experiences to relate this agent to (matches the web's 'Relate to an experience' step). Replace-set. Omit to declare without a relation — the response always returns the talent's current `portfolios` so you know the IDs for a follow-up call.",
    },
  },
  required: ['agentName'],
};

const ADD_PROJECT_SCHEMA = {
  type: 'object',
  properties: {
    root: { type: 'string', description: 'Repository root. Defaults to the server working directory. Its name and remote URL seed the portfolio entry.' },
    name: { type: 'string', description: 'Portfolio entry name. Defaults to the repository directory name.' },
    type: { type: 'string', enum: ['PORTFOLIO', 'EXPERIENCE'], description: 'Defaults to PORTFOLIO.' },
    description: { type: 'string' },
    url: { type: 'string', description: 'Defaults to the git remote origin URL when available.' },
    clientName: { type: 'string', description: 'Client name (optional, e.g. for freelance work).' },
    clientDomain: { type: 'string', description: "Client website or domain (optional, e.g. 'acme.com' or a full URL — normalized to a bare domain). Hub generates the client logo from it." },
    skillIds: { type: 'array', items: { type: 'integer' } },
    answer: { type: 'string', description: 'The option the talent picked when you printed the question this tool returned. Never set it yourself.' },
  },
};

function makeOnboardingTools(deps = {}) {
  const {
    clearAuthSession = require('./auth-session-store').clearAuthSession,
    getUsageDiscoveredInventoryEndpoint = require('./config').getUsageDiscoveredInventoryEndpoint,
    getSkillsDeclareEndpoint = require('./config').getSkillsDeclareEndpoint,
    getAgentsDeclareEndpoint = require('./config').getAgentsDeclareEndpoint,
    getAgentsListEndpoint = require('./config').getAgentsListEndpoint,
    getPortfoliosDeclareEndpoint = require('./config').getPortfoliosDeclareEndpoint,
    getPortfoliosListEndpoint = require('./config').getPortfoliosListEndpoint,
    getPortfolioUpdateEndpoint = require('./config').getPortfolioUpdateEndpoint,
    getAgentPortfoliosEndpoint = require('./config').getAgentPortfoliosEndpoint,
    saveAuthSession = require('./auth-session-store').saveAuthSession,
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
    requestDiscoveredInventory = require('./inventory-client').requestDiscoveredInventory,
    requestDiscoveredInventoryWithRefresh = require('./inventory-client').requestDiscoveredInventoryWithRefresh,
    ensureFreshSession = require('./session-refresh').ensureFreshSession,
    endSession = require('./session-refresh').endSession,
    requestDeclareSkill = require('./skills-client').requestDeclareSkill,
    requestDeclareAgent = require('./agents-client').requestDeclareAgent,
    requestListAgents = require('./agents-client').requestListAgents,
    requestRelateAgentPortfolios = require('./agents-client').requestRelateAgentPortfolios,
    requestDeclarePortfolio = require('./portfolio-client').requestDeclarePortfolio,
    requestListPortfolios = require('./portfolio-client').requestListPortfolios,
    requestUpdatePortfolioSkills = require('./portfolio-client').requestUpdatePortfolioSkills,
    getRemoteUrl = require('./portfolio-git-info').getRemoteUrl,
    getCommitDateRange = require('./portfolio-git-info').getCommitDateRange,
    consentCopy = () => require('./signup-copy').signupCopy(require('./signup-language').signupLanguage(require('./i18n').detectFlowLang())).consent,
    normalizeDomain = require('./portfolio-client').normalizeDomain,
    isValidEmail = require('./share').isValidEmail,
    normalizeEmail = require('./share').normalizeEmail,
  } = deps;

  const requireSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — sign in with social_signin_start (or run `shakers login`) first.');
    }
    return session;
  };

  // Mint a fresh hub JWT (email/better-auth sessions) so an expired token doesn't
  // fail the inventory read — mirrors the CLI add-agent and usage-poll retry.
  const refreshTokenFor = async () => {
    const fresh = await ensureFreshSession(process.env);
    return fresh ? { accessToken: fresh.accessToken, hubAccessToken: fresh.hubAccessToken } : null;
  };

  const requireEndpoint = (getter, name) => {
    const endpoint = getter();
    if (!endpoint) {
      throw new Error(`no ${name} endpoint configured — set SHAKERS_CLI_INGEST_ENDPOINT.`);
    }
    return endpoint;
  };

  async function logout() {
    const wasLoggedIn = await endSession(process.env, { loadAuthSession, clearAuthSession });
    return { ok: true, wasLoggedIn };
  }

  async function listAddable() {
    const session = requireSession();
    const endpoint = requireEndpoint(getUsageDiscoveredInventoryEndpoint, 'discovered-inventory');
    const inv = await requestDiscoveredInventoryWithRefresh(
      { accessToken: session.accessToken, refreshToken: refreshTokenFor },
      { endpoint, request: requestDiscoveredInventory },
    );
    if (!inv.ok) {
      return { ok: false, reason: inv.reason || 'inventory-failed' };
    }
    return { ok: true, skills: inv.skills, agents: inv.agents };
  }

  async function addSkill(args = {}) {
    const session = requireSession();
    const endpoint = requireEndpoint(getSkillsDeclareEndpoint, 'skills-declare');
    const result = await requestDeclareSkill(
      { skillId: args.skillId, accessToken: session.accessToken, hubAccessToken: session.hubAccessToken },
      { endpoint },
    );
    const skillExisted = !result.ok && result.reason === 'skill-exists';
    if (!result.ok && !skillExisted) return { ok: false, reason: result.reason || 'declare-failed' };

    const listEndpoint = getPortfoliosListEndpoint();
    const updateEndpoint = getPortfolioUpdateEndpoint();
    if (!listEndpoint || !updateEndpoint) return skillExisted ? { ok: true, skillId: args.skillId, alreadyExisted: true } : { ok: true, skillId: args.skillId };

    const listed = await requestListPortfolios(
      { accessToken: session.accessToken, hubAccessToken: session.hubAccessToken },
      { endpoint: listEndpoint },
    );
    if (!listed.ok) return { ok: true, skillId: args.skillId };
    const portfolios = listed.portfolios.map((p) => ({ id: p.id, name: p.name, type: p.type }));

    const relatedIds = Array.isArray(args.relatedPortfolioIds) ? args.relatedPortfolioIds : [];
    if (relatedIds.length === 0) return { ok: true, skillId: args.skillId, portfolios, ...(skillExisted ? { alreadyExisted: true } : {}) };

    const related = [];
    const relateFailures = [];
    for (const portfolioId of relatedIds) {
      const portfolio = listed.portfolios.find((p) => p.id === portfolioId);
      if (!portfolio) {
        relateFailures.push({ portfolioId, reason: 'unknown-portfolio' });
        continue;
      }
      const skillIds = Array.from(new Set([...(portfolio.skillIds || []), args.skillId]));
      const r = await requestUpdatePortfolioSkills(
        { portfolioId, skillIds, hubAccessToken: session.hubAccessToken },
        { endpoint: updateEndpoint },
      );
      if (r.ok) related.push(portfolioId);
      else relateFailures.push({ portfolioId, reason: r.reason });
    }
    return { ok: true, skillId: args.skillId, portfolios, related, relateFailures, ...(skillExisted ? { alreadyExisted: true } : {}) };
  }

  async function inventoryWhatItDoes(accessToken, agentName) {
    try {
      const endpoint = getUsageDiscoveredInventoryEndpoint();
      if (!endpoint) return undefined;
      const inv = await requestDiscoveredInventoryWithRefresh(
        { accessToken, refreshToken: refreshTokenFor },
        { endpoint, request: requestDiscoveredInventory },
      );
      if (!inv.ok || !Array.isArray(inv.agents)) return undefined;
      const match = inv.agents.find((a) => a && a.name === agentName);
      return match && typeof match.whatItDoes === 'string' && match.whatItDoes
        ? match.whatItDoes
        : undefined;
    } catch {
      return undefined;
    }
  }

  async function resolveExistingAgentId(session, agentName) {
    const listEndpoint = getAgentsListEndpoint();
    if (!listEndpoint) return null;
    const listed = await requestListAgents(
      { accessToken: session.accessToken, hubAccessToken: session.hubAccessToken },
      { endpoint: listEndpoint },
    );
    if (!listed.ok) return null;
    const wanted = String(agentName || '').toLowerCase();
    const match = listed.agents.find((a) => a.name && a.name.toLowerCase() === wanted);
    return match && match.id ? match.id : null;
  }

  async function addAgent(args = {}) {
    const session = requireSession();
    const endpoint = requireEndpoint(getAgentsDeclareEndpoint, 'agents-declare');
    if (!args.agentName) throw new Error('agentName is required (from list_addable.agents[].name).');
    const whatItDoes =
      typeof args.whatItDoes === 'string'
        ? args.whatItDoes
        : await inventoryWhatItDoes(session.accessToken, args.agentName);
    const result = await requestDeclareAgent(
      {
        name: args.agentName,
        whatItDoes,
        humanDecides: typeof args.humanDecides === 'string' ? args.humanDecides : undefined,
        accessToken: session.accessToken,
        hubAccessToken: session.hubAccessToken,
      },
      { endpoint },
    );

    let agentId = result.ok ? (result.agentId || null) : null;
    let alreadyExisted = false;
    if (!result.ok) {
      const existingId = await resolveExistingAgentId(session, args.agentName);
      if (!existingId) return { ok: false, reason: result.reason || 'declare-failed' };
      agentId = existingId;
      alreadyExisted = true;
    }
    const base = { ok: true, agentName: args.agentName, agentId };
    if (alreadyExisted) base.alreadyExisted = true;

    // Echo the talent's current experiences (id/name/type) so a follow-up call
    // can relate by id — same shape/purpose as add_skill's `portfolios` echo.
    const listEndpoint = getPortfoliosListEndpoint();
    if (!listEndpoint) return base;
    const listed = await requestListPortfolios(
      { accessToken: session.accessToken, hubAccessToken: session.hubAccessToken },
      { endpoint: listEndpoint },
    );
    if (!listed.ok) return base;
    const portfolios = listed.portfolios.map((p) => ({ id: p.id, name: p.name, type: p.type }));

    const relatedInput = Array.isArray(args.relatedPortfolios) ? args.relatedPortfolios : [];
    if (relatedInput.length === 0 || !agentId) return { ...base, portfolios };

    // Replace-set: validate every portfolioId against the talent's own
    // list, then PATCH the whole set in ONE call.
    const items = [];
    const relateFailures = [];
    for (const entry of relatedInput) {
      const portfolioId = entry && entry.portfolioId;
      const portfolio = listed.portfolios.find((p) => p.id === portfolioId);
      if (!portfolio) {
        relateFailures.push({ portfolioId, reason: 'unknown-portfolio' });
        continue;
      }
      items.push({ portfolioId });
    }
    let related = [];
    if (items.length > 0) {
      const relateEndpoint = getAgentPortfoliosEndpoint(agentId);
      const r = await requestRelateAgentPortfolios(
        { agentId, items, hubAccessToken: session.hubAccessToken },
        { endpoint: relateEndpoint },
      );
      if (r.ok) related = items.map((it) => it.portfolioId);
      else for (const it of items) relateFailures.push({ portfolioId: it.portfolioId, reason: r.reason });
    }
    return { ...base, portfolios, related, relateFailures };
  }

  // Sends the project only after the talent says yes to exactly what goes: name, web address, dates, client.
  async function addProject(args = {}, ctx = {}) {
    const session = requireSession();
    const endpoint = requireEndpoint(getPortfoliosDeclareEndpoint, 'portfolios-declare');
    const root = path.resolve(typeof args.root === 'string' && args.root ? args.root : process.cwd());
    const name = typeof args.name === 'string' && args.name ? args.name : path.basename(root);
    const type = args.type === 'EXPERIENCE' ? 'EXPERIENCE' : 'PORTFOLIO';
    let url = typeof args.url === 'string' && args.url ? args.url : null;
    if (!url) {
      try { url = getRemoteUrl(root) || null; } catch { url = null; }
    }
    let startDate;
    let endDate;
    try { ({ startDate, endDate } = getCommitDateRange(root)); } catch { startDate = null; endDate = null; }
    const clientName = typeof args.clientName === 'string' && args.clientName ? args.clientName : null;
    const clientDomain = normalizeDomain(args.clientDomain) || null;
    const description = typeof args.description === 'string' && args.description ? args.description : null;
    const sent = { name, type, url, startDate, endDate, clientName, clientDomain, description };
    const c = consentCopy();
    const asked = await askConsent(ctx, {
      tool: 'add_project',
      key: `add_project:${root}:${JSON.stringify(sent)}`,
      question: c.project({ folder: tildify(root), name, url, startDate, endDate, client: [clientName, clientDomain].filter(Boolean).join(', '), description }),
      yes: c.yes,
      no: c.no,
      answer: args.answer,
    });
    if (asked.reply) return asked.reply;
    if (!asked.granted) return { ok: false, reason: 'consent-declined', message: 'The talent said no: nothing was sent. Do not add the project.' };
    const result = await requestDeclarePortfolio(
      {
        name,
        type,
        description: description || undefined,
        url: url || undefined,
        clientName: clientName || undefined,
        clientDomain: clientDomain || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        skillIds: Array.isArray(args.skillIds) ? args.skillIds : undefined,
        accessToken: session.accessToken,
        hubAccessToken: session.hubAccessToken,
      },
      { endpoint },
    );
    return result.ok ? { ok: true, name, type } : { ok: false, reason: result.reason || 'declare-failed' };
  }

  return [
    {
      name: 'logout',
      title: 'Sign out of Shakers',
      description: 'Signs you out by deleting the Shakers sign-in saved on this computer.',
      guidance: "Sign the talent out of Shakers by clearing the persisted session. Idempotent — returns { ok: true, wasLoggedIn } whether or not a session existed.",
      inputSchema: LOGOUT_SCHEMA,
      handler: logout,
    },
    {
      name: 'list_addable',
      title: 'Skills and agents you can add',
      description: 'Shows the skills and AI agents found in the AI analysis you sent to Shakers, so you can pick which ones go on your profile.',
      guidance: "List the skills and AI agents that Shakers discovered from the talent's submitted ai_usage report and that can be added to their Shakers profile. Use it to offer choices before add_skill / add_agent. Present skills and agents to the talent by NAME only; skillId, agent code and catalogId are internal handles for the add_* tools — never show raw IDs or codes. Requires an active session.",
      inputSchema: LIST_ADDABLE_SCHEMA,
      handler: listAddable,
    },
    {
      name: 'add_skill',
      title: 'Add a skill to your profile',
      description: 'Adds the skill you pick to your Shakers profile.',
      guidance: "Add a discovered skill to the talent's Shakers profile by skillId (taken from list_addable). skillId is an internal handle — refer to the skill by its name when talking to the talent, never show the id. Optionally pass relatedPortfolioIds to relate it to one or more of the talent's portfolio experiences (matches the web's 'Relate to an experience' step) — the response always includes `portfolios` (id/name/type) so you can ask the talent which one(s) on a later call. If the talent has no portfolios yet, the skill is still added, unrelated. Requires an active session.",
      inputSchema: ADD_SKILL_SCHEMA,
      handler: addSkill,
    },
    {
      name: 'add_agent',
      title: 'Add an AI agent to your profile',
      description: 'Adds the AI agent you pick, with the description you agree on, to your Shakers profile.',
      guidance: "Add a discovered AI agent to the talent's Shakers profile by name (from list_addable). Optionally pass whatItDoes and humanDecides (what the talent does around the agent — supervision/validation). Optionally pass relatedPortfolios ({ portfolioId }) to relate it to the talent's experiences (matches the web's 'Relate to an experience' step) — the response always includes `portfolios` (id/name/type) so you can ask which one(s) on a later call. If the talent has no experiences yet, the agent is still added, unrelated. Requires an active session.",
      inputSchema: ADD_AGENT_SCHEMA,
      handler: addAgent,
    },
    {
      name: 'add_project',
      title: 'Add this project to your portfolio',
      description: 'Reads the name of the project folder open here, the web address of its code and the dates of its first and last change. It asks you first, naming all of them, and only then sends them to Shakers as a new portfolio project.',
      guidance: "Add the current repository to the talent's Shakers portfolio as a project. Name and URL default to the repo directory and its git remote, and the start/end dates are derived from the repo's git history. Optionally pass clientName and clientDomain (the client's website/domain, e.g. 'acme.com' — Shakers fetches the client logo from it). The tool asks the talent first, naming the folder, web address, dates and client it will send (a dialog when the client has one, otherwise it returns the question to ask as its message says); nothing is sent until they answer yes. After asking it in the chat, call it again with the same arguments and answer set to the option they pick. Never answer for them. Requires an active session. Any ids/codes in the result are internal handles for tools only — never show or mention them to the talent.",
      inputSchema: ADD_PROJECT_SCHEMA,
      handler: addProject,
    },
  ];
}

module.exports = {
  makeOnboardingTools,
  LOGOUT_SCHEMA,
  LIST_ADDABLE_SCHEMA,
  ADD_SKILL_SCHEMA,
  ADD_AGENT_SCHEMA,
  ADD_PROJECT_SCHEMA,
};
