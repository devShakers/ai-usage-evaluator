'use strict';

const fs = require('fs');
const path = require('path');

const { detectTechnologies } = require('./tech-detector');
const {
  getPortfoliosListEndpoint, getPortfoliosDeclareEndpoint, getPortfolioDraftDescriptionEndpoint,
  getSkillsResolveMatchedEndpoint, getSkillsResolveAddableEndpoint, getSkillsDeclareEndpoint,
} = require('./config');
const { requestListPortfolios, requestDeclarePortfolio, requestDraftDescription } = require('./portfolio-client');
const { requestResolveAddableSkills: requestResolveMatchedSkills, requestResolveAddableSkills } = require('./skills-client');
const { getRemoteUrl, getCommitDateRange } = require('./portfolio-git-info');
const { confirmDisclaimerAcceptance } = require('./certify-disclaimer');
const { runInteractiveMultiSelect, wrapDesc } = require('./interactive-select');
const { loadAuthSession, sessionStatus } = require('./auth-session-store');
const { withSpinner } = require('./terminal-progress');
const { parseMultiIndices, reasonCopy, declareAll, printProfileBoost } = require('./start-add-skills');
const { palette, styleQuestion, styleSuccess } = require('./ansi');

// Only `dim`/`reset` for the numbered fallback's descriptions — the exact treatment bin/start.js's own menu and bin/certify.js's picker give theirs.
const ANSI = palette({ reset: '\x1b[0m', dim: '\x1b[2m' });

// `start`'s "Add project to portfolio" route (talents-ai-score, ADR-059).

const MAX_README_CHARS = 4000;
const MAX_PACKAGE_DESCRIPTION_CHARS = 500;

function readPackageDescription(root) {
  try {
    const raw = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    if (typeof pkg.description === 'string' && pkg.description.trim()) {
      return pkg.description.trim().slice(0, MAX_PACKAGE_DESCRIPTION_CHARS);
    }
  } catch { /* no package.json, unreadable, or malformed JSON */ }
  return null;
}

function readReadme(root) {
  for (const name of ['README.md', 'README.MD', 'Readme.md', 'readme.md']) {
    try {
      const raw = fs.readFileSync(path.join(root, name), 'utf8');
      if (raw && raw.trim()) return raw.trim().slice(0, MAX_README_CHARS);
    } catch { /* try the next candidate */ }
  }
  return null;
}

async function askWithDefault(ask, promptText, defaultValue) {
  const raw = String(await ask(styleQuestion(promptText))).trim();
  return raw || String(defaultValue || '');
}

async function askFreeText(ask, promptText) {
  return String(await ask(styleQuestion(promptText))).trim();
}

function normalizeDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.replace(/^www\./, '');
  return s;
}

// Step 2 — Type.
function typeOptions(c) {
  return [
    { key: 'PORTFOLIO', label: c.portfolioTypePortfolio, desc: c.portfolioTypePortfolioDesc },
    { key: 'EXPERIENCE', label: c.portfolioTypeExperience, desc: c.portfolioTypeExperienceDesc },
  ];
}

async function askNumberedChoice(ask, promptText, count) {
  const raw = (await ask(styleQuestion(promptText))).trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > count) return null;
  return n - 1;
}

async function chooseType({ ask, c, input, output }) {
  const options = typeOptions(c);
  if (typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items: options,
      labelFor: (o) => o.label,
      header: c.portfolioTypeHeading,
      hint: c.portfolioTypeHint,
      single: true,
      descriptionFor: (o) => o.desc || null,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return picked && picked.length ? picked[0].key : null;
  }

  process.stdout.write(`\n  ${styleQuestion(c.portfolioTypeHeading)}\n`);
  options.forEach((o, i) => {
    process.stdout.write(`    ${i + 1}) ${o.label}\n`);
    if (o.desc) for (const line of wrapDesc(o.desc)) process.stdout.write(`       ${ANSI.dim}${line}${ANSI.reset}\n`);
  });
  const idx = await askNumberedChoice(ask, `  ${c.portfolioTypePrompt(options.length)}`, options.length);
  return idx === null ? null : options[idx].key;
}

