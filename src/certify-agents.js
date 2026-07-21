'use strict';

/*
 * `certify agents` — interactive, LLM-in-the-loop agent certification
 * (skill-code-certification). Orchestrates the three stateless server steps
 * (categories → followups → verdict), asking the talent to choose at each turn,
 * then prints a single-agent terminal report and persists the level for the HTML
 * report. Re-run loop over the agents not yet certified this session.
 *
 * Zero-dep. Reads through the SHARED `ask` (REPL nested stdin) when injected;
 * standalone it owns its own reader.
 */

const { parseCertifyArgs } = require('./certify-args');
const { detectReportLang, getCatalog } = require('./i18n');
const {
  getAgentCertificationCategoriesEndpoint,
  getAgentCertificationFollowupsEndpoint,
  getAgentCertificationVerdictEndpoint,
  loadSuperadminSession,
} = require('./config');
const { parseAgentOrgChart, parseAgentDefinitions } = require('./agent-org-chart');
const { getConsentStatus, isValidEmail, normalizeEmail } = require('./share');
const { createStdinAsk } = require('./stdin-ask');
const { requestCategories, requestFollowups, requestVerdict } = require('./agent-certification-client');
const { renderAgentCertification } = require('./render-certify-agents');
const { persistAgentCertification } = require('./report-store');

const YES = /^(y|yes|s|si|sí)$/i;
const CLI_VERSION = require('../package.json').version || null;

// Merge the deterministic org chart (name/tools/model/parent) with the parsed
// definitions (name + full definition body) into the shape the flow needs.
function collectAgents(root) {
  const structural = parseAgentOrgChart(root) || [];
  const defs = new Map((parseAgentDefinitions(root) || []).map((d) => [d.name, d.definition]));
  return structural.map((a) => ({
    name: a.name,
    definition: defs.get(a.name) || '',
    tools: Array.isArray(a.tools) ? a.tools : [],
    model: a.model || null,
    parent: a.parent || null,
  }));
}

async function askChoice(ask, promptText, count) {
  const raw = (await ask(promptText)).trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > count) return null;
  return n - 1; // 0-based
}

async function resolveEmail(opts, ask, stdinIsTTY, catalog) {
  if (opts.email && isValidEmail(opts.email)) return normalizeEmail(opts.email);
  const stored = getConsentStatus().email;
  if (stored && isValidEmail(stored)) return normalizeEmail(stored);
  if (!stdinIsTTY) return null;
  const raw = (await ask(`  ${catalog.certify.emailPrompt || 'Email: '}`)).trim();
  return isValidEmail(raw) ? normalizeEmail(raw) : null;
}

