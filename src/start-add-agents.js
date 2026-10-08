'use strict';

const {
  getUsageDiscoveredInventoryEndpoint,
  getAgentsListEndpoint,
  getAgentsDeclareEndpoint,
  getAgentsDraftFieldsEndpoint,
  getPortfoliosListEndpoint,
  getAgentPortfoliosEndpoint,
} = require('./config');
const {
  requestListAgents, requestDeclareAgent, requestDraftAgentFields, requestRelateAgentPortfolios,
} = require('./agents-client');
const { requestListPortfolios } = require('./portfolio-client');
const { requestDiscoveredInventory } = require('./inventory-client');
const { ensureFreshSession } = require('./session-refresh');
const { confirmDisclaimerAcceptance } = require('./certify-disclaimer');
const { runInteractiveMultiSelect } = require('./interactive-select');
const { loadAuthSession, sessionStatus } = require('./auth-session-store');
const { withSpinner } = require('./terminal-progress');
const { reasonCopy, pickPortfolios } = require('./start-add-skills');
// `askWithDefault`: pre-filled line prompt (empty enter accepts the default),
// reused from the portfolio route.
const { askWithDefault } = require('./start-add-portfolio');
const { styleQuestion, styleSuccess } = require('./ansi');

// `start`'s "Add agent to profile" route (talents-ai-score Phase 2), mirror of src/start-add-portfolio.js: the IA pre-drafts, the Talent edits.

const MAX_DEFINITION_CHARS = 4000;

async function askFreeText(ask, promptText) {
  return String(await ask(styleQuestion(promptText))).trim();
}

async function askNumberedChoice(ask, promptText, count) {
  const raw = (await ask(styleQuestion(promptText))).trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > count) return null;
  return n - 1;
}

// Step 1 — pick ONE detected agent (single-select, numbered-prompt fallback).
// Returns the agent, or null on cancel.
async function chooseAgent({ ask, stdinIsTTY, agents, c, input, output }) {
  const labelFor = (a) => a.pickerLabel || a.name;
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items: agents,
      labelFor,
      header: c.agentPickHeading,
      hint: c.agentPickHint,
      single: true,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    // Drain the picker-residual-Enter (the suspend/resume mode switch can leave a
    // stray Enter that pre-answers the next prompt) — same fix as bin/start.js/certify.js.
    if (typeof ask.drain === 'function') ask.drain();
    return picked && picked.length ? picked[0] : null;
  }

  process.stdout.write(`\n  ${styleQuestion(c.agentPickHeading)}\n`);
  agents.forEach((a, i) => process.stdout.write(`    ${i + 1}) ${labelFor(a)}\n`));
  const idx = await askNumberedChoice(ask, `  ${c.agentPickPrompt(agents.length)}`, agents.length);
  return idx === null ? null : agents[idx];
}

// Step 4 — the two AI-drafted fields, consent-gated (ADR-052) before any egress.
async function resolveAgentFields({ ask, catalog, c, stdinIsTTY, agent, accessToken, preAccepted = false }) {
  const freeText = async () => ({
    whatItDoes: await askFreeText(ask, c.agentWhatItDoesFreeTextPrompt),
    humanDecides: await askFreeText(ask, c.agentHumanDecidesFreeTextPrompt),
  });

  const draftEndpoint = getAgentsDraftFieldsEndpoint();
  if (!draftEndpoint) return freeText();

  const acceptance = await confirmDisclaimerAcceptance({
    ask, catalog, stdinIsTTY, preAccepted, text: c.agentFieldsConsentDisclaimer,
  });
  if (!acceptance.accepted) return freeText();

  const definition = typeof agent.definition === 'string' && agent.definition
    ? agent.definition.slice(0, MAX_DEFINITION_CHARS)
    : null;
  const draft = await withSpinner(c.agentDraftingLabel, () => requestDraftAgentFields(
    { name: agent.name, tools: agent.tools, model: agent.model, parent: agent.parent, definition, accessToken },
    { endpoint: draftEndpoint },
  ));
  if (!draft.ok) return freeText();

  process.stdout.write(`\n  ${styleQuestion(c.agentWhatItDoesDraftLabel)}\n  ${draft.whatItDoes}\n`);
  const whatItDoes = await askWithDefault(ask, c.agentWhatItDoesEditPrompt, draft.whatItDoes);
  process.stdout.write(`\n  ${styleQuestion(c.agentHumanDecidesDraftLabel)}\n  ${draft.humanDecides}\n`);
  const humanDecides = await askWithDefault(ask, c.agentHumanDecidesEditPrompt, draft.humanDecides);
  return { whatItDoes, humanDecides };
}

