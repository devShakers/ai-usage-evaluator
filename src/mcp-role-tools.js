'use strict';

// MCP role tools: list, add and recommend roles, and set the main role (the sign-up's last step before open_web).

const { askChoice, askAfterTexts } = require('./mcp-choice');
const { signupCopy, renderRole } = require('./signup-copy');
const { signupLanguage } = require('./signup-language');

const EMPTY_SCHEMA = { type: 'object', properties: {} };

// Same bounds as the web's growth-direction step: certs finalizes an interview within ~90 s, polled every 2 s.
const FINALIZATION_WAIT_LIMIT_MS = 90000;
const POLL_MS = 2000;
const MAX_WAIT_SECONDS = 25;
const PENDING_FINALIZATION = new Set(['COLLECTING', 'PROCESSING']);
// Alma's signal from the interview first, then the CV import, as the web stacks them.
const SOURCE_ORDER = { ONBOARDING_INTERVIEW: 0, IMPORT: 1 };

const LIST_MY_ROLES_SCHEMA = {
  type: 'object',
  properties: {
    waitSeconds: { type: 'number', description: `In the sign-up, wait up to this many seconds (max ${MAX_WAIT_SECONDS}) for the interview evaluation or the import to recommend roles.` },
  },
};

const CLUSTER_SCHEMA = {
  type: 'object',
  properties: {
    clusterId: { type: 'string', description: 'The role clusterId from list_available_roles / list_my_roles. Internal handle — refer to the role by its name to the talent, never show the id.' },
  },
  required: ['clusterId'],
};

const SET_MAIN_ROLE_SCHEMA = {
  type: 'object',
  properties: {
    evidence: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'In the sign-up, for each recommended role (by clusterId from list_my_roles): ONE short concrete fact from the CV, the interview or the AI-usage analysis that shows why it fits (e.g. "6 years with Spark and Airflow"), in the talent\'s language. It is shown under the role.',
    },
    shown: { type: 'boolean', description: 'true only after you showed relayVerbatim from the previous call: it then asks the question in a dialog.' },
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
    clusterId: { type: 'string', description: 'The role the talent already picked, by clusterId from list_my_roles or from the roles this tool returned. Omit it in the sign-up: the tool asks the talent which recommended role is their main one (a dialog, or options it returns), with the catalogue as the last option.' },
    catalogue: { type: 'boolean', description: 'true when the role comes from the catalogue: with clusterId it adds the role before setting it; without clusterId it asks from the catalogue.' },
  },
};

// One option per role name: the talent picks by name, so two rows with the same name would be one choice.
function byName(roles) {
  const seen = new Map();
  for (const r of roles) if (r && r.name && !seen.has(r.name)) seen.set(r.name, r);
  return [...seen.values()];
}