async function runCertifyAgents(argv = [], { ask: injectedAsk = null } = {}) {
  const opts = parseCertifyArgs(argv);
  const lang = opts.lang || detectReportLang();
  const catalog = getCatalog(lang);
  const ca = catalog.certifyAgents;
  const out = (s) => process.stdout.write(s);

  const categoriesEndpoint = getAgentCertificationCategoriesEndpoint();
  const followupsEndpoint = getAgentCertificationFollowupsEndpoint();
  const verdictEndpoint = getAgentCertificationVerdictEndpoint();
  if (!categoriesEndpoint || !verdictEndpoint) {
    process.stderr.write(`\n  ${catalog.certify.errorNoEndpoint}\n\n`);
    process.exitCode = 1;
    return;
  }

  const root = opts.root || process.cwd();
  const agents = collectAgents(root);
  if (agents.length === 0) {
    out(`\n  ${ca.noAgents}\n\n`);
    return;
  }

  const stdinIsTTY = !!process.stdin.isTTY;
  const ask = injectedAsk || createStdinAsk();
  const localeArg = lang === 'es' || lang === 'en' ? lang : null;
  const superadmin = loadSuperadminSession();

  try {
    out(`\n  ${ca.intro}\n`);

    // Egress disclaimer (definition + answers). Explicit acceptance.
    const accepted = YES.test((await ask(`  ${ca.disclaimer} `)).trim());
    if (!accepted) {
      out(`\n  ${ca.disclaimerDeclined}\n\n`);
      return;
    }

    const email = await resolveEmail(opts, ask, stdinIsTTY, catalog);
    if (!email) {
      process.stderr.write(`\n  ${catalog.certify.emailNeeded}\n\n`);
      process.exitCode = 1;
      return;
    }

    const evaluated = new Set();
    // Interactive loop over agents not yet certified this session.
    for (;;) {
      const remaining = agents.filter((a) => !evaluated.has(a.name));
      if (remaining.length === 0) {
        out(`\n  ${ca.allEvaluated}\n`);
        break;
      }

      out(`\n  ${ca.chooseAgentHeading}\n`);
      remaining.forEach((a, i) => out(`    ${i + 1}) ${a.name}\n`));
      const agentIdx = await askChoice(ask, `  ${ca.choosePrompt(remaining.length)}`, remaining.length);
      if (agentIdx === null) break;
      const agent = remaining[agentIdx];

      // Step 1: categories.
      out(`\n  ${ca.resolvingCategories}\n`);
      const cat = await requestCategories(agent, { endpoint: categoriesEndpoint, locale: localeArg });
      if (!cat.ok || cat.candidates.length === 0) {
        out(`  ${ca.categoriesUnavailable}\n`);
        evaluated.add(agent.name);
        if (!(await askAgain(ask, ca))) break;
        continue;
      }
      out(`\n  ${ca.chooseCategoryHeading}\n`);
      cat.candidates.forEach((c, i) => {
        const catLabel = c.category && catalog.classification.categories[c.category]
          ? catalog.classification.categories[c.category]
          : c.category;
        out(`    ${i + 1}) ${c.role || c.catalogId}${catLabel ? ` — ${catLabel}` : ''}\n`);
      });
      const catIdx = await askChoice(ask, `  ${ca.choosePrompt(cat.candidates.length)}`, cat.candidates.length);
      if (catIdx === null) break;
      const chosen = cat.candidates[catIdx];

      // Step qualification: two fixed questions.
      const achieve = (await ask(`\n  ${ca.qAchieve}\n  > `)).trim();
      const decisions = (await ask(`  ${ca.qDecisions}\n  > `)).trim();
      const qualification = { achieve, decisions };

      // Step 2: follow-ups.
      out(`\n  ${ca.generatingFollowups}\n`);
      const fu = await requestFollowups(agent, chosen.catalogId, qualification, {
        endpoint: followupsEndpoint,
        locale: localeArg,
      });
      const followups = [];
      const questions = fu.ok ? fu.questions : [];
      if (questions.length) out(`\n  ${ca.followupsHeading}\n`);
      for (const question of questions) {
        const answer = (await ask(`  ${question}\n  > `)).trim();
        followups.push({ question, answer });
      }

      // Step 3: verdict (gated + persisted server-side).
      out(`\n  ${ca.certifying}\n`);
      const v = await requestVerdict(
        {
          email,
          agent,
          chosenCategoryId: chosen.catalogId,
          qualification,
          followups,
          superadminToken: superadmin ? superadmin.token : null,
        },
        { endpoint: verdictEndpoint, locale: localeArg },
      );
      if (!v.ok) {
        if (v.reason === 'http-403') out(`\n  ${ca.gateNotRegistered}\n  ${ca.gateNotVerified}\n\n`);
        else out(`\n  ${ca.error(v.reason)}\n\n`);
        evaluated.add(agent.name);
        if (!(await askAgain(ask, ca))) break;
        continue;
      }

      // Report (terminal) + persist the level for the HTML report.
      out('\n' + renderAgentCertification(v.verdict, catalog) + '\n');
      try {
        persistAgentCertification({
          root,
          agentName: v.verdict.agentName,
          level: v.verdict.level,
          category: v.verdict.category,
          role: v.verdict.role,
        });
      } catch {
        // Never break the run over a failed state write.
      }
      out(`  ${ca.savedHint}\n`);

      evaluated.add(agent.name);
      if (!(await askAgain(ask, ca))) break;
    }
  } finally {
    if (!injectedAsk) ask.close();
  }
}

async function askAgain(ask, ca) {
  return YES.test((await ask(`\n  ${ca.rerunPrompt} `)).trim());
}

module.exports = { runCertifyAgents, collectAgents, CLI_VERSION };
