'use strict';

/*
 * `certify agents` — interactive, LLM-in-the-loop agent certification
 * (skill-code-certification). Flow: pick ONE agent (dynamic selector, like
 * `certify skills`) → two fixed qualification questions → model follow-ups →
 * verdict. The verdict prints a single-agent terminal report and persists the
 * level for the HTML report. Re-run loop over the agents not yet certified.
 *
 * The category is NO LONGER asked/suggested (the old `/categories` LLM step was
 * removed — it was the live failure point). The verdict endpoint derives the
 * category DETERMINISTICALLY server-side (catalog matcher); if it can't match,
 * the report shows "no category" cleanly.
 *
 * Zero-dep. Reads through the SHARED `ask` (REPL nested stdin) when injected;
 * standalone it owns its own reader.
 */

const { parseCertifyArgs } = require('./certify-args');
const { detectReportLang, getCatalog } = require('./i18n');
const {
  getAgentCertificationFollowupsEndpoint,
  getAgentCertificationVerdictEndpoint,
  loadSuperadminSession,
} = require('./config');
const { parseAgentOrgChart, parseAgentDefinitions } = require('./agent-org-chart');
const { getConsentStatus, isValidEmail, normalizeEmail } = require('./share');
const { createStdinAsk } = require('./stdin-ask');
const { runInteractiveMultiSelect } = require('./interactive-select');
const { requestFollowups, requestVerdict } = require('./agent-certification-client');
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

async function askNumberedChoice(ask, promptText, count) {
  const raw = (await ask(promptText)).trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > count) return null;
  return n - 1; // 0-based
}

// Picks ONE agent. Uses the SAME dynamic selector as `certify skills`
// (interactive-select) in single-select mode when stdin can be released for raw
// mode (REPL shared reader exposes suspend/resume); falls back to a numbered
// line prompt otherwise (non-TTY / standalone reader), so piped runs still work.
async function chooseAgent(ask, stdinIsTTY, remaining, ca, out) {
  if (stdinIsTTY && typeof ask.suspend === 'function') {
    ask.suspend();
    const picked = await runInteractiveMultiSelect({
      items: remaining,
      labelFor: (a) => a.name,
      header: ca.chooseAgentHeading,
      hint: ca.selectHint,
      single: true,
    });
    ask.resume();
    return picked && picked.length ? picked[0] : null;
  }
  out(`\n  ${ca.chooseAgentHeading}\n`);
  remaining.forEach((a, i) => out(`    ${i + 1}) ${a.name}\n`));
  const idx = await askNumberedChoice(ask, `  ${ca.choosePrompt(remaining.length)}`, remaining.length);
  return idx === null ? null : remaining[idx];
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

  const followupsEndpoint = getAgentCertificationFollowupsEndpoint();
  const verdictEndpoint = getAgentCertificationVerdictEndpoint();
  // The verdict is the essential, gated call; without it there's no certification.
  if (!verdictEndpoint) {
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

      const agent = await chooseAgent(ask, stdinIsTTY, remaining, ca, out);
      if (!agent) break;

      // Two fixed qualification questions.
      const achieve = (await ask(`\n  ${ca.qAchieve}\n  > `)).trim();
      const decisions = (await ask(`  ${ca.qDecisions}\n  > `)).trim();
      const qualification = { achieve, decisions };

      // Follow-ups (model-generated). Degrades to none if the endpoint is unset.
      out(`\n  ${ca.generatingFollowups}\n`);
      const fu = await requestFollowups(agent, qualification, {
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

      // Verdict (gated + persisted server-side; category derived server-side).
      out(`\n  ${ca.certifying}\n`);
      const v = await requestVerdict(
        {
          email,
          agent,
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
