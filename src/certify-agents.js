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
const {
  requestFollowups,
  requestVerdict,
  capDefinition,
  MAX_AGENT_CERT_DEFINITION_CHARS,
} = require('./agent-certification-client');
const { renderAgentCertification } = require('./render-certify-agents');
const { persistAgentCertification } = require('./report-store');

const YES = /^(y|yes|s|si|sí)$/i;
const CLI_VERSION = require('../package.json').version || null;

// Branded ANSI for the agent QUESTIONS (the two fixed ones + the model
// follow-ups) so they stand out from the rest of the flow's output. Cyan + bold
// = the same accent the REPL/tier markers use; legible on light and dark.
const C = { cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };
const question = (text) => `${C.cyan}${C.bold}${text}${C.reset}`;

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

  // SUPERADMIN-ONLY testing shortcut (--fast): skip the interactive Q&A with
  // built-in sample answers and go straight to the real verdict. HARD-GATED on a
  // valid superadmin session — a real Talent's `--fast` is ignored and the normal
  // Q&A is asked, so nobody can bypass the questions. Agent selection is untouched.
  const fastMode = !!opts.fast && !!superadmin;

  try {
    out(`\n  ${ca.intro}\n`);
    if (opts.fast && !superadmin) out(`\n  ${ca.fastModeDenied}\n`);

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

      // A rare oversized agent gets its definition capped client-side (matches the
      // backend @MaxLength) so the verdict never 400s on size — tell the user.
      if (capDefinition(agent.definition).truncated) {
        out(`\n  ${ca.definitionTruncated(MAX_AGENT_CERT_DEFINITION_CHARS)}\n`);
      }

      let qualification;
      const followups = [];
      if (fastMode) {
        // Zero-typing: built-in sample answers + auto-answered follow-ups. The
        // follow-ups endpoint still runs (real e2e of that call), we just fill
        // each answer with a generic sample instead of prompting.
        out(`\n  ${ca.fastModeNotice}\n`);
        qualification = { achieve: ca.sampleAchieve, decisions: ca.sampleDecisions };
        out(`\n  ${ca.generatingFollowups}\n`);
        const fu = await requestFollowups(agent, qualification, {
          endpoint: followupsEndpoint,
          locale: localeArg,
        });
        for (const q of fu.ok ? fu.questions : []) {
          followups.push({ question: q, answer: ca.sampleFollowupAnswer });
        }
      } else {
        // Two fixed qualification questions (colored to stand out).
        const achieve = (await ask(`\n  ${question(ca.qAchieve)}\n  > `)).trim();
        const decisions = (await ask(`  ${question(ca.qDecisions)}\n  > `)).trim();
        qualification = { achieve, decisions };

        // Follow-ups (model-generated). Degrades to none if the endpoint is unset.
        out(`\n  ${ca.generatingFollowups}\n`);
        const fu = await requestFollowups(agent, qualification, {
          endpoint: followupsEndpoint,
          locale: localeArg,
        });
        const questions = fu.ok ? fu.questions : [];
        if (questions.length) out(`\n  ${ca.followupsHeading}\n`);
        for (const q of questions) {
          const answer = (await ask(`  ${question(q)}\n  > `)).trim();
          followups.push({ question: q, answer });
        }
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

      // Summary (terminal) + persist the FULL verdict for the HTML report, which
      // is now the full-breakdown surface (evidence, areas, rationale).
      out('\n' + renderAgentCertification(v.verdict, catalog) + '\n');
      try {
        persistAgentCertification({
          root,
          agentName: v.verdict.agentName,
          level: v.verdict.level,
          category: v.verdict.category,
          role: v.verdict.role,
          areas: v.verdict.areas,
          verifiedEvidence: v.verdict.verifiedEvidence,
          unverifiedEvidence: v.verdict.unverifiedEvidence,
          rationale: v.verdict.rationale,
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
