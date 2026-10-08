'use strict';

const { getUsageDiscoveredInventoryEndpoint, getSkillsDeclareEndpoint, getPortfoliosListEndpoint, getPortfolioUpdateEndpoint } = require('./config');
const { requestDeclareSkill } = require('./skills-client');
const { requestDiscoveredInventory } = require('./inventory-client');
const { requestListPortfolios, requestUpdatePortfolioSkills } = require('./portfolio-client');
const { confirmDisclaimerAcceptance } = require('./certify-disclaimer');
const { runInteractiveMultiSelect } = require('./interactive-select');
const { loadAuthSession, sessionStatus } = require('./auth-session-store');
const { styleSuccess } = require('./ansi');

// `start`'s "Añadir skills" route (talents-ai-score, ADR-054/055).

// Maps a technical failure reason to the localized `start.errorReason` copy.
function reasonCopy(reason, c) {
  if (typeof reason === 'string' && reason.startsWith('http-')) {
    return c.errorReasonHttp(reason.slice('http-'.length));
  }
  return c.errorReason[reason] || c.errorReason.generic;
}

function parseMultiIndices(raw, count) {
  const trimmed = String(raw == null ? '' : raw).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  const idx = new Set();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 1 || n > count) return null;
    idx.add(n - 1);
  }
  return idx.size > 0 ? [...idx].sort((a, b) => a - b) : null;
}

// Numbered fallback prompt for the multi-select, mirroring
// bin/certify.js#askNumberedChoice's shape but for a LIST of indices.
async function askMultiIndices(ask, promptText, count) {
  const raw = await ask(promptText);
  return parseMultiIndices(raw, count);
}

async function pickSkills({ ask, stdinIsTTY, candidates, c, input, output }) {
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items: candidates,
      labelFor: (s) => `${s.skillName}${s.technology ? ` (${s.technology})` : ''}`,
      header: c.addSkillsSelectHeading,
      hint: c.addSkillsSelectHint,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return picked || [];
  }
  process.stdout.write(`\n  ${c.addSkillsSelectHeading}\n`);
  candidates.forEach((s, i) => {
    process.stdout.write(`    ${i + 1}) ${s.skillName}${s.technology ? ` (${s.technology})` : ''}\n`);
  });
  const idxs = await askMultiIndices(ask, `  ${c.addSkillsSelectPrompt(candidates.length)}`, candidates.length);
  return idxs ? idxs.map((i) => candidates[i]) : [];
}

// Declares every chosen skill against the CURRENT `hubAccessToken`.
async function declareAll(chosen, { accessToken, hubAccessToken }, endpoint, c) {
  const pending = [];
  const declared = [];
  let hubSessionExpired = false;
  let succeeded = 0;
  for (const skill of chosen) {
    if (hubSessionExpired) {
      pending.push(skill);
      continue;
    }
    const r = await requestDeclareSkill({ skillId: skill.skillId, accessToken, hubAccessToken }, { endpoint });
    if (r.ok) {
      process.stdout.write(`  ${styleSuccess(c.addSkillsDeclaredOne(skill.skillName))}\n`);
      succeeded += 1;
      declared.push(skill);
    } else if (r.reason === 'hub-session-expired') {
      hubSessionExpired = true;
      pending.push(skill);
    } else {
      process.stdout.write(`  ${c.addSkillsDeclareFailed(skill.skillName, reasonCopy(r.reason, c))}\n`);
    }
  }
  return { pending, hubSessionExpired, succeeded, declared };
}

async function pickPortfolios({ ask, stdinIsTTY, portfolios, heading, c, input, output }) {
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items: portfolios,
      labelFor: (p) => p.name,
      header: heading,
      hint: c.addSkillsRelateSelectHint,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return picked || [];
  }
  process.stdout.write(`\n  ${heading}\n`);
  portfolios.forEach((p, i) => {
    process.stdout.write(`    ${i + 1}) ${p.name}\n`);
  });
  const idxs = await askMultiIndices(ask, `  ${c.addSkillsRelateSelectPrompt(portfolios.length)}`, portfolios.length);
  return idxs ? idxs.map((i) => portfolios[i]) : [];
}

async function relateSkillToPortfolios({ ask, stdinIsTTY, skill, portfolios, hubAccessToken, updateEndpoint, c, input, output }) {
  const wantsRelate = /^(y|yes|s|si|sí)$/i.test(String(await ask(`\n  ${c.addSkillsRelateAsk(skill.skillName)} `)).trim());
  if (!wantsRelate) {
    process.stdout.write(`  ${c.addSkillsRelateSkipped(skill.skillName)}\n`);
    return;
  }
  const relateHeading = c.addSkillsRelateSelectHeading(skill.skillName);
  const chosenPortfolios = await pickPortfolios({ ask, stdinIsTTY, portfolios, heading: relateHeading, c, input, output });
  if (!chosenPortfolios || chosenPortfolios.length === 0) {
    process.stdout.write(`  ${c.addSkillsRelateSkipped(skill.skillName)}\n`);
    return;
  }
  for (const portfolio of chosenPortfolios) {
    const skillIds = Array.from(new Set([...(portfolio.skillIds || []), skill.skillId]));
    const r = await requestUpdatePortfolioSkills({ portfolioId: portfolio.id, skillIds, hubAccessToken }, { endpoint: updateEndpoint });
    if (r.ok) {
      portfolio.skillIds = skillIds;
      process.stdout.write(`${styleSuccess(c.addSkillsRelated(skill.skillName, portfolio.name))}\n`);
    } else {
      process.stdout.write(`${c.addSkillsRelateFailed(skill.skillName, portfolio.name, reasonCopy(r.reason, c))}\n`);
    }
  }
}