// Step 5 — Skills.
async function pickPortfolioSkills({ ask, stdinIsTTY, candidates, c, input, output }) {
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items: candidates,
      labelFor: (s) => `${s.skillName}${s.technology ? ` (${s.technology})` : ''}`,
      header: c.portfolioSkillsSelectHeading,
      hint: c.portfolioSkillsSelectHint,
      initialMarked: candidates.map((_, i) => i),
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return picked; // null on cancel, [] is a legal ("unchecked everything") choice
  }

  process.stdout.write(`\n  ${styleQuestion(c.portfolioSkillsSelectHeading)}\n`);
  candidates.forEach((s, i) => {
    process.stdout.write(`    [x] ${i + 1}) ${s.skillName}${s.technology ? ` (${s.technology})` : ''}\n`);
  });
  const raw = (await ask(`  ${styleQuestion(c.portfolioSkillsSelectPrompt(candidates.length))}`)).trim();
  if (!raw) return candidates; // empty -> keep the pre-marked default (ALL), not "none"
  const idxs = parseMultiIndices(raw, candidates.length);
  if (!idxs) {
    process.stdout.write(`  ${c.portfolioSkillsSelectInvalid}\n`);
    return candidates; // unparseable -> the forgiving default, never a silent []
  }
  return idxs.map((i) => candidates[i]);
}

// Resolves the pre-marked Skill candidates for step 5.
async function resolvePortfolioSkills({ ask, stdinIsTTY, technologies, c, input, output, accessToken }) {
  if (technologies.length === 0) return [];
  const endpoint = getSkillsResolveMatchedEndpoint();
  if (!endpoint) return [];

  const resolved = await withSpinner(c.portfolioSkillsResolvingLabel, () => requestResolveMatchedSkills({ technologies, accessToken }, { endpoint }));
  if (!resolved.ok || resolved.addable.length === 0) return [];

  const chosen = await pickPortfolioSkills({ ask, stdinIsTTY, candidates: resolved.addable, c, input, output });
  return chosen || []; // esc/cancel -> treat like "none chosen" for this OPTIONAL step, never abort the whole route
}

async function pickAddableSkillsForProfile({ ask, stdinIsTTY, candidates, c, input, output }) {
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items: candidates,
      labelFor: (s) => `${s.skillName}${s.technology ? ` (${s.technology})` : ''}`,
      header: c.portfolioAddSkillsHeading,
      hint: c.portfolioAddSkillsHint,
      initialMarked: candidates.map((_, i) => i),
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    });
    ask.resume();
    return picked; // null on cancel, [] is a legal ("unchecked everything") choice
  }

  process.stdout.write(`\n  ${styleQuestion(c.portfolioAddSkillsHeading)}\n`);
  candidates.forEach((s, i) => {
    process.stdout.write(`    [x] ${i + 1}) ${s.skillName}${s.technology ? ` (${s.technology})` : ''}\n`);
  });
  const raw = (await ask(`  ${styleQuestion(c.portfolioAddSkillsPrompt(candidates.length))}`)).trim();
  if (!raw) return candidates; // empty -> keep the pre-marked default (ALL), not "none"
  const idxs = parseMultiIndices(raw, candidates.length);
  if (!idxs) {
    process.stdout.write(`  ${c.portfolioAddSkillsInvalid}\n`);
    return candidates; // unparseable -> the forgiving default, never a silent []
  }
  return idxs.map((i) => candidates[i]);
}

