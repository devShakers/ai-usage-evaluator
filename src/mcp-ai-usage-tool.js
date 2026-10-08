'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { isRefusedWalkRoot } = require('./scan-exclusions');
const { askChoice } = require('./mcp-choice');

function isExistingDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function defaultCwdIsRepo(cwd) {
  try {
    execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

const AI_USAGE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    consent: {
      type: 'object',
      description:
        "The talent's explicit answer to the AI-usage question, asked right after showing both disclaimers verbatim. Nothing is scanned without granted:true. A yes to anything else is not this answer.",
      properties: {
        granted: { type: 'boolean', description: 'true ONLY after the talent explicitly said yes to the AI-usage question; false when they said no. Omit it to get the disclaimers and the question to ask.' },
        email: { type: 'string', description: 'The talent email the report is attributed to. Required when granted is true.' },
      },
      required: ['granted'],
    },
    disclaimersShown: {
      type: 'boolean',
      description: 'true only after you showed the talent both AI-usage disclaimers word for word, right before this call. Without consent, it then asks the AI-usage question in a dialog when the client has one.',
    },
    repoScope: {
      type: 'object',
      description: 'Which repositories feed the evaluation. Defaults to the current repository only.',
      properties: {
        mode: {
          type: 'string',
          enum: ['current', 'all', 'list'],
          description: "'current' = only the repo at root; 'all' = machine-wide session signals; 'list' = the repos named in `repos`.",
        },
        repos: {
          type: 'array',
          items: { type: 'string' },
          description: "Repo names or paths, used only when mode is 'list'.",
        },
      },
    },
    root: {
      type: 'string',
      description: 'Absolute path to the repository to evaluate. Defaults to the server working directory.',
    },
    lang: { type: 'string', enum: ['es', 'en'], description: 'Report language.' },
  },
};

function buildArgv({ root, repoScope, lang }) {
  const argv = ['--json', '--no-save', '--no-ai'];
  if (root) argv.push('--root', root);
  const mode = repoScope && repoScope.mode;
  if (mode === 'all') {
    argv.push('--all-repos');
  } else if (mode === 'list' && Array.isArray(repoScope.repos) && repoScope.repos.length > 0) {
    argv.push('--repos', repoScope.repos.join(','));
  }
  if (lang === 'es' || lang === 'en') argv.push('--lang', lang);
  return argv;
}

