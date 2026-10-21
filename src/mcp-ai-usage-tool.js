'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const { isRefusedWalkRoot } = require('./scan-exclusions');
const { askChoice, chatChoice, queueNotice } = require('./mcp-choice');

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
        "The talent's explicit answer to the AI-usage question this tool asks together with both disclaimers. Nothing is scanned without granted:true. A yes to anything else is not this answer.",
      properties: {
        granted: { type: 'boolean', description: 'true ONLY after the talent explicitly said yes to the AI-usage question; false when they said no. Omit it to get the disclaimers and the question to ask.' },
        email: { type: 'string', description: 'The talent email the report is attributed to. Required when granted is true.' },
      },
      required: ['granted'],
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

const VERBATIM = 'Print relayVerbatim word for word now, as its own block, with nothing of your own added to it.';

const UPLOAD_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    confirm: {
      type: 'boolean',
      description: 'Chat only: true ONLY when the talent picked the upload option in the review this tool or ai_usage showed them; false when they picked not to upload. Omit it to show the review.',
    },
    exclude: {
      type: 'object',
      description: 'What the talent asked to leave out, with confirm:true. Names exactly as listed in `excludable`.',
      properties: {
        repos: { type: 'array', items: { type: 'string' } },
        agents: { type: 'array', items: { type: 'string' } },
        excerpts: { type: 'boolean', description: 'true = send no text excerpts.' },
      },
    },
    waitSeconds: { type: 'number', description: 'Sign-up only: how long to wait for the background analysis before answering (max 45).' },
  },
};

const MAX_WAIT_MS = 45000;