// The whole opt-in step.
async function offerAddableSkillsForProfile({ ask, catalog, c, technologies, session, stdinIsTTY, input, output, runLogin }) {
  if (technologies.length === 0) return;
  const resolveEndpoint = getSkillsResolveAddableEndpoint();
  const declareEndpoint = getSkillsDeclareEndpoint();
  if (!resolveEndpoint || !declareEndpoint) return;

  const resolved = await withSpinner(
    c.portfolioAddSkillsResolvingLabel,
    () => requestResolveAddableSkills({ technologies, accessToken: session.accessToken }, { endpoint: resolveEndpoint }),
  );
  if (!resolved.ok) return; // an actual failure (network/etc) — unrelated to dedup, stays silent as before
  if (resolved.addable.length === 0) {
    process.stdout.write(`\n  ${c.portfolioAddSkillsAllAlreadyDeclared}\n`);
    return;
  }

  const hubAccessToken = session.hubAccessToken;
  if (!hubAccessToken) return; // shouldn't happen this late (the portfolio declare above already needed one), never crash

  process.stdout.write(`\n  ${c.portfolioAddSkillsIntro}\n`);
  const chosen = await pickAddableSkillsForProfile({ ask, stdinIsTTY, candidates: resolved.addable, c, input, output });
  if (!chosen || chosen.length === 0) return; // esc/cancel or "none chosen" -> silent, this whole step is optional

  process.stdout.write('\n');
  const { pending, hubSessionExpired, succeeded } = await declareAll(chosen, { accessToken: session.accessToken, hubAccessToken }, declareEndpoint, c);
  if (!hubSessionExpired) {
    printProfileBoost(succeeded, c);
    return;
  }

  process.stdout.write(`\n  ${c.addSkillsHubSessionExpired}\n`);
  const relogged = await offerRelogin({ ask, c, runLogin });
  if (!relogged) return;
  process.stdout.write(`  ${c.addSkillsRelaunchAfterRelogin}\n\n`);
  // Same fix as above — no spinner around a task that prints its own lines.
  const retried = await declareAll(pending, { accessToken: relogged.accessToken, hubAccessToken: relogged.hubAccessToken }, declareEndpoint, c);
  printProfileBoost(succeeded + retried.succeeded, c);
}

// Step 3 — Description.
async function resolveDescription({ ask, catalog, c, stdinIsTTY, root, title, technologies, accessToken, preAccepted = false }) {
  const draftEndpoint = getPortfolioDraftDescriptionEndpoint();
  if (!draftEndpoint) return askFreeText(ask, c.portfolioDescriptionFreeTextPrompt);

  const acceptance = await confirmDisclaimerAcceptance({
    ask, catalog, stdinIsTTY, preAccepted, text: c.portfolioDescriptionConsentDisclaimer,
  });
  if (!acceptance.accepted) return askFreeText(ask, c.portfolioDescriptionFreeTextPrompt);

  const draft = await withSpinner(c.portfolioDescriptionDraftingLabel, () => requestDraftDescription(
    { name: title, technologies, readme: readReadme(root), packageDescription: readPackageDescription(root), accessToken },
    { endpoint: draftEndpoint },
  ));
  if (!draft.ok || !draft.description) return askFreeText(ask, c.portfolioDescriptionFreeTextPrompt);

  process.stdout.write(`\n  ${styleQuestion(c.portfolioDescriptionDraftLabel)}\n  ${draft.description}\n`);
  return askWithDefault(ask, c.portfolioDescriptionEditPrompt, draft.description);
}

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