// Asks to re-login and returns the fresh session, or null. Reuses the portfolio
// route's generic relogin copys.
async function offerRelogin({ ask, c, runLogin }) {
  if (typeof runLogin !== 'function') return null;
  const raw = String(await ask(`\n  ${styleQuestion(c.portfolioOfferRelogin)} `)).trim();
  if (!/^(y|yes|s|si|sí)$/i.test(raw)) {
    process.stdout.write(`\n  ${c.portfolioRelaunchDeclined}\n\n`);
    return null;
  }
  await runLogin([], { ask });
  const fresh = loadAuthSession();
  if (sessionStatus(fresh) !== 'active' || !fresh.hubAccessToken) {
    process.stdout.write(`\n  ${c.portfolioReloginFailed}\n\n`);
    return null;
  }
  return fresh;
}

async function offerRelateAgentToPortfolios({
  ask, stdinIsTTY, agentId, agentName, session, c, input, output,
}) {
  if (!agentId) return;
  const listEndpoint = getPortfoliosListEndpoint();
  const relateEndpoint = getAgentPortfoliosEndpoint(agentId);
  if (!listEndpoint || !relateEndpoint) return;

  const listed = await requestListPortfolios(
    { accessToken: session.accessToken, hubAccessToken: session.hubAccessToken },
    { endpoint: listEndpoint },
  );
  if (!listed.ok || listed.portfolios.length === 0) {
    process.stdout.write(`\n  ${c.agentRelateNoPortfolios}\n`);
    return;
  }

  const wantsRelate = /^(y|yes|s|si|sí)$/i.test(String(await ask(`\n  ${styleQuestion(c.agentRelateAsk(agentName))} `)).trim());
  if (!wantsRelate) {
    process.stdout.write(`  ${c.agentRelateSkipped(agentName)}\n`);
    return;
  }

  const heading = c.agentRelateSelectHeading(agentName);
  const chosen = await pickPortfolios({ ask, stdinIsTTY, portfolios: listed.portfolios, heading, c, input, output });
  if (!chosen || chosen.length === 0) {
    process.stdout.write(`  ${c.agentRelateSkipped(agentName)}\n`);
    return;
  }

  const items = chosen.map((portfolio) => ({ portfolioId: portfolio.id }));

  const r = await requestRelateAgentPortfolios(
    { agentId, items, hubAccessToken: session.hubAccessToken },
    { endpoint: relateEndpoint },
  );
  if (r.ok) {
    for (const portfolio of chosen) {
      process.stdout.write(`  ${styleSuccess(c.agentRelated(agentName, portfolio.name))}\n`);
    }
  } else {
    process.stdout.write(`  ${c.agentRelateFailed(agentName, reasonCopy(r.reason, c))}\n`);
  }
}