async function offerRelateToPortfolios({ ask, stdinIsTTY, declared, session, c, input, output }) {
  if (!declared || declared.length === 0) return;
  const listEndpoint = getPortfoliosListEndpoint();
  const updateEndpoint = getPortfolioUpdateEndpoint();
  if (!listEndpoint || !updateEndpoint) return;

  const listed = await requestListPortfolios(
    { accessToken: session.accessToken, hubAccessToken: session.hubAccessToken },
    { endpoint: listEndpoint },
  );
  if (!listed.ok || listed.portfolios.length === 0) {
    process.stdout.write(`\n  ${c.addSkillsRelateNoPortfolios}\n`);
    return;
  }

  for (const skill of declared) {
    await relateSkillToPortfolios({
      ask, stdinIsTTY, skill, portfolios: listed.portfolios, hubAccessToken: session.hubAccessToken, updateEndpoint, c, input, output,
    });
  }
}

// The whole route.
async function runAddSkills({
  ask, catalog, root, session, stdinIsTTY, input, output, preAccepted = false, deps = {},
} = {}) {
  const c = catalog.start;
  const runLogin = deps.runLogin;

  const inventoryEndpoint = getUsageDiscoveredInventoryEndpoint();
  const declareEndpoint = getSkillsDeclareEndpoint();
  if (!inventoryEndpoint || !declareEndpoint) {
    process.stderr.write(`\n  ${c.addSkillsErrorNoEndpoint}\n\n`);
    return;
  }

  const acceptance = await confirmDisclaimerAcceptance({ ask, catalog, stdinIsTTY, preAccepted });
  if (!acceptance.accepted) return; // confirmDisclaimerAcceptance already printed why

  const inventory = await requestDiscoveredInventory(
    { accessToken: session.accessToken },
    { endpoint: inventoryEndpoint },
  );
  if (!inventory.ok) {
    process.stderr.write(`\n  ${c.addSkillsResolveErrorIntro} ${reasonCopy(inventory.reason, c)}\n\n`);
    return;
  }

  const candidates = inventory.skills.map((skill) => ({
    skillId: skill.skillId,
    skillName: skill.skillName,
    technology: skill.technologies.join(', '),
  }));
  if (candidates.length === 0) {
    process.stdout.write(`\n  ${c.addSkillsNoneMatched}\n\n`);
    return;
  }

  const hubAccessToken = session.hubAccessToken;
  if (!hubAccessToken) {
    process.stderr.write(`\n  ${c.addSkillsNoHubToken}\n\n`);
    return;
  }

  const chosen = await pickSkills({ ask, stdinIsTTY, candidates, c, input, output });
  if (!chosen || chosen.length === 0) {
    process.stdout.write(`\n  ${c.addSkillsNoneChosen}\n\n`);
    return;
  }

  process.stdout.write('\n');
  const { pending, hubSessionExpired, succeeded, declared } = await declareAll(
    chosen, { accessToken: session.accessToken, hubAccessToken }, declareEndpoint, c,
  );
  if (!hubSessionExpired) {
    printProfileBoost(succeeded, c);
    await offerRelateToPortfolios({ ask, stdinIsTTY, declared, session, c, input, output });
    process.stdout.write('\n');
    return;
  }

  process.stdout.write(`\n  ${c.addSkillsHubSessionExpired}\n`);
  const relogged = await offerRelogin({ ask, c, runLogin });
  if (!relogged) return;
  process.stdout.write(`  ${c.addSkillsRelaunchAfterRelogin}\n\n`);
  const retried = await declareAll(pending, { accessToken: relogged.accessToken, hubAccessToken: relogged.hubAccessToken }, declareEndpoint, c);
  printProfileBoost(succeeded + retried.succeeded, c);
  await offerRelateToPortfolios({
    ask, stdinIsTTY, declared: [...declared, ...retried.declared], session: relogged, c, input, output,
  });
  process.stdout.write('\n');
}

function printProfileBoost(succeeded, c) {
  if (succeeded > 0) process.stdout.write(`  ${c.addSkillsProfileBoost}\n`);
}

// Asks the Talent whether to re-login, right there, and runs it if they say yes.
async function offerRelogin({ ask, c, runLogin }) {
  if (typeof runLogin !== 'function') return null;
  const raw = String(await ask(`\n  ${c.addSkillsOfferRelogin} `)).trim();
  if (!/^(y|yes|s|si|sí)$/i.test(raw)) {
    process.stdout.write(`\n  ${c.addSkillsRelaunchDeclined}\n\n`);
    return null;
  }
  await runLogin([], { ask });
  const fresh = loadAuthSession();
  if (sessionStatus(fresh) !== 'active' || !fresh.hubAccessToken) {
    process.stdout.write(`\n  ${c.addSkillsReloginFailed}\n\n`);
    return null;
  }
  return fresh;
}

module.exports = {
  runAddSkills,
  parseMultiIndices,
  reasonCopy,
  declareAll,
  printProfileBoost,
  offerRelateToPortfolios,
  // Exported for src/start-add-agents.js's own relate step (ADR-041): the multi-select over the Talent's portfolios, reused verbatim.
  pickPortfolios,
};