// The whole route.
async function runAddPortfolio({
  ask, catalog, root, session, stdinIsTTY, input, output, preAccepted = false, deps = {},
} = {}) {
  const c = catalog.start;
  const runLogin = deps.runLogin;

  const listEndpoint = getPortfoliosListEndpoint();
  const declareEndpoint = getPortfoliosDeclareEndpoint();
  if (!listEndpoint || !declareEndpoint) {
    process.stderr.write(`\n  ${c.portfolioErrorNoEndpoint}\n\n`);
    return;
  }

  const hubAccessToken = session.hubAccessToken;
  if (!hubAccessToken) {
    process.stderr.write(`\n  ${c.portfolioNoHubToken}\n\n`);
    return;
  }

  const listed = await withSpinner(
    c.portfolioDedupCheckingLabel,
    () => requestListPortfolios({ accessToken: session.accessToken, hubAccessToken }, { endpoint: listEndpoint }),
  );
  const existingNames = listed.ok ? listed.portfolios.map((p) => p.name.toLowerCase()) : null;
  if (!listed.ok) process.stdout.write(`\n  ${c.portfolioDedupCheckFailed(reasonCopy(listed.reason, c))}\n`);

  const absRoot = path.resolve(root);
  const defaultTitle = path.basename(absRoot) || 'project';

  process.stdout.write(`\n  ${c.portfolioIntro}\n`);

  // (1) Title.
  const title = await askWithDefault(ask, c.portfolioTitlePrompt(defaultTitle), defaultTitle);
  if (existingNames && existingNames.includes(title.toLowerCase())) {
    process.stdout.write(`\n  ${c.portfolioDuplicateName(title)}\n\n`);
    return;
  }

  // (2) Type — obligatorio.
  const type = await chooseType({ ask, c, input, output });
  if (!type) {
    process.stdout.write(`\n  ${c.portfolioCancelled}\n\n`);
    return;
  }

  // (3) Description.
  const technologies = detectTechnologies(absRoot);
  const description = await resolveDescription({
    ask, catalog, c, stdinIsTTY, root: absRoot, title, technologies, accessToken: session.accessToken, preAccepted,
  });

  // (4) URL.
  const detectedUrl = getRemoteUrl(absRoot);
  const url = await askWithDefault(ask, c.portfolioUrlPrompt(detectedUrl), detectedUrl || '');

  // (5) Skills.
  const chosenSkills = await resolvePortfolioSkills({
    ask, stdinIsTTY, technologies, c, input, output, accessToken: session.accessToken,
  });

  // (6) Client — optional.
  const clientName = await askFreeText(ask, c.portfolioClientPrompt);
  const clientDomain = normalizeDomain(await askFreeText(ask, c.portfolioClientWebsitePrompt));

  // Auto: dates from git history.
  const { startDate, endDate } = getCommitDateRange(absRoot);

  const payload = {
    name: title,
    type,
    skillIds: chosenSkills.map((s) => s.skillId),
    description,
    url,
    clientName,
    clientDomain,
    startDate,
    endDate,
  };

  const declared = await withSpinner(
    c.portfolioDeclaring,
    () => requestDeclarePortfolio({ ...payload, accessToken: session.accessToken, hubAccessToken }, { endpoint: declareEndpoint }),
  );

  if (declared.ok) {
    process.stdout.write(`\n  ${styleSuccess(c.portfolioDeclaredSuccess(title))}\n\n`);
    // OPT-IN (dueño, 2026-08-12): offer the REST of the detected skills for the Talent's PROFILE, now that the portfolio itself (and whatever skillIds it carried) is safely declared.
    await offerAddableSkillsForProfile({ ask, catalog, c, technologies, session, stdinIsTTY, input, output, runLogin });
    return;
  }

  if (declared.reason !== 'hub-session-expired') {
    process.stdout.write(`\n  ${c.portfolioDeclareFailed(reasonCopy(declared.reason, c))}\n\n`);
    return;
  }

  process.stdout.write(`\n  ${c.portfolioHubSessionExpired}\n`);
  const relogged = await offerRelogin({ ask, c, runLogin });
  if (!relogged) return;
  process.stdout.write(`  ${c.portfolioRelaunchAfterRelogin}\n`);
  const retried = await withSpinner(
    c.portfolioDeclaring,
    () => requestDeclarePortfolio(
      { ...payload, accessToken: relogged.accessToken, hubAccessToken: relogged.hubAccessToken },
      { endpoint: declareEndpoint },
    ),
  );
  if (retried.ok) {
    process.stdout.write(`\n  ${styleSuccess(c.portfolioDeclaredSuccess(title))}\n\n`);
    await offerAddableSkillsForProfile({
      ask, catalog, c, technologies, session: relogged, stdinIsTTY, input, output, runLogin,
    });
  } else {
    process.stdout.write(`\n  ${c.portfolioDeclareFailed(reasonCopy(retried.reason, c))}\n\n`);
  }
}

module.exports = {
  runAddPortfolio,
  readPackageDescription,
  readReadme,
  askWithDefault,
  chooseType,
  typeOptions,
  normalizeDomain,
  offerAddableSkillsForProfile,
};