async function runAddAgents({
  ask, catalog, root, session, stdinIsTTY, input, output, preAccepted = false, deps = {},
} = {}) {
  const c = catalog.start;
  const runLogin = deps.runLogin;
  const refreshSession = deps.refreshSession || (() => ensureFreshSession(process.env));

  const inventoryEndpoint = getUsageDiscoveredInventoryEndpoint();
  const listEndpoint = getAgentsListEndpoint();
  const declareEndpoint = getAgentsDeclareEndpoint();
  if (!inventoryEndpoint || !listEndpoint || !declareEndpoint) {
    process.stderr.write(`\n  ${c.agentErrorNoEndpoint}\n\n`);
    return;
  }

  let hubAccessToken = session.hubAccessToken;
  if (!hubAccessToken) {
    process.stderr.write(`\n  ${c.agentNoHubToken}\n\n`);
    return;
  }

  let inventory = await requestDiscoveredInventory(
    { accessToken: session.accessToken },
    { endpoint: inventoryEndpoint },
  );
  // An expired hub JWT (the same 401 the usage poll hits) must not break add-agent:
  // refresh the session once and retry the read (and adopt the fresh tokens downstream).
  if (inventory.reason === 'http-401') {
    let fresh = null;
    try { fresh = await refreshSession(); } catch { fresh = null; }
    if (fresh && (fresh.accessToken || fresh.hubAccessToken)) {
      session = { ...session, accessToken: fresh.accessToken || session.accessToken, hubAccessToken: fresh.hubAccessToken || session.hubAccessToken };
      hubAccessToken = session.hubAccessToken;
      inventory = await requestDiscoveredInventory(
        { accessToken: session.accessToken },
        { endpoint: inventoryEndpoint },
      );
    }
  }
  if (!inventory.ok) {
    process.stderr.write(`\n  ${c.agentInventoryError(reasonCopy(inventory.reason, c))}\n\n`);
    return;
  }
  const agents = inventory.agents;
  if (agents.length === 0) {
    process.stdout.write(`\n  ${c.agentNoAgentsDetected}\n\n`);
    return;
  }
  for (const a of agents) a.pickerLabel = a.role ? `${a.name} — ${a.role}` : a.name;

  // DEDUP by name (before asking anything). A failed list is reported as "could
  // not verify" (never "no duplicates") and the flow continues.
  const listed = await withSpinner(
    c.agentDedupCheckingLabel,
    () => requestListAgents({ accessToken: session.accessToken, hubAccessToken }, { endpoint: listEndpoint }),
  );
  const existingNames = listed.ok ? listed.agents.map((a) => a.name.toLowerCase()) : null;
  if (!listed.ok) process.stdout.write(`\n  ${c.agentDedupCheckFailed(reasonCopy(listed.reason, c))}\n`);

  process.stdout.write(`\n  ${c.agentIntro}\n`);

  // (1) Pick a detected agent.
  const agent = await chooseAgent({ ask, stdinIsTTY, agents, c, input, output });
  if (!agent) {
    process.stdout.write(`\n  ${c.agentCancelled}\n\n`);
    return;
  }

  // (3) Name ← detected, editable. (2) dedup applies to the FINAL name.
  const name = await askWithDefault(ask, c.agentNamePrompt(agent.name), agent.name);
  if (existingNames && existingNames.includes(name.toLowerCase())) {
    const existing = listed.ok ? listed.agents.find((a) => a.name.toLowerCase() === name.toLowerCase()) : null;
    const existingId = existing && existing.id ? existing.id : null;
    if (existingId) {
      process.stdout.write(`\n  ${c.agentAlreadyAdded(name)}\n`);
      await offerRelateAgentToPortfolios({
        ask, stdinIsTTY, agentId: existingId, agentName: name, session, c, input, output,
      });
      process.stdout.write('\n');
    } else {
      process.stdout.write(`\n  ${c.agentDuplicateName(name)}\n\n`);
    }
    return;
  }

  // (4) whatItDoes + humanDecides — AI draft (consent-gated) or free-text.
  const { whatItDoes, humanDecides } = await resolveAgentFields({
    ask, catalog, c, stdinIsTTY, agent, accessToken: session.accessToken, preAccepted,
  });

  const matchedRole = agent.role || null;
  if (matchedRole) process.stdout.write(`\n  ${c.agentCatalogMatched(matchedRole)}\n`);

  const payload = { name, whatItDoes: whatItDoes || agent.whatItDoes, humanDecides };

  // Declare.
  const declared = await withSpinner(
    c.agentDeclaring,
    () => requestDeclareAgent({ ...payload, accessToken: session.accessToken, hubAccessToken }, { endpoint: declareEndpoint }),
  );
  if (declared.ok) {
    process.stdout.write(`\n  ${styleSuccess(c.agentDeclaredSuccess(name))}\n`);
    await offerRelateAgentToPortfolios({
      ask, stdinIsTTY, agentId: declared.agentId, agentName: name, session, c, input, output,
    });
    process.stdout.write('\n');
    return;
  }
  if (declared.reason !== 'hub-session-expired') {
    process.stdout.write(`\n  ${c.agentDeclareFailed(reasonCopy(declared.reason, c))}\n\n`);
    return;
  }

  // Hub session expired mid-flight — offer one relogin + retry.
  process.stdout.write(`\n  ${c.agentHubSessionExpired}\n`);
  const relogged = await offerRelogin({ ask, c, runLogin });
  if (!relogged) return;
  process.stdout.write(`  ${c.portfolioRelaunchAfterRelogin}\n`);
  const retried = await withSpinner(
    c.agentDeclaring,
    () => requestDeclareAgent(
      { ...payload, accessToken: relogged.accessToken, hubAccessToken: relogged.hubAccessToken },
      { endpoint: declareEndpoint },
    ),
  );
  if (retried.ok) {
    process.stdout.write(`\n  ${styleSuccess(c.agentDeclaredSuccess(name))}\n`);
    await offerRelateAgentToPortfolios({
      ask, stdinIsTTY, agentId: retried.agentId, agentName: name, session: relogged, c, input, output,
    });
    process.stdout.write('\n');
  } else {
    process.stdout.write(`\n  ${c.agentDeclareFailed(reasonCopy(retried.reason, c))}\n\n`);
  }
}

module.exports = {
  runAddAgents,
  chooseAgent,
  resolveAgentFields,
  offerRelateAgentToPortfolios,
};