function makeAiUsageTools(deps = {}) {
  const {
    scanUsage = (argv) => require('./usage-scan').scanUsage(argv),
    autoShare = require('./share').autoShare,
    recordConsent = require('./share').recordConsent,
    sendThrottled = () => require('./share').isThrottled(require('./share').loadConsentState()),
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
    resolveAiProfilePreview = require('./ai-profile-preview').resolveAiProfilePreview,
    ensureFreshSession = require('./session-refresh').ensureFreshSession,
    getAiProfileEndpoint = require('./config').getAiProfileEndpoint,
    renderFullReportText = require('./render-report-text').renderFullReportText,
    detectFlowLang = require('./i18n').detectFlowLang,
    aiFluencyWaitMs = 30000,
    signupPhase = () => require('./mcp-signup-tools').signupPhase(),
    usageDisclaimers = (lang) => require('./onboarding-flow').usageDisclaimers(lang),
    signupCopy = require('./signup-copy').signupCopy,
    reviewCopy = require('./signup-copy').reviewCopy,
    signupLanguage = require('./signup-language').signupLanguage,
    reviewTexts = require('./ai-usage-review'),
  } = deps;

  let job = null;
  // The talent's answer in the consent dialog, so a later call cannot contradict it.
  let dialogConsent = null;
  let pending = null;

  function startSignupScan(argv, root, lang) {
    if (job && job.state !== 'failed') return job;
    job = { state: 'scanning', root, lang };
    // performScan is synchronous: start it after this answer has gone out.
    job.scan = new Promise((resolve) => { setImmediate(resolve); }).then(() => scanUsage(argv)).then((scan) => {
      try { persistFootprint({ root, report: scan.report, maturity: scan.maturity }); } catch { /* local copy is best-effort */ }
      job.state = 'scanned';
      return scan;
    });
    job.scan.catch(() => { job.state = 'failed'; });
    return job;
  }

  function activeSession() {
    const session = loadAuthSession();
    return sessionStatus(session) === 'active' && session && isValidEmail(session.email) ? session : null;
  }

  function openReview({ scan, root, lang, registration }) {
    pending = { scan, root, lang, registration, askedInChat: false, outcome: null };
    return pending;
  }

  function reviewFacts(review) {
    return reviewTexts.uploadFacts({ report: review.scan.report, maturity: review.scan.maturity, repos: review.scan.repos || [] });
  }

  function reviewSchema(c, facts) {
    const properties = { decision: { type: 'string', title: c.question, enum: [c.yes, c.no] } };
    if (facts.conversationExcerpts + facts.commandExcerpts > 0) properties.excerpts = { type: 'boolean', title: c.formExcerpts, default: true };
    if (facts.repos.length > 1) facts.repos.forEach((name, i) => { properties[`repo_${i}`] = { type: 'boolean', title: c.formRepo(name), default: true }; });
    facts.agents.forEach((name, i) => { properties[`agent_${i}`] = { type: 'boolean', title: c.formAgent(name), default: true }; });
    return { type: 'object', properties, required: ['decision'] };
  }

  function exclusionsFromForm(review, facts, content) {
    const repos = review.scan.repos || [];
    return {
      repos: repos.filter((_, i) => content[`repo_${i}`] === false),
      agents: facts.agents.filter((_, i) => content[`agent_${i}`] === false),
      excerpts: content.excerpts !== false,
    };
  }

  function exclusionsFromChat(review, exclude) {
    const e = exclude && typeof exclude === 'object' ? exclude : {};
    const names = new Set((Array.isArray(e.repos) ? e.repos : []).map(String));
    const known = review.scan.repos || [];
    const repos = known.filter((r) => names.has(r) || names.has(reviewTexts.repoName(r)));
    const agentNames = reviewFacts(review).agents;
    const agents = Array.isArray(e.agents) ? e.agents.map(String) : [];
    const unknown = [
      ...[...names].filter((n) => !known.some((r) => r === n || reviewTexts.repoName(r) === n)),
      ...agents.filter((a) => !agentNames.includes(a)),
    ];
    return { repos, agents, excerpts: e.excerpts !== true, unknown };
  }

  function declineUpload(review) {
    const c = reviewCopy(review.lang);
    review.outcome = { ok: false, reason: 'upload-declined', relayVerbatim: c.declined, message: `Nothing was sent. ${VERBATIM} Then carry on.` };
    return review.outcome;
  }

  async function presentReview(review, ctx) {
    const c = reviewCopy(review.lang);
    if (!review.registration && sendThrottled()) {
      return { ok: false, reason: 'throttled', relayVerbatim: c.throttled, message: `Nothing was sent. ${VERBATIM}` };
    }
    const facts = reviewFacts(review);
    const texts = [reviewTexts.summaryText(review.lang, facts), reviewTexts.explanationText(review.lang)];
    if (ctx && ctx.elicitation && typeof ctx.elicit === 'function') {
      const reply = await ctx.elicit({ message: [...texts, c.question].join('\n\n'), requestedSchema: reviewSchema(c, facts) });
      const content = reply && reply.action === 'accept' && reply.content ? reply.content : null;
      if (content && content.decision === c.yes) return upload(review, exclusionsFromForm(review, facts, content));
      if ((content && content.decision === c.no) || (reply && reply.action === 'decline')) return declineUpload(review);
    }
    review.askedInChat = true;
    const chat = chatChoice(c.question, [c.yes, c.no], [...texts, c.excludeHint]);
    return {
      ok: false,
      reason: 'upload-approval-required',
      say: chat.say,
      options: chat.options,
      excludable: { repos: facts.repos, agents: facts.agents, excerpts: facts.conversationExcerpts + facts.commandExcerpts > 0 },
      message: `Nothing has been sent. ${chat.choiceMessage} Then call ai_usage_upload with confirm:true only if they pick "${c.yes}" (adding exclude with the repos and agents they want left out, exactly as listed in excludable, and excerpts:true if they want no text excerpts), or confirm:false if they pick "${c.no}". Only the talent decides: never answer for them.`,
    };
  }

  async function upload(review, exclude) {
    const c = reviewCopy(review.lang);
    const session = activeSession();
    if (!session) {
      return { ok: false, reason: 'no-session', message: 'Nothing was sent: there is no signed-in Shakers session. Ask the talent to sign in (social_signin_start or `shakers login`), then call ai_usage_upload again.' };
    }
    let scan = review.scan;
    if (exclude.repos.length > 0) {
      const kept = (scan.repos || []).filter((r) => !exclude.repos.includes(r));
      if (kept.length === 0) {
        review.outcome = { ok: false, reason: 'nothing-left', relayVerbatim: c.nothingLeft, message: `Nothing was sent. ${VERBATIM}` };
        return review.outcome;
      }
      const rescanned = await scanUsage(buildArgv({ root: review.root, repoScope: { mode: 'list', repos: kept }, lang: review.lang }));
      if (!(rescanned.repos || []).every((r) => kept.includes(r))) {
        return { ok: false, reason: 'scope-mismatch', relayVerbatim: c.uploadFailed, message: `Nothing was sent: the repositories left out could not be separated. ${VERBATIM}` };
      }
      scan = rescanned;
    }
    const trimmed = reviewTexts.withoutExcluded(scan.report, { agents: exclude.agents, excerpts: exclude.excerpts });
    let send;
    try {
      recordConsent('granted', session.email, { verified: true });
      send = await autoShare(trimmed.report, trimmed.maturity, { root: review.root, bypassThrottle: review.registration });
    } catch (error) {
      send = { ok: false, reason: 'upload-failed', message: error && error.message ? error.message : String(error) };
    }
    if (!send || !send.ok) {
      return { ok: false, reason: (send && send.reason) || 'upload-failed', send, relayVerbatim: c.uploadFailed, message: `Nothing was saved in Shakers. ${VERBATIM}` };
    }
    const sent = reviewTexts.summaryText(review.lang, reviewTexts.uploadFacts({ report: trimmed.report, maturity: trimmed.maturity, repos: scan.repos || [] }), { sent: true });
    const excluded = exclude.repos.length > 0 || exclude.agents.length > 0 || !exclude.excerpts;
    const confirmation = excluded ? [c.uploaded, sent] : [c.uploaded];
    review.outcome = { ok: true, uploaded: true, send, sentReport: trimmed, sent };
    if (review.registration) {
      review.outcome.relayVerbatim = [...confirmation, c.afterwards].join('\n\n');
      review.outcome.next = 'ai_usage_result';
      review.outcome.message = `${VERBATIM} Then carry on with the sign-up; do not wait for the result.`;
      return review.outcome;
    }
    return Object.assign(review.outcome, await afterUpload(review, trimmed, confirmation));
  }

  async function afterUpload(review, { report, maturity }, confirmation) {
    const c = reviewCopy(review.lang);
    const hasAgents = Array.isArray(report.agents) && report.agents.length > 0;
    let enrichment = hasAgents ? 'pending' : 'none';
    let enrichedAgents = null;
    if (hasAgents) {
      const session = loadAuthSession();
      const endpoint = getUsageDiscoveredInventoryEndpoint();
      if (sessionStatus(session) === 'active' && endpoint) {
        const polled = await pollClassifiedInventory({ accessToken: session.accessToken, endpoint, requestDiscoveredInventory, capMs: inlineWaitMs });
        if (polled.status === 'ready') {
          enrichment = 'ready';
          enrichedAgents = polled.agents;
        }
      }
    }
    let aiProfile = { status: 'unavailable', preview: null };
    const usageSession = loadAuthSession();
    if (sessionStatus(usageSession) === 'active') {
      aiProfile = await resolveAiProfilePreview(
        { session: usageSession, endpoint: getAiProfileEndpoint(), timeoutMs: aiFluencyWaitMs },
        {
          refreshToken: async () => {
            const fresh = await ensureFreshSession(process.env);
            return fresh ? { accessToken: fresh.accessToken, hubAccessToken: fresh.hubAccessToken } : null;
          },
        },
      );
    }
    const displayAgents = enrichedAgents
      ? enrichedAgents.map((a) => ({ name: a.name, category: a.category, role: a.role }))
      : (report.agents || []).map((a) => ({ name: a.name }));
    const text = renderFullReportText(report, maturity, { status: aiProfile.status, preview: aiProfile.preview }, { lang: review.lang });
    return {
      report,
      maturity,
      enrichment,
      agents: enrichedAgents,
      text,
      aiProfile,
      relayVerbatim: [...confirmation, reviewTexts.resultText(review.lang, aiProfile.status === 'ready' ? aiProfile.preview : null)].join('\n\n'),
      next: enrichment === 'pending' || aiProfile.status !== 'ready' ? 'ai_usage_result' : null,
      message: `Uploaded. ${VERBATIM} Then show \`text\`, the full report, verbatim.${enrichment === 'pending' || aiProfile.status !== 'ready' ? ' Shakers is still evaluating (normal, not an error): call ai_usage_result in a few minutes for the result and its explanation.' : ''}`,
      display: {
        tier: { key: maturity.tierKey, name: maturity.tierName, setupLevel: maturity.name, score: maturity.score },
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
    };
  }

  function declined(lang) {
    recordConsent('denied');
    if (signupPhase() === 'account') {
      queueNotice(signupCopy(lang).aiUsageSkipped);
      return { ok: false, reason: 'consent-declined', message: 'Nothing was scanned. Say nothing about it: its fixed line for the talent comes with the next question. Carry on with the interview offer.' };
    }
    return { ok: false, reason: 'consent-declined', relayVerbatim: signupCopy(lang).aiUsageSkipped, message: 'Nothing was scanned. Show relayVerbatim once, word for word.' };
  }

  async function askConsent(lang, ctx) {
    const c = signupCopy(lang);
    const texts = Object.values(usageDisclaimers(lang));
    const asked = ctx && ctx.elicitation
      ? await askChoice(ctx, { texts, question: c.aiUsageQuestion, options: [c.aiUsageYes, c.aiUsageSkip] })
      : { chat: chatChoice(c.aiUsageQuestion, [c.aiUsageYes, c.aiUsageSkip], texts) };
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
      message: `Nothing was scanned. ${asked.chat.choiceMessage} Then call ai_usage again with consent.granted:true only after they pick the first option, or consent.granted:false if they skip it.`,
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

    if (phase === 'account') {
      if (pending && pending.registration && pending.outcome && !pending.outcome.uploaded) pending = null;
      startSignupScan(argv, root, textLang);
      return {
        ok: true,
        background: true,
        scope: { mode, root },
        message: 'The analysis runs in the background and nothing is sent until the talent approves it. Say nothing about it. Next call ai_usage_upload (waitSeconds 30): it shows the talent what would be sent and asks. If it answers scan-running, carry on with the interview offer and call ai_usage_upload again right after the interview step.',
      };
    }

    const session = activeSession();
    if (!isValidEmail(email)) {
      throw new Error('consent.granted is true but consent.email is missing or invalid — ask the talent for their email.');
    }
    if (session) {
      recordConsent('granted', session.email, { verified: true });
    } else {
      recordConsent('granted', email, { verified: false });
    }

    const scan = await scanUsage(argv);
    let savedLocally = false;
    try {
      persistFootprint({ root, report: scan.report, maturity: scan.maturity });
      savedLocally = true;
    } catch {
      savedLocally = false;
    }

    if (!session) {
      const text = renderFullReportText(scan.report, scan.maturity, { status: 'unavailable', preview: null }, { lang });
      return {
        ok: true,
        uploaded: false,
        send: { ok: false, skipped: true, reason: 'email-unverified' },
        savedLocally,
        text,
        scope: { mode, root },
        message: "Not sent: the talent is not signed in to Shakers with a verified email. Show `text` verbatim; to put it on their profile they sign in (`shakers login` or social_signin_start) and run ai_usage again. Nothing was sent to Shakers.",
      };
    }

    const review = openReview({ scan, root, lang: textLang, registration: false });
    const reviewed = await presentReview(review, ctx);
    return { ...reviewed, savedLocally, scope: { mode, root }, consent: { granted: true, email: session.email } };
  }

  async function waitForSignupScan(waitMs) {
    if (job.state !== 'scanning') return;
    await Promise.race([job.scan.catch(() => null), new Promise((resolve) => { setTimeout(resolve, waitMs).unref(); })]);
  }

  async function uploadHandler(args = {}, ctx = {}) {
    if (!pending && job) {
      const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, Number(args.waitSeconds) || 0) * 1000);
      await waitForSignupScan(waitMs);
      if (job.state === 'scanning') {
        return { ok: false, reason: 'scan-running', message: 'The analysis is still running; nothing has been sent. Say nothing about it: carry on with the interview offer and call ai_usage_upload again right after the interview step, before list_my_roles.' };
      }
      if (job.state === 'failed') {
        return { ok: false, reason: 'scan-failed', message: 'The analysis could not finish; nothing was sent. Say nothing about it and carry on with the sign-up.' };
      }
      openReview({ scan: await job.scan, root: job.root, lang: job.lang, registration: true });
    }
    if (!pending) {
      return { ok: false, reason: 'nothing-to-review', message: 'There is no analysis waiting for approval. Call ai_usage first.' };
    }
    if (pending.outcome) return pending.outcome.uploaded ? { ...pending.outcome, message: 'Already uploaded; it is not sent twice.' } : pending.outcome;
    if (pending.askedInChat && args.confirm === false) return declineUpload(pending);
    if (pending.askedInChat && args.confirm === true) {
      const exclude = exclusionsFromChat(pending, args.exclude);
      if (exclude.unknown.length > 0) {
        const facts = reviewFacts(pending);
        return { ok: false, reason: 'unknown-exclusion', unknown: exclude.unknown, excludable: { repos: facts.repos, agents: facts.agents }, message: `Nothing was sent: ${exclude.unknown.join(', ')} is not in excludable. Ask the talent which of the listed names they meant, then call ai_usage_upload again with those exact names.` };
      }
      return upload(pending, exclude);
    }
    return presentReview(pending, ctx);
  }

  const usage = {
    name: 'ai_usage',
    title: 'Analyse how you work with AI',
    description: 'Asks you first and, only if you say yes, looks at which AI tools you use on this computer and the history of your code projects. Then it shows you exactly what would go to your Shakers profile and uploads it only if you approve it; your code and prompts never leave your computer.',
    guidance:
      "Measure how a Shakers talent uses AI in their work: scans this machine and repository for AI-tool usage (subagents, MCP servers, sessions, git activity) and scores their AI-maturity tier (T0-T7). Runs entirely on the talent's own machine. Before any scan, call it without consent: it asks the AI-usage question with both disclaimers in the same block (a dialog, or `say` to print word for word); only an explicit yes allows consent.granted:true, and skipping is consent.granted:false. The yes only scans: nothing is uploaded until the talent approves the review. Outside the sign-up, with a signed-in, email-verified session, the scan is followed by that review in the same call: a form when the client has one, otherwise `say` (what would be sent, what Shakers does with it, and the question) to print word for word, and then ai_usage_upload with the talent's answer. Without a verified session nothing can be sent and `text` is the report only. In the sign-up it is the step right after the account exists: on yes the scan runs in the background, then ai_usage_upload asks. After an upload, show relayVerbatim and `text` (the 'My work with AI' report, Markdown, no ANSI; keep the matrix grid fenced) verbatim; if next is ai_usage_result, call it in a few minutes. It runs no LLM on the machine. IDs and codes (agent `code`, skillId, catalogId) are internal handles for the add_* tools only — never show them.",
    inputSchema: AI_USAGE_INPUT_SCHEMA,
    handler,
  };

  const uploadTool = {
    name: 'ai_usage_upload',
    title: 'Review and upload your AI analysis',
    description: 'Shows you exactly what your AI analysis would send to your Shakers profile and what Shakers does with it, lets you leave out repositories, agents or text excerpts, and uploads it only if you approve.',
    guidance:
      "The only way an AI-usage analysis reaches Shakers. Call it without confirm: it shows the review (a form the talent fills in when the client has one; otherwise `say` to print word for word, plus `excludable`). In the chat, call it again with confirm:true only when the talent picked the upload option, with exclude for what they asked to leave out, or confirm:false when they picked not to; never decide for them, and confirm counts only after the review was shown in the chat. In the sign-up pass waitSeconds 30: reason scan-running means carry on and call it again after the interview step. On an upload print relayVerbatim word for word. Nothing is sent twice.",
    inputSchema: UPLOAD_INPUT_SCHEMA,
    handler: uploadHandler,
  };

  return { usage, upload: uploadTool };
}

function makeAiUsageTool(deps = {}) {
  return makeAiUsageTools(deps).usage;
}

module.exports = {
  makeAiUsageTool,
  makeAiUsageTools,
  AI_USAGE_INPUT_SCHEMA,
  buildArgv,
};