function makeRoleTools(deps = {}) {
  const lang = () => signupLanguage(deps.lang || require('./i18n').detectFlowLang());
  const copy = () => signupCopy(lang());
  const {
    getAvailableRolesEndpoint = require('./config').getAvailableRolesEndpoint,
    getSetMainRoleEndpoint = require('./config').getSetMainRoleEndpoint,
    getAssignedClustersEndpoint = require('./config').getAssignedClustersEndpoint,
    getMyCertificationsEndpoint = require('./config').getMyCertificationsEndpoint,
    requestAvailableRoles = require('./roles-client').requestAvailableRoles,
    requestAssignedClusters = require('./roles-client').requestAssignedClusters,
    requestAddGrowthRole = require('./roles-client').requestAddGrowthRole,
    requestSetMainRole = require('./roles-client').requestSetMainRole,
    requestMeCertifications = require('./certifications-client').requestMeCertifications,
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
    dedupeByCluster = require('./roles-flow').dedupeByCluster,
    getOnboardingInterviewsEndpoint = require('./config').getOnboardingInterviewsEndpoint,
    requestInterviewFinalization = require('./onboarding-status-client').requestInterviewFinalization,
    completedOnboardingInterview = () => require('./mcp-register-tools').completedOnboardingInterview(),
    countOpenPositions = (opts) => require('./find-projects-client').countOpenPositions({}, opts),
    sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    now = () => Date.now(),
  } = deps;

  const requireSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first.');
    }
    return session;
  };

  const shape = (r) => ({
    clusterId: r.clusterId,
    name: r.name,
    category: r.category,
    ...(r.proposalKind ? { proposalKind: r.proposalKind } : {}),
    ...(r.type ? { type: r.type } : {}),
    ...(r.source ? { source: r.source } : {}),
  });

  async function listAvailableRoles() {
    const session = requireSession();
    const res = await requestAvailableRoles({ hubAccessToken: session.hubAccessToken }, { endpoint: getAvailableRolesEndpoint() });
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, roles: dedupeByCluster(res.roles).map(shape) };
  }

  async function addRole(args = {}) {
    const session = requireSession();
    if (!args.clusterId) return { ok: false, reason: 'no-cluster' };
    const res = await requestAddGrowthRole({ clusterId: args.clusterId, hubAccessToken: session.hubAccessToken }, { endpoint: getAssignedClustersEndpoint() });
    if (!res.ok) {
      if (res.reason === 'already-assigned') return { ok: true, clusterId: args.clusterId, alreadyAssigned: true };
      return { ok: false, reason: res.reason };
    }
    return { ok: true, clusterId: args.clusterId };
  }

  // Whether certs is still evaluating the interview this process completed, within the web's wait.
  async function evaluationPending(session) {
    const interview = completedOnboardingInterview();
    if (!interview || now() - interview.completedAt >= FINALIZATION_WAIT_LIMIT_MS) return false;
    const res = await requestInterviewFinalization({ interviewId: interview.interviewId, accessToken: session.accessToken }, { base: getOnboardingInterviewsEndpoint() });
    return res.ok && PENDING_FINALIZATION.has(res.status);
  }

  async function readRoles(hubAccessToken) {
    const held = [];
    let mainClusterId = null;
    const cert = await requestMeCertifications({ hubAccessToken }, { endpoint: getMyCertificationsEndpoint() });
    if (cert.ok) {
      if (cert.mainRole && cert.mainRole.clusterId) { held.push(cert.mainRole); mainClusterId = cert.mainRole.clusterId; }
      for (const g of cert.growingInto || []) held.push(g);
    }
    const assigned = await requestAssignedClusters({ hubAccessToken }, { endpoint: getAssignedClustersEndpoint() });
    const clusters = assigned.ok ? assigned.clusters || [] : [];
    const recommended = clusters
      .filter((c) => c.type === 'RECOMMENDED')
      .sort((a, b) => (SOURCE_ORDER[a.source] ?? 2) - (SOURCE_ORDER[b.source] ?? 2));
    return { mainClusterId, roles: dedupeByCluster([...held, ...clusters]).map(shape), recommended: recommended.map(shape) };
  }

  async function listMyRoles(args = {}) {
    const session = requireSession();
    const deadline = now() + Math.min(Math.max(Number(args.waitSeconds) || 0, 0), MAX_WAIT_SECONDS) * 1000;
    let pending = await evaluationPending(session);
    while (pending && now() < deadline) {
      await sleep(POLL_MS);
      pending = await evaluationPending(session);
    }
    let read = await readRoles(session.hubAccessToken);
    while (!pending && read.recommended.length === 0 && now() < deadline) {
      await sleep(POLL_MS);
      read = await readRoles(session.hubAccessToken);
    }
    let message;
    let next = null;
    if (pending) message = 'The interview evaluation is still recommending roles: tell the talent you are preparing their roles and call list_my_roles again with waitSeconds.';
    else if (read.recommended.length) {
      next = 'set_main_role';
      message = 'Call set_main_role without clusterId: it asks the talent which recommended role is their main one, in a dialog or with options it returns for you to show.';
    } else {
      next = 'set_main_role';
      message = 'Nothing was recommended: call set_main_role without clusterId, it offers the catalogue (list_available_roles), then adds (add_role) and sets the role the talent picks.';
    }
    return { ok: true, ...read, pending, ...(next ? { next } : {}), message };
  }

  function roleChoice(asked, roles, extra) {
    return {
      ok: false,
      reason: 'main-role-choice-required',
      ...(asked.dismissed ? { dismissed: asked.dismissed } : {}),
      ...asked.chat,
      roles: roles.map((r) => ({ clusterId: r.clusterId, name: r.name })),
      message: `${asked.chat.choiceMessage} Then call set_main_role with the clusterId (from roles) of the one they pick. ${extra}`,
    };
  }

  // How many open projects look for each role; a failed count leaves its line out.
  async function openCounts(hubAccessToken, roles) {
    return Promise.all(roles.map(async (r) => {
      try {
        const res = await countOpenPositions({ hubAccessToken, clusterId: r.clusterId });
        return res && res.ok ? res.total : null;
      } catch {
        return null;
      }
    }));
  }

  // The main-role step: why each recommended role fits and how many projects want it, then the question; the catalogue is the last option.
  async function chooseMainRole(session, args, ctx) {
    const recommended = byName((await readRoles(session.hubAccessToken)).recommended);
    if (!recommended.length) return chooseFromCatalogue(args, ctx);
    const c = copy();
    const counts = await openCounts(session.hubAccessToken, recommended);
    const evidence = args.evidence && typeof args.evidence === 'object' ? args.evidence : {};
    const blocks = recommended.map((r, i) => renderRole(lang(), { name: r.name, source: r.source, evidence: evidence[r.clusterId], openProjects: counts[i], recommended: i === 0 }));
    const asked = await askAfterTexts(ctx, {
      tool: 'set_main_role',
      texts: [[c.rolesIntro, ...blocks, c.rolesOutro].join('\n\n')],
      question: c.mainRoleQuestion,
      options: [...recommended.map((r) => r.name), c.mainRoleOther],
      shown: args.shown,
      answer: args.answer,
    });
    if (asked.reply) {
      return { reply: { ...asked.reply, roles: recommended.map((r) => ({ clusterId: r.clusterId, name: r.name })), message: `${asked.reply.message} Pass the same evidence again. If they pick the last option, call set_main_role with catalogue:true and no clusterId.` } };
    }
    if (asked.answer === c.mainRoleOther) return chooseFromCatalogue({}, ctx);
    return { role: recommended.find((r) => r.name === asked.answer) };
  }

  async function chooseFromCatalogue(args, ctx) {
    const available = await listAvailableRoles();
    if (!available.ok) return { reply: { ok: false, reason: available.reason } };
    const roles = byName(available.roles);
    if (!roles.length) return { reply: { ok: false, reason: 'no-roles' } };
    const typed = roles.find((r) => typeof args.answer === 'string' && r.name === args.answer.trim());
    if (typed) return { role: typed, add: true };
    const asked = await askChoice(ctx, { question: copy().mainRoleQuestion, options: roles.map((r) => r.name) });
    if (!asked.answer) return { reply: roleChoice(asked, roles, 'Pass catalogue:true too: it adds the role first.') };
    return { role: roles.find((r) => r.name === asked.answer), add: true };
  }

  async function setMainRole(args = {}, ctx = {}) {
    const session = requireSession();
    if (args.clusterId && args.catalogue === true) {
      const added = await addRole({ clusterId: args.clusterId });
      if (!added.ok) return added;
    }
    if (!args.clusterId) {
      const picked = args.catalogue === true ? await chooseFromCatalogue(args, ctx) : await chooseMainRole(session, args, ctx);
      if (picked.reply) return picked.reply;
      if (picked.add) {
        const added = await addRole({ clusterId: picked.role.clusterId });
        if (!added.ok) return added;
      }
      const set = await setMainRole({ clusterId: picked.role.clusterId });
      return set.ok ? { ...set, name: picked.role.name } : set;
    }
    const res = await requestSetMainRole({ clusterId: args.clusterId, hubAccessToken: session.hubAccessToken }, { endpoint: getSetMainRoleEndpoint() });
    if (res.ok === false && res.reason === 'http-400') return { ok: false, reason: res.reason, message: 'The talent does not hold that role yet: call add_role with it, then set_main_role again.' };
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, clusterId: args.clusterId };
  }

  return [
    {
      name: 'list_available_roles',
      description: "List the roles the talent can add to their profile (the cluster catalog minus roles they already hold). Each row has clusterId (internal handle), name, category and an optional proposalKind (why it is suggested). Present roles to the talent by NAME; never show clusterId. Requires an active session.",
      inputSchema: EMPTY_SCHEMA,
      handler: listAvailableRoles,
    },
    {
      name: 'add_role',
      description: "Add a role to the talent's profile (a GROWTH role) by clusterId from list_available_roles. Requires an active session. Returns { clusterId, alreadyAssigned? }.",
      inputSchema: CLUSTER_SCHEMA,
      handler: addRole,
    },
    {
      name: 'list_my_roles',
      description: "List the roles the talent already holds, plus mainClusterId (their current main role) and `recommended`: the roles the onboarding interview and the CV import suggest, interview first. Use it before set_main_role. In the sign-up pass waitSeconds (20): it waits for the interview evaluation to recommend roles and says when to call again (`pending`) or to fall back to list_available_roles. Follow `message`. clusterId is an internal handle — refer to roles by name to the talent. Requires an active session.",
      inputSchema: LIST_MY_ROLES_SCHEMA,
      handler: listMyRoles,
    },
    {
      name: 'set_main_role',
      description: "Set the talent's MAIN role. In the sign-up it is the last step before open_web: after onboarding_interview_complete (or when the talent skipped the interview) and once list_my_roles is no longer pending, call it without clusterId: it asks the talent which of the recommended roles is their main one, with the catalogue as the last option (or straight from the catalogue when nothing is recommended), in a dialog when the client has one; otherwise it returns the question, its options and the roles to call it again with the clusterId they pick. Then it sets that role (adding a catalogue role first). Also usable standalone with clusterId to change the main role later; catalogue:true adds a catalogue role first. Requires an active session.",
      inputSchema: SET_MAIN_ROLE_SCHEMA,
      handler: setMainRole,
    },
  ];
}

module.exports = { makeRoleTools, EMPTY_SCHEMA, CLUSTER_SCHEMA, LIST_MY_ROLES_SCHEMA, SET_MAIN_ROLE_SCHEMA };
