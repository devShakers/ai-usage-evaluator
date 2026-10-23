'use strict';

// MCP role tools: list, add and recommend roles, and set the main role (the sign-up's last step before open_web).

const { askChoice, askAfterTexts, chatChoice, forChat, optionFor, OPEN_MESSAGE } = require('./mcp-choice');
const { signupCopy, renderRole } = require('./signup-copy');
const { signupLanguage } = require('./signup-language');

const EMPTY_SCHEMA = { type: 'object', properties: {} };

// Same bounds as the web's growth-direction step: certs finalizes an interview within ~90 s, polled every 2 s.
const FINALIZATION_WAIT_LIMIT_MS = 90000;
const POLL_MS = 2000;
// Cap on the waitSeconds the model may pass; kept under Claude Desktop's ~60 s tool-call cap, higher than
// the old 25 so fewer polls (and fewer approval prompts) cover the ~90 s finalization.
const MAX_WAIT_SECONDS = 45;
const PENDING_FINALIZATION = new Set(['COLLECTING', 'PROCESSING']);
// Alma's signal from the interview first, then the CV import, as the web stacks them.
const SOURCE_ORDER = { ONBOARDING_INTERVIEW: 0, IMPORT: 1 };
// The chat's question tool takes two to four options: at most four roles are offered and the talent types any other one;
// a single role gets the "other role" button as its second option.
const MAX_ROLE_OPTIONS = 4;
const withOther = (names, other) => (names.length === 1 ? [...names, other] : names);

const fold = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const wordsOf = (text) => fold(text).split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 2);

// Words that name no specialty: a role sharing only these with the talent does not match.
const GENERIC_ROLE_WORDS = new Set(['developer', 'developers', 'dev', 'engineer', 'engineering', 'software', 'programmer', 'specialist', 'expert', 'consultant', 'senior', 'junior', 'lead', 'freelance',
  'desarrollador', 'desarrolladora', 'programador', 'programadora', 'ingeniero', 'ingeniera', 'especialista', 'experto', 'experta', 'consultor', 'consultora',
  'sviluppatore', 'sviluppatrice', 'programmatore', 'ingegnere', 'esperto', 'consulente', 'desenvolvedor', 'desenvolvedora', 'engenheiro', 'engenheira']);