function makeAiUsageTool(deps = {}) {
  const {
    scanUsage = (argv) => require('../bin/ai-usage').scanUsage(argv),
    autoShare = require('./share').autoShare,
    recordConsent = require('./share').recordConsent,
    isValidEmail = require('./share').isValidEmail,
    persistFootprint = require('./report-store').persistFootprint,
    cwdIsRepo = defaultCwdIsRepo,
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
    getUsageDiscoveredInventoryEndpoint = require('./config').getUsageDiscoveredInventoryEndpoint,
    requestDiscoveredInventory = require('./inventory-client').requestDiscoveredInventory,
    pollClassifiedInventory = require('./mcp-ai-usage-result-tool').pollClassifiedInventory,
    tierLadder = require('./tier-engine').tierLadder,
    inlineWaitMs = 35000,
    // "My work with AI" preview, from the same hub endpoint the front paints.
    resolveAiProfilePreview = require('./ai-profile-preview').resolveAiProfilePreview,
    ensureFreshSession = require('./session-refresh').ensureFreshSession,
    getAiProfileEndpoint = require('./config').getAiProfileEndpoint,
    // Plain-text render of the full report (terminal sections + matrix/vision/howIWork), shared with the CLI (no ANSI).
    renderFullReportText = require('./render-report-text').renderFullReportText,
    detectFlowLang = require('./i18n').detectFlowLang,
    aiFluencyWaitMs = 30000,
    signupPhase = () => require('./mcp-signup-tools').signupPhase(),
    usageDisclaimers = (lang) => require('./onboarding-flow').usageDisclaimers(lang),
    signupCopy = require('./signup-copy').signupCopy,
    signupLanguage = require('./signup-language').signupLanguage,
  } = deps;

  // The sign-up's one scan: started on the talent's yes once the account exists, uploaded in the background.
  let job = null;
  // The talent's answer in the consent dialog, so a later call cannot contradict it.
  let dialogConsent = null;

  function startSignupScan(argv, root) {
    if (job) return job;
    job = { state: 'scanning', send: null, uploading: null };
    // performScan is synchronous: start it after this answer has gone out.
    job.scan = new Promise((resolve) => { setImmediate(resolve); }).then(() => scanUsage(argv)).then((scan) => {
      try { persistFootprint({ root, report: scan.report, maturity: scan.maturity }); } catch { /* local copy is best-effort */ }
      return scan;
    });
    job.scan.catch(() => { job.state = 'failed'; });
    job.root = root;
    return job;
  }

  function uploadSignupScan() {
    if (!job) return Promise.resolve(null);
    if (job.uploading) return job.uploading;
    const current = job;
    current.uploading = current.scan.then(async (scan) => {
      const session = loadAuthSession();
      if (sessionStatus(session) !== 'active' || !session || !isValidEmail(session.email)) {
        current.uploading = null;
        return { ok: false, skipped: true, reason: 'no-session' };
      }
      current.state = 'uploading';
      // Nobody awaits this promise: a local write error must end as a failed send, never as an
      // unhandled rejection that takes the MCP process down.
      let send;
      try {
        recordConsent('granted', session.email, { verified: true });
        send = await autoShare(scan.report, scan.maturity, { root: current.root, bypassThrottle: true });
      } catch (error) {
        send = { ok: false, reason: 'upload-failed', message: error && error.message ? error.message : String(error) };
      }
      current.state = send && send.ok ? 'sent' : 'failed';
      current.send = send;
      return send;
    }, () => ({ ok: false, skipped: true, reason: 'scan-failed' }));
    return current.uploading;
  }
  function consentRequired(lang, ctx) {
    const c = signupCopy(lang);
    const disclaimers = Object.values(usageDisclaimers(lang));
    if (ctx && ctx.elicitation) {
      return {
        ok: false,
        reason: 'consent-required',
        relayVerbatim: disclaimers,
        message: 'Nothing was scanned. Show the talent each relayVerbatim text word for word, each as its own block, without labels or paraphrase; then call ai_usage again with disclaimersShown:true and no consent: it asks the question in a dialog.',
      };
    }
    return {
      ok: false,
      reason: 'consent-required',
      relayVerbatim: disclaimers,
      question: c.aiUsageQuestion,
      options: [c.aiUsageYes, c.aiUsageSkip],
      message: 'Nothing was scanned. Show the talent each relayVerbatim text word for word, each as its own block, without labels or paraphrase, then `question` with its `options` (your native choice buttons if you have them, otherwise a short numbered list). Then call again with consent.granted:true only after they pick the first option, or consent.granted:false if they skip it.',
    };
  }

  function declined(lang) {
    recordConsent('denied');
    return { ok: false, reason: 'consent-declined', relayVerbatim: signupCopy(lang).aiUsageSkipped, message: 'Nothing was scanned. Show relayVerbatim once, word for word, and carry on with the interview offer.' };
  }

  async function askConsent(lang, ctx) {
    const c = signupCopy(lang);
    const asked = await askChoice(ctx, { question: c.aiUsageQuestion, options: [c.aiUsageYes, c.aiUsageSkip] });
    if (asked.answer === c.aiUsageSkip) {
      dialogConsent = 'denied';
      return declined(lang);
    }
    if (asked.answer === c.aiUsageYes) {
      dialogConsent = 'granted';
      return { ok: true, reason: 'consent-granted', consent: { granted: true }, message: 'The talent said yes in the dialog: do not ask again. Call ai_usage with consent.granted:true (and their email) to run it.' };
    }
    return {
      ok: false,
      reason: 'consent-required',
      ...(asked.dismissed ? { dismissed: asked.dismissed } : {}),
      ...asked.chat,
      message: `Nothing was scanned. The disclaimers are already shown: do not repeat them. ${asked.chat.choiceMessage} Then call again with consent.granted:true only after an explicit yes, or consent.granted:false if they say no.`,
    };
  }

  async function handler(args = {}, ctx = {}) {
    const phase = signupPhase();
    // The sign-up looks at the whole machine: the server rarely runs inside a repository there.
    const repoScope = args.repoScope || (phase === 'account' ? { mode: 'all' } : undefined);
    const mode = (repoScope && repoScope.mode) || 'current';
    const lang = args.lang === 'es' || args.lang === 'en' ? args.lang : detectFlowLang();
    const textLang = signupLanguage(lang);
    if (phase === 'waiting') {
      return { ok: false, reason: 'account-pending', message: 'Nothing was scanned. Ask about AI usage only once signup_status says the account exists.' };
    }
    const consent = args.consent || {};
    if (consent.granted === false) return declined(textLang);
    if (consent.granted === true && dialogConsent === 'denied') {
      return { ok: false, reason: 'consent-declined', message: 'The talent skipped the AI-usage step in the dialog: nothing is scanned. Carry on without it. If they later ask for the scan themselves, call ai_usage without consent to ask them again.' };
    }
    if (consent.granted !== true) {
      if (args.disclaimersShown !== true || !(ctx && ctx.elicitation)) return consentRequired(textLang, ctx);
      const answered = await askConsent(textLang, ctx);
      // In the sign-up a yes in the dialog runs the scan right away, in the background.
      if (!(answered.reason === 'consent-granted' && phase === 'account')) return answered;
    }

    let root;
    if (typeof args.root === 'string' && args.root) {
      if (!isExistingDir(args.root)) {
        return { ok: false, reason: 'invalid-root', message: `root is not an existing directory: ${args.root}` };
      }
      root = args.root;
    } else {
      const cwd = process.cwd();
      if (!isRefusedWalkRoot(cwd) && cwdIsRepo(cwd)) {
        root = cwd;
      } else if (mode === 'all') {
        root = cwd;
      } else {
        return {
          ok: false,
          reason: 'no-repo-root',
          message: 'The Shakers MCP server is running from a non-repository directory, so there is no repository to evaluate. Pass an absolute path to the repository via `root`, or use repoScope.mode "all" for a machine-wide report.',
        };
      }
    }

    const email = typeof consent.email === 'string' ? consent.email.trim() : '';
    const argv = buildArgv({ root, repoScope, lang: args.lang });

    // In the sign-up the scan never holds the conversation: it runs and uploads in the background.
    if (phase === 'account') {
      const current = startSignupScan(argv, root);
      uploadSignupScan();
      return {
        ok: true,
        background: true,
        send: current.send || { ok: false, skipped: true, reason: 'uploading' },
        scope: { mode, root },
        message: 'The analysis runs and uploads in the background; Shakers completes the profile with it in a few minutes. Do not wait for it and do not call ai_usage again: carry on with the interview offer.',
      };
    }

    const verifySession = loadAuthSession();
    const emailVerifiedByLogin =
      sessionStatus(verifySession) === 'active'
      && !!verifySession
      && isValidEmail(verifySession.email);

    if (!isValidEmail(email)) {
      throw new Error('consent.granted is true but consent.email is missing or invalid — ask the talent for their email.');
    }
    if (emailVerifiedByLogin) {
      recordConsent('granted', verifySession.email, { verified: true });
    } else {
      recordConsent('granted', email, { verified: false });
    }

    const canSubmit = emailVerifiedByLogin;
    const submittedEmail = canSubmit ? verifySession.email : null;

    const { report, maturity } = await scanUsage(argv);

    let savedLocally = false;
    try {
      persistFootprint({ root, report, maturity });
      savedLocally = true;
    } catch {
      savedLocally = false;
    }

    const send = canSubmit
      ? await autoShare(report, maturity, { root })
      : { ok: false, skipped: true, reason: 'email-unverified' };
    const submitted = !!(send && send.ok);

    const hasAgents = Array.isArray(report.agents) && report.agents.length > 0;

    let enrichment = submitted && hasAgents ? 'pending' : 'none';
    let enrichedAgents = null;
    if (submitted && hasAgents) {
      const session = loadAuthSession();
      const endpoint = getUsageDiscoveredInventoryEndpoint();
      if (sessionStatus(session) === 'active' && endpoint) {
        const polled = await pollClassifiedInventory({
          accessToken: session.accessToken,
          endpoint,
          requestDiscoveredInventory,
          capMs: inlineWaitMs,
        });
        if (polled.status === 'ready') {
          enrichment = 'ready';
          enrichedAgents = polled.agents;
        }
      }
    }

    // "My work with AI" preview: only after a real submit this run.
    let aiProfile = { status: 'unavailable', preview: null };
    if (submitted) {
      const usageSession = loadAuthSession();
      if (sessionStatus(usageSession) === 'active') {
        aiProfile = await resolveAiProfilePreview(
          {
            session: usageSession,
            endpoint: getAiProfileEndpoint(),
            timeoutMs: aiFluencyWaitMs,
          },
          {
            refreshToken: async () => {
              const fresh = await ensureFreshSession(process.env);
              return fresh ? { accessToken: fresh.accessToken, hubAccessToken: fresh.hubAccessToken } : null;
            },
          },
        );
      }
    }

    const displayAgents = enrichedAgents
      ? enrichedAgents.map((a) => ({ name: a.name, category: a.category, role: a.role }))
      : (report.agents || []).map((a) => ({ name: a.name }));

    // Same full report the CLI terminal prints, as plain markdown (no ANSI), so a chat client shows the talent the same thing.
    const text = renderFullReportText(
      report,
      maturity,
      { status: aiProfile.status, preview: aiProfile.preview },
      { lang },
    );

    let message;
    if (submitted) {
      message =
        enrichment === 'ready'
          ? 'Classification complete — agent categories and descriptions are ready.'
          : enrichment === 'pending'
            ? 'Report submitted. Shakers is classifying the agents server-side (this is normal, not an error) — call ai_usage_result shortly to get their categories and descriptions.'
            : 'Report submitted.';
    } else if (send.reason === 'email-unverified') {
      message = "Not submitted — the talent's email is not verified. Ask them to log in / verify with the Shakers CLI (`shakers login`) first, then run ai_usage again; nothing was sent to Shakers.";
    } else if (send.skipped) {
      message = `Not submitted (${send.reason}). The report was kept on this machine only; nothing was sent to Shakers.`;
    } else {
      message = `Submit failed (${send.reason}). The report was kept on this machine only; retry later.`;
    }

    return {
      report,
      maturity,
      send,
      savedLocally,
      enrichment,
      agents: enrichedAgents,
      // Plain-text "My work with AI" report (no ANSI), same content/layout as the CLI.
      text,
      // "My work with AI" preview: status ready | pending | unavailable.
      aiProfile,
      next: submitted && enrichment === 'pending' ? 'ai_usage_result' : null,
      message,
      display: {
        tier: {
          key: maturity.tierKey,
          name: maturity.tierName,
          setupLevel: maturity.name,
          score: maturity.score,
        },
        // Matrix (3x3) + vision (E) + howIWork (F) + traction; null until projected.
        aiProfile: {
          status: aiProfile.status,
          setup: aiProfile.preview ? aiProfile.preview.matrix.setupCode : null,
          usage: aiProfile.preview ? aiProfile.preview.matrix.usageLevel : null,
          cell: aiProfile.preview ? aiProfile.preview.matrix.cell : null,
          isAiNative: aiProfile.preview ? aiProfile.preview.matrix.isAiNative : false,
          vision: aiProfile.preview ? aiProfile.preview.vision : null,
          howIWork: aiProfile.preview ? aiProfile.preview.howIWork : null,
          traction: aiProfile.preview ? aiProfile.preview.traction : null,
        },
        tierLegend: tierLadder(),
        agents: displayAgents,
      },
      scope: {
        mode,
        root,
      },
      consent: { granted: true, email: canSubmit ? submittedEmail : email },
    };
  }

  return {
    name: 'ai_usage',
    description:
      "Measure how a Shakers talent uses AI in their work: scans this machine and repository for AI-tool usage (subagents, MCP servers, sessions, git activity), scores their AI-maturity tier (T0-T7), and, with the talent's consent, submits the report to Shakers so their profile reflects it. Runs entirely on the talent's own machine. Before any scan, show the talent both AI-usage disclaimers word for word, each as its own block, right before the AI-usage question (call without consent to get those texts and the question); only an explicit yes allows consent.granted:true, and skipping is consent.granted:false. In the sign-up it is the step right after the account exists and before the interview: on yes it runs and uploads in the background, never wait for it. Submission also requires an active, email-verified Shakers session (via `shakers login` / registration OTP): without a verified session the report stays on this machine and nothing is sent — check the `send` field for the outcome. Always fast and deterministic: it runs no LLM on the machine. Agent descriptions and catalog classification are produced by Shakers server-side. This waits briefly (~30s) and, if classification finishes, returns the enriched agents inline; otherwise it returns enrichment:'pending' (normal progress, not an error) and you should call `ai_usage_result` to get them. The `text` field is a ready-to-show plain-text 'My work with AI' report (Markdown, no ANSI) mirroring the CLI terminal — render it verbatim to the talent; the matrix grid is inside a fenced code block, keep it fenced so it stays aligned. Use the `display` block for structured access: show the tier (with the tierLegend explaining T0-T7) and the agent list by NAME and category/role. IDs and codes (agent `code`, skillId, catalogId) are internal handles for the add_* tools only — never show raw IDs or codes to the talent.",
    inputSchema: AI_USAGE_INPUT_SCHEMA,
    handler,
  };
}

module.exports = {
  makeAiUsageTool,
  AI_USAGE_INPUT_SCHEMA,
  buildArgv,
};