// Catalogue roles by relevance: the exact name first, then shared role words, then stack words; a word many roles share (engineer) counts less, and only a specific word qualifies a role.
function rankRoles(roles, said, skills) {
  const names = roles.map((r) => wordsOf(r.name));
  const df = new Map();
  for (const words of names) for (const w of new Set(words)) df.set(w, (df.get(w) || 0) + 1);
  const weight = (words) => words.reduce((sum, w) => sum + 1 / df.get(w), 0);
  const asked = new Set(wordsOf(said));
  const stack = new Set(wordsOf(skills));
  const exact = fold(said).trim();
  const specific = (words) => words.filter((w) => !GENERIC_ROLE_WORDS.has(w));
  const shown = (role, words) => specific(words).map((w) => role.name.split(/[^A-Za-z0-9+#.]+/).find((t) => fold(t) === w) || w);
  return roles
    .map((role, i) => {
      const byRole = names[i].filter((w) => asked.has(w));
      const byStack = names[i].filter((w) => stack.has(w) && !asked.has(w));
      const isExact = !!exact && fold(role.name) === exact;
      const score = (isExact ? 100 : 0) + weight(byRole) + weight(byStack) / 2;
      const matches = isExact || specific([...byRole, ...byStack]).length > 0;
      return { role, score, matches, byRole: shown(role, byRole), byStack: shown(role, byStack) };
    })
    .sort((a, b) => b.score - a.score);
}

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
    skills: { type: 'string', description: 'With nothing recommended: the talent\'s main technologies from the CV or draft, comma separated. They rank the catalogue roles offered.' },
    evidence: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'In the sign-up, for each recommended role (by clusterId from list_my_roles): ONE short concrete fact from the CV, the interview or the AI-usage analysis that shows why it fits (e.g. "6 years with Spark and Airflow"), in the talent\'s language. It is shown under the role.',
    },
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
    clusterId: { type: 'string', description: 'The role the talent already picked, by clusterId from list_my_roles or from the roles this tool returned. Omit it in the sign-up: the tool asks the talent which recommended role is their main one (a dialog, or options it returns); a role they type instead is looked up in the catalogue.' },
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
    funnel = require('./onboarding-funnel').NOOP_FUNNEL,
    inSignup = () => require('./mcp-signup-tools').signupPhase() === 'account',
    completeOnboarding = (session) => require('./onboarding-client').requestCompleteOnboarding(
      { accessToken: session.accessToken, hubAccessToken: session.hubAccessToken },
      { endpoint: require('./config').getCompleteOnboardingEndpoint() },
    ),
  } = deps;
  let clustersCount;
  let onboardingCompleted = false;
  // The recommended roles were offered in the chat, so an answer that names none of them is a role the talent typed.
  let recommendedAsked = false;

  async function finishSignup(session) {
    if (onboardingCompleted || !inSignup()) return;
    const res = await completeOnboarding(session).catch(() => null);
    onboardingCompleted = !!(res && res.ok);
  }

  function trackSuggestions(roles) {
    funnel.viewed('supercluster', { suggested_superclusters: roles.map((r) => r.clusterId), suggestion_source: 'assigned_clusters', suggestions_count: roles.length });
  }

  const requireSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — sign in with social_signin_start (or run `shakers login`) first.');
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
    if (assigned.ok) clustersCount = clusters.length;
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
    } else if (read.mainClusterId) {
      await finishSignup(session);
      next = 'open_web';
      message = 'The talent already has a main role and nothing new was recommended: do not ask it again, go on to open_web. Only if the talent asks to change it, call set_main_role with catalogue:true.';
    } else {
      next = 'set_main_role';
      message = 'Nothing was recommended: call set_main_role without clusterId, with answer = the role their CV or draft names and skills = their main technologies: it offers the closest catalogue roles for the talent to pick (or asks their role), then adds and sets only the one they pick.';
    }
    return { ok: true, ...read, pending, ...(next ? { next } : {}), message };
  }

  function roleChoice(asked, roles, extra) {
    return {
      ok: false,
      reason: 'main-role-choice-required',
      ...(asked.dismissed ? { dismissed: asked.dismissed } : {}),
      ...forChat(asked.chat),
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

  // The main-role step: why each of the best recommended roles fits and how many projects want it, then the question; any other role the talent types is looked up in the catalogue.
  async function chooseMainRole(session, args, ctx) {
    const read = await readRoles(session.hubAccessToken);
    const recommended = byName(read.recommended).slice(0, MAX_ROLE_OPTIONS);
    if (!recommended.length && read.mainClusterId) {
      await finishSignup(session);
      return { reply: { ok: true, alreadySet: true, clusterId: read.mainClusterId, message: 'The talent already has a main role and nothing new was recommended: nothing to ask. Go on to open_web; only if they ask to change it, call set_main_role with catalogue:true.' } };
    }
    if (!recommended.length) return chooseFromCatalogue(args, ctx);
    const c = copy();
    const counts = await openCounts(session.hubAccessToken, recommended);
    trackSuggestions(recommended);
    const evidence = args.evidence && typeof args.evidence === 'object' ? args.evidence : {};
    const options = withOther(recommended.map((r) => r.name), c.mainRoleOther);
    // Each option numbered with why it fits; "another role" is its own label.
    const blocks = options.map((name, i) => (recommended[i] ? renderRole(lang(), { name, source: recommended[i].source, evidence: evidence[recommended[i].clusterId], openProjects: counts[i], recommended: i === 0 }) : name));
    const typed = typeof args.answer === 'string' ? args.answer.trim() : '';
    if (recommendedAsked && typed && !optionFor(typed, options)) {
      recommendedAsked = false;
      return chooseFromCatalogue({ answer: typed, skills: args.skills }, ctx);
    }
    const asked = await askAfterTexts(ctx, {
      tool: 'set_main_role',
      texts: [c.rolesIntro],
      listed: { blocks, after: [c.rolesOutro] },
      question: c.mainRoleQuestion,
      options,
      answer: args.answer,
      about: options,
    });
    if (asked.reply) {
      recommendedAsked = true;
      const other = options.includes(c.mainRoleOther) ? ' If they pick the last option, call set_main_role with catalogue:true and no clusterId.' : '';
      return { reply: { ...asked.reply, roles: recommended.map((r) => ({ clusterId: r.clusterId, name: r.name })), message: `${asked.reply.message} Pass the same evidence again.${other} If they type another role instead of picking one, pass what they typed as answer: the closest catalogue roles are offered.` } };
    }
    recommendedAsked = false;
    if (asked.answer === c.mainRoleOther) return chooseFromCatalogue({}, ctx);
    return { role: recommended.find((r) => r.name === asked.answer) };
  }

  // The catalogue roles last offered: an answer naming one of them is the talent's pick, any other text is only a query.
  let offered = null;

  function askOwnRole() {
    offered = null;
    return {
      reply: {
        ok: false,
        reason: 'main-role-ask',
        say: copy().mainRoleAsk,
        message: `${OPEN_MESSAGE} Then call set_main_role with catalogue:true and answer = what they say: it offers the closest catalogue roles.`,
      },
    };
  }

  async function chooseFromCatalogue(args, ctx) {
    const c = copy();
    const said = typeof args.answer === 'string' ? args.answer.trim() : '';
    if (offered) {
      const picked = optionFor(said, withOther(offered.map((r) => r.name), c.mainRoleNotListed));
      if (picked === c.mainRoleNotListed) return askOwnRole();
      const role = picked && offered.find((r) => r.name === picked);
      if (role) { offered = null; return { role, add: true }; }
    }
    const available = await listAvailableRoles();
    if (!available.ok) return { reply: { ok: false, reason: available.reason } };
    const roles = byName(available.roles);
    if (!roles.length) return { reply: { ok: false, reason: 'no-roles' } };
    const ranked = rankRoles(roles, said, args.skills);
    const shown = roles.length <= MAX_ROLE_OPTIONS ? ranked : ranked.filter((m) => m.matches).slice(0, MAX_ROLE_OPTIONS);
    if (!shown.length) return askOwnRole();
    // This call's own list: another call may replace `offered` while the dialog is open.
    const options = shown.map((m) => m.role);
    offered = options;
    // Same block as the recommended roles: intro, the best match marked, its reason, its open projects, then what the main profile is.
    const fits = shown.filter((m) => m.byRole.length || m.byStack.length);
    const session = loadAuthSession();
    const counts = fits.length ? await openCounts(session && session.hubAccessToken, fits.map((m) => m.role)) : [];
    const blocks = fits.map((m, i) => [
      i === 0 ? c.roleRecommended(m.role.name) : c.roleName(m.role.name),
      m.byRole.length ? c.catalogueReason.role(m.byRole.join(', ')) : null,
      m.byStack.length ? c.catalogueReason.stack(m.byStack.join(', ')) : null,
      typeof counts[i] === 'number' && counts[i] > 0 ? c.openProjects(counts[i]) : null,
    ].filter(Boolean).join('\n'));
    const texts = [[...(blocks.length ? [c.rolesIntro, ...blocks] : []), c.rolesOutro].join('\n\n')];
    trackSuggestions([]);
    const names = withOther(options.map((r) => r.name), c.mainRoleNotListed);
    const asked = await askChoice(ctx, { texts, question: c.mainRoleQuestion, options: names });
    if (asked.answer === c.mainRoleNotListed) return askOwnRole();
    const role = asked.answer && options.find((r) => r.name === asked.answer);
    if (role) {
      offered = null;
      return { role, add: true };
    }
    offered = options;
    const other = names.includes(c.mainRoleNotListed) ? ' If they pick the last option, call set_main_role with catalogue:true and answer = that option.' : '';
    return { reply: roleChoice(asked.chat ? asked : { chat: chatChoice(c.mainRoleQuestion, names, texts) }, options, `Pass catalogue:true too: it adds the role first.${other} If they type another role instead, call set_main_role with catalogue:true and answer = what they typed.`) };
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
      const set = await applyMainRole(session, picked.role.clusterId, { suggestion: !picked.add });
      return set.ok ? { ...set, name: picked.role.name } : set;
    }
    return applyMainRole(session, args.clusterId, { suggestion: args.catalogue === true ? false : undefined });
  }

  async function applyMainRole(session, clusterId, { suggestion } = {}) {
    const res = await requestSetMainRole({ clusterId, hubAccessToken: session.hubAccessToken }, { endpoint: getSetMainRoleEndpoint() });
    if (res.ok === false && res.reason === 'http-400') return { ok: false, reason: res.reason, message: 'The talent does not hold that role yet: call add_role with it, then set_main_role again.' };
    if (!res.ok) return { ok: false, reason: res.reason };
    funnel.completed('supercluster', { supercluster: clusterId, clusters_count: clustersCount, was_suggestion_accepted: suggestion });
    funnel.flush();
    await finishSignup(session);
    return { ok: true, clusterId };
  }

  return [
    {
      name: 'list_available_roles',
      title: 'Roles you can add',
      description: 'Shows the Shakers roles you can add to your profile.',
      guidance: "List the roles the talent can add to their profile (the cluster catalog minus roles they already hold). Each row has clusterId (internal handle), name, category and an optional proposalKind (why it is suggested). Present roles to the talent by NAME; never show clusterId. Requires an active session.",
      inputSchema: EMPTY_SCHEMA,
      handler: listAvailableRoles,
    },
    {
      name: 'add_role',
      title: 'Add a role',
      description: 'Adds the role you pick to your Shakers profile.',
      guidance: "Add a role to the talent's profile (a GROWTH role) by clusterId from list_available_roles. Requires an active session. Returns { clusterId, alreadyAssigned? }.",
      inputSchema: CLUSTER_SCHEMA,
      handler: addRole,
    },
    {
      name: 'list_my_roles',
      title: 'Your roles',
      description: 'Shows your roles on Shakers and the ones suggested by your interview and your CV.',
      guidance: "List the roles the talent already holds, plus mainClusterId (their current main role) and `recommended`: the roles the onboarding interview and the CV import suggest, interview first. Use it before set_main_role. In the sign-up pass waitSeconds (45): it waits for the interview evaluation to recommend roles and says when to call again (`pending`) or to fall back to list_available_roles. Follow `message`. clusterId is an internal handle — refer to roles by name to the talent. Requires an active session.",
      inputSchema: LIST_MY_ROLES_SCHEMA,
      handler: listMyRoles,
    },
    {
      name: 'set_main_role',
      title: 'Choose your main role',
      description: 'Asks you which role is your main one and saves it on your Shakers profile.',
      guidance: "Set the talent's MAIN role. In the sign-up it is the last step before open_web: after onboarding_interview_complete (or when the talent skipped the interview) and once list_my_roles is no longer pending, call it without clusterId: it asks the talent which of the (at most four) recommended roles is their main one (or straight from the catalogue when nothing is recommended), in a dialog when the client has one; otherwise it returns the question and the roles, to call it again with the clusterId they pick, or with answer = another role they type, which it looks up in the catalogue. Then it sets that role (adding a catalogue role first). Also usable standalone with clusterId to change the main role later; catalogue:true adds a catalogue role first. Requires an active session.",
      inputSchema: SET_MAIN_ROLE_SCHEMA,
      handler: setMainRole,
    },
  ];
}

module.exports = { makeRoleTools, EMPTY_SCHEMA, CLUSTER_SCHEMA, LIST_MY_ROLES_SCHEMA, SET_MAIN_ROLE_SCHEMA };
