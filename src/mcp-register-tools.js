'use strict';

const { TranscriptBuffer } = require('./interview-transcript');
const { askChoice } = require('./mcp-choice');

const ANSWER_MODES = ['drafted', 'own', 'full'];

const INTERVIEW_START_SCHEMA = {
  type: 'object',
  properties: {
    candidateId: { type: 'string', description: "Talent UUID (the JWT sub). Optional — defaults to the signed-in talent's UUID derived from the session. An email is NOT accepted by the server." },
    language: { type: 'string', enum: ['es', 'en'] },
    disclaimerAcknowledged: {
      type: 'boolean',
      description: 'true only when the talent answered the answer-mode question this tool printed with both interview disclaimers. Call it first without it: it asks here-or-later and then that question.',
    },
    where: {
      type: 'string',
      enum: ['here', 'later'],
      description: "The talent's pick to 'here now or later on the web?'. Omit it to have the tool ask: in a dialog when the client has one, otherwise it returns the question with its options.",
    },
    answerMode: {
      type: 'string',
      enum: ANSWER_MODES,
      description: "The talent's pick to the answer-mode question: drafted = you propose each answer and they approve or edit it, own = they answer themselves, full = you answer every question yourself. Required with disclaimerAcknowledged:true; omit it to have the tool ask, in a dialog or as options it returns.",
    },
    confirmRepeat: {
      type: 'boolean',
      description: 'Only needed when the talent has ALREADY completed onboarding. The tool then refuses with an already-completed notice unless you set this true after the talent explicitly confirms they want to repeat the interview.',
    },
  },
};

const INTERVIEW_TURN_SCHEMA = {
  type: 'object',
  properties: {
    interviewId: { type: 'string', description: 'Internal handle for this interview — for calling the interview tools ONLY; never shown or mentioned to the talent.' },
    message: { type: 'string', description: "The talent's answer to the current question: in 'own' mode their REAL, VERBATIM words; in 'drafted' mode the answer they APPROVED or edited after seeing your proposal; in 'full' mode (or once they explicitly asked you to answer the rest yourself) your own answer built only from what they confirmed. Outside 'full' mode never a value they have not seen and confirmed: if they have not answered or approved yet, do NOT call this." },
  },
  required: ['interviewId', 'message'],
};

const INTERVIEW_COMPLETE_SCHEMA = {
  type: 'object',
  properties: { interviewId: { type: 'string' } },
  required: ['interviewId'],
};

const FINISH_SCHEMA = { type: 'object', properties: {} };

const LIVEKIT_LOAD_FAILURES = new Set(['livekit-not-installed', 'livekit-no-text-streams']);
// A start or a turn that has not answered by then ends here, and the talent does the interview on the web.
const INTERVIEW_TIMEOUT_MS = 120000;
const TIMED_OUT = Symbol('timed-out');
const TIMEOUT_KINDS = new Set(['timeout', 'turn-timeout']);
// The chat interview runs only in the languages the interview agent speaks; the others do it on the web.
const CHAT_INTERVIEW_LANGUAGES = new Set(['es', 'en']);

function withTimeout(promise, ms) {
  let timer;
  const expiry = new Promise((resolve) => { timer = setTimeout(resolve, ms, TIMED_OUT); });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

// No telemetry ships in this package: stderr reaches the MCP client's server log, with what is needed to size the gap.
function defaultReportLivekitFailure(kind, error) {
  const cause = error && error.cause && error.cause.message ? error.cause.message : (error && error.message) || '';
  process.stderr.write(`  [mcp] livekit-unavailable kind=${kind} os=${process.platform} arch=${process.arch} node=${process.version} cause=${JSON.stringify(cause.slice(0, 300))}\n`);
}

// The last interview this process completed: the main-role step waits for its evaluation.
let lastCompletedInterview = null;

function completedOnboardingInterview() {
  return lastCompletedInterview;
}

function makeRegisterTools(deps = {}) {
  const flow = require('./onboarding-flow');
  const resolved = flow.makeDeps(deps.flowDeps || {});
  const lang = deps.lang || 'en';
  // Same confirmation copy the CLI prints ("Price saved.", …), reused verbatim.
  const catalog = require('./i18n').getCatalog(lang).onboarding;
  // The talent's sign-up language, for what this tool asks them in the chat.
  const textLang = () => require('./signup-language').signupLanguage(lang);
  const copy = () => require('./signup-copy').signupCopy(textLang());
  const checkCompleted = deps.checkOnboardingCompleted || require('./onboarding-availability').checkOnboardingCompleted;

  // The LiveKit room is a live WebRTC connection that must survive between the
  // separate start/turn/complete JSON-RPC calls of this long-lived stdio server.
  const interviewSessions = new Map();

  const reportLivekitFailure = deps.reportLivekitFailure || defaultReportLivekitFailure;
  const interviewTimeoutMs = deps.interviewTimeoutMs || INTERVIEW_TIMEOUT_MS;

  function onWeb(step, reason) {
    return { ok: false, step, reason, relayVerbatim: copy().livekitUnavailable, message: 'Print relayVerbatim word for word now, then call open_web: the talent does the interview on the web.', next: 'open_web' };
  }

  async function teardownInterview(interviewId, { persist = false } = {}) {
    const sess = interviewSessions.get(interviewId);
    if (!sess) return { ok: true };
    interviewSessions.delete(interviewId);
    let saved = { ok: true };
    if (persist && sess.buffer.length > 0) {
      const durationSeconds = Math.max(0, Math.floor((Date.now() - sess.connectAt) / 1000));
      saved = await flow.completeLivekitOnboarding(resolved, {
        interviewId,
        durationSeconds,
        transcripts: sess.buffer.toTranscripts(),
      });
    }
    try { await sess.client.disconnect(); } catch { /* room already gone */ }
    return saved;
  }

  function interviewLater() {
    return { ok: false, reason: 'interview-later', message: 'The talent does the interview later on the web: skip it here and go on with the main role, then open_web.' };
  }

  async function askWhere(args, ctx) {
    if (args.where === 'here') return { here: true };
    if (args.where === 'later') return { here: false };
    const c = copy();
    const asked = await askChoice(ctx, { question: c.interviewWhereQuestion, options: [c.interviewHere, c.interviewLater] });
    if (asked.answer) return { here: asked.answer === c.interviewHere };
    return { chat: asked.chat, dismissed: asked.dismissed };
  }

  async function askAnswerMode(args, ctx, texts) {
    if (ANSWER_MODES.includes(args.answerMode)) return { mode: args.answerMode };
    const c = copy();
    const labels = { drafted: c.answerModeDrafted, own: c.answerModeOwn, full: c.answerModeFull };
    const asked = await askChoice(ctx, { texts, question: c.answerModeQuestion, options: ANSWER_MODES.map((m) => labels[m]) });
    if (asked.answer) return { mode: ANSWER_MODES.find((m) => labels[m] === asked.answer) };
    return { chat: asked.chat, dismissed: asked.dismissed };
  }

  async function interviewStart(args = {}, ctx = {}) {
    let alreadyCompleted = false;
    try {
      alreadyCompleted = await checkCompleted({});
    } catch {
      alreadyCompleted = false;
    }
    if (alreadyCompleted && args.confirmRepeat !== true) {
      return {
        ok: false,
        reason: 'onboarding-already-completed',
        alreadyCompleted: true,
        message:
          'You have already completed the onboarding interview. Re-running it is optional. If the talent explicitly wants to repeat it, call again with confirmRepeat:true.',
      };
    }
    if (!CHAT_INTERVIEW_LANGUAGES.has(textLang())) {
      return { ok: false, reason: 'interview-on-web', relayVerbatim: copy().interviewOnWeb, message: 'Print relayVerbatim word for word now. The interview is not offered here in this language: skip it, go on with the main role, then open_web.' };
    }
    const acknowledged = args.disclaimerAcknowledged === true;
    if (!acknowledged) {
      const where = await askWhere(args, ctx);
      if (where.here === false) return interviewLater();
      if (where.chat) {
        return {
          ok: false,
          reason: 'where-required',
          ...(where.dismissed ? { dismissed: where.dismissed } : {}),
          ...where.chat,
          message: `${where.chat.choiceMessage} Then call onboarding_interview_start again with where:"here" for the first option or where:"later" for the second.`,
        };
      }
    }
    // The two disclaimers travel with the answer-mode question, so they are read before the talent answers it.
    const disclaimers = acknowledged ? [] : Object.values(flow.interviewDisclaimers(textLang()));
    const answer = await askAnswerMode(acknowledged ? args : {}, ctx, disclaimers);
    if (answer.chat) {
      return {
        ok: false,
        reason: 'answer-mode-required',
        ...(answer.dismissed ? { dismissed: answer.dismissed } : {}),
        ...answer.chat,
        message: `${answer.chat.choiceMessage} Then call onboarding_interview_start again with where:"here", disclaimerAcknowledged:true and answerMode: drafted for the first option, own for the second, full for the third.`,
      };
    }
    const room = {};
    const opened = await withTimeout(openRoom(args, room), interviewTimeoutMs);
    if (opened === TIMED_OUT) {
      room.abandoned = true;
      if (room.client) room.client.disconnect().catch(() => {});
      return onWeb('start', 'timeout');
    }
    if (!opened.ok) return opened;
    interviewSessions.set(opened.interviewId, { client: opened.client, buffer: opened.buffer, connectAt: Date.now(), ended: opened.opening.ended === true });
    return { ok: true, interviewId: opened.interviewId, answerMode: answer.mode, greeting: opened.opening.text, ended: opened.opening.ended === true };
  }

  // Creates the interview, joins its room and reads the greeting; `room` lets a timed-out caller close what opened late.
  async function openRoom(args, room) {
    const start = await flow.createAndStartLivekitOnboarding(resolved, {
      candidateId: args.candidateId,
      language: args.language || lang,
    });
    if (!start.ok) {
      if (TIMEOUT_KINDS.has(start.reason)) return onWeb(start.step || 'start', start.reason);
      const out = { ok: false, step: start.step || 'start', reason: start.reason };
      return start.reason === 'interview-already-started' ? { ...out, next: 'open_web' } : out;
    }

    const closing = start.closingMessage;
    const isClosing = closing ? (t) => typeof t === 'string' && t.includes(closing) : null;
    const client = resolved.makeInterviewClient({ isClosing });
    room.client = client;
    const buffer = new TranscriptBuffer();

    try {
      await client.connect(start.livekitUrl, start.token);
    } catch (e) {
      try { await client.disconnect(); } catch { /* nothing joined */ }
      const kind = (e && e.kind) || 'connect-failed';
      if (LIVEKIT_LOAD_FAILURES.has(kind)) reportLivekitFailure(kind, e);
      // Whatever kept the room from opening here, the same interview runs on the web.
      return onWeb('connect', kind);
    }

    let opening;
    try {
      opening = await client.receiveTurn();
    } catch (e) {
      try { await client.disconnect(); } catch { /* room already gone */ }
      return onWeb('greeting', (e && e.kind) || 'no-greeting');
    }
    if (room.abandoned) {
      try { await client.disconnect(); } catch { /* room already gone */ }
      return { ok: false, reason: 'timeout' };
    }
    buffer.recordAgent(opening.text);
    return { ok: true, interviewId: start.interviewId, client, buffer, opening };
  }

  async function interviewTurn(args = {}) {
    const sess = interviewSessions.get(args.interviewId);
    if (!sess) {
      return { ok: false, reason: 'unknown-interview', message: 'No live interview for that interviewId (the server may have restarted). Start again with onboarding_interview_start.' };
    }
    if (sess.ended) return { ok: true, response: '', ended: true };

    const message = typeof args.message === 'string' ? args.message : '';
    sess.buffer.recordUser(message);
    let res;
    try {
      res = await withTimeout(sess.client.sendTurn(message), interviewTimeoutMs);
    } catch (e) {
      res = { failed: (e && e.kind) || 'turn-error' };
    }
    if (res === TIMED_OUT || res.failed) {
      const kind = res === TIMED_OUT ? 'timeout' : res.failed;
      const teardown = await withTimeout(teardownInterview(args.interviewId, { persist: true }), Math.min(interviewTimeoutMs, 15000));
      const saved = teardown !== TIMED_OUT && teardown.ok === true;
      if (TIMEOUT_KINDS.has(kind)) return { ...onWeb('turn', kind), saved };
      return {
        ok: false,
        reason: kind,
        saved,
        message: `The interview connection failed; ${saved ? 'the transcript so far was saved' : 'the transcript so far could not be saved'}. Start again with onboarding_interview_start.`,
      };
    }
    sess.buffer.recordAgent(res.text);
    if (res.ended === true) sess.ended = true;
    return { ok: true, response: res.text, ended: res.ended === true };
  }

  async function interviewComplete(args = {}) {
    if (!interviewSessions.has(args.interviewId)) {
      return { ok: false, reason: 'unknown-interview', message: 'No live interview for that interviewId (the server may have restarted). Nothing to complete; start again if the talent still wants the interview.' };
    }
    const saved = await teardownInterview(args.interviewId, { persist: true });
    if (!saved.ok) return { ok: false, reason: saved.reason || 'complete-failed' };
    lastCompletedInterview = { interviewId: args.interviewId, completedAt: Date.now() };
    return { ok: true, state: 'taken', message: catalog.interviewComplete };
  }

  // OVERWRITE-repeat: reset the taken onboarding interview so it can be re-run.
  async function repeatOnboarding() {
    const reset = await flow.restartOnboarding(resolved);
    if (!reset.ok) {
      if (reset.reason === 'onboarding-not-found') {
        return { ok: false, reason: 'onboarding-not-found', message: 'The talent has no onboarding interview yet: nothing to repeat. Offer onboarding_interview_start instead.' };
      }
      return { ok: false, reason: reset.reason };
    }
    return {
      ok: true,
      interviewId: reset.interviewId,
      language: reset.language,
      next: 'onboarding_interview_start',
      message: 'Onboarding reset — the previous interview was overwritten. Now run it again with onboarding_interview_start; do NOT run the main-role step (that belongs to first-time registration) — go straight to onboarding_finish.',
    };
  }

  async function onboardingFinish() {
    const fin = await flow.completeOnboardingRegistration(resolved);
    if (!fin.ok) return { ok: false, finalized: false, reason: fin.reason, profileUrl: flow.profileUrl(resolved) };
    const pct = fin.completedProfilePercentage;
    return {
      ok: true,
      finalized: true,
      message: typeof pct === 'number' ? catalog.finalizedAt(pct) : catalog.finalizedGeneric,
      onboardingStatus: fin.onboardingStatus,
      registrationLevel: fin.registrationLevel,
      completedProfilePercentage: pct,
      profileUrl: flow.profileUrl(resolved),
    };
  }

  // Content-free context the model may PROPOSE to the talent (never auto-write).
  async function suggestContext(args = {}) {
    const read = deps.readRegisterContextSuggestions || require('./register-context').readRegisterContextSuggestions;
    const suggestions = read({ talentName: args.talentName });
    const found = suggestions.cvCandidates && suggestions.cvCandidates.length > 0;
    return {
      ok: true,
      suggestions,
      note: 'Propose these to the talent to confirm; never write them without confirmation.',
      message: found
        ? 'The talent already allowed the search: read_cv the first candidate now (the most likely), with talentConsent:true and talentName if you know it. nameMatch:null only means their name is unknown, never that the CV is not theirs. Move to the next candidate only if read_cv says mentionsTalent:false; say you did not find it only when none is left.'
        : 'No CV was found on this machine: ask the talent to attach it.',
    };
  }

  // Text of the CV the talent confirmed as theirs, read only with their permission.
  async function readCv(args = {}) {
    if (args.talentConsent !== true) return { ok: false, reason: 'consent-required', message: 'Ask the talent first whether this CV is theirs and whether you may read it; call again with talentConsent:true only after they say yes.' };
    const read = deps.readCvText || require('./cv-text').readCvText;
    const result = read(args.path, { talentName: args.talentName });
    if (!result.ok) return { ...result, message: 'Could not read the CV text here. Ask the talent to attach the CV to the chat, or to tell you what it says.' };
    // Someone else's CV (a candidate they downloaded): never hand its contents over.
    if (result.mentionsTalent === false) return { ok: true, mentionsTalent: false, note: "This CV does not name the talent: it belongs to someone else. Do not use, quote or describe it; try the next candidate." };
    return result;
  }

  return [
    {
      name: 'suggest_register_context',
      description: "SUGGESTIONS for the sign-up read on this machine (no network, no file contents): timezone, git name/email, the gh CLI GitHub login, and cvCandidates: PDF/DOC/DOCX files in Desktop, Documents, Downloads and iCloud Drive whose NAME looks like a CV or carries the talent's name, each with nameMatch (null when their name is unknown) and generic flags. A candidate is only a lead (people who hire keep other people's CVs): confirm it with read_cv. Pass talentName to sharpen the match. Use it when the talent said you may look for their CV on this machine.",
      inputSchema: { type: 'object', properties: { talentName: { type: 'string', description: "The talent's full name as you know it (memory, chat); improves CV matching." } } },
      handler: suggestContext,
    },
    {
      name: 'read_cv',
      description: "Read the TEXT of a CV file (PDF, DOC, DOCX) on this machine, with the talent's permission (talentConsent:true) and talentName set. Returns { mentionsTalent, links: { linkedin, github, emails, phones }, text } for the talent's own CV; a CV that does not name them returns only mentionsTalent:false: it is someone else's, drop it, never describe it, try the next candidate. Nothing is uploaded by this tool: pass the confirmed path to signup_start (or import_profile) as cvPath, use the text for userQuery and the email, and links.linkedin as their LinkedIn URL.",
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the CV file, exactly as suggest_register_context gave it (the short ~/ form is fine) or absolute.' },
          talentConsent: { type: 'boolean', description: 'true ONLY after the talent allowed you to search for and read their CV.' },
          talentName: { type: 'string', description: "The talent's full name as you know it; used to tell their CV from other people's." },
        },
        required: ['path', 'talentConsent'],
      },
      handler: readCv,
    },
    {
      name: 'onboarding_interview_start',
      description: "Start the onboarding interview, here in the chat. Offer it only when signup_status says onboardingInterview.completed is not true. Call it first without disclaimerAcknowledged: it asks 'here now or later on the web?' (in a dialog when the client has one, otherwise it returns `say` to print word for word; default here), then how they want to answer, with the two interview disclaimers in that same question. reason 'interview-later' means they chose the web: skip the interview. reason 'interview-on-web' (a sign-up language the chat interview does not speak) is the same: print relayVerbatim and skip it. If it returns reason 'interview-already-started' (begun elsewhere and not finished), call open_web so they continue on the web. It runs over LiveKit and the server agent conducts it; the client does not decide its branch. When it returns `say`, print it word for word as your whole reply (it holds the disclaimers and the question) and, once they answer, call with where:'here', disclaimerAcknowledged:true and answerMode. Returns { interviewId, answerMode, greeting, ended }: relay the greeting VERBATIM, then drive it with onboarding_interview_turn. ANSWER MODES. For drafted and full, first gather everything you know (memory, a search of past conversations if you have that tool, their CV, the ai_usage report, the sign-up data) and show ONE short sheet 'esto es lo que se de ti' (roles and projects with concrete facts, stack, languages, what they want next); let them correct it once; those corrections override your memory. Your answers are first person, one or two short sentences in their plain voice, built only from facts on the confirmed sheet: no embellishment, no adjectives, metrics or claims they did not give, no repeating a fact already said unless asked; for wishes, preferences or opinions give your best guess and say it is a guess. (1) drafted: show each question VERBATIM with your proposed answer and send it only after the talent approves or edits it; if the sheet does not cover a question, ask them briefly instead of guessing. Only if the talent explicitly asks you to answer everything yourself (for example 'hazla entera' or 'contéstalas tú todas'), answer the remaining questions without asking for each approval, as in full. (2) full (they chose it, or asked for it as above): answer every question yourself without per-answer approval, still showing each question and your answer, and when the interview ends tell them in one line that you answered those questions yourself. (3) own: you are a pure CONDUIT: show every question VERBATIM and pass back only their REAL, VERBATIM words. In every mode never reword, summarize or translate the questions. `interviewId` is internal: never show it. If it fails with next:'open_web', print relayVerbatim word for word and call open_web so they do the interview on the web.",
      inputSchema: INTERVIEW_START_SCHEMA,
      handler: interviewStart,
      available: async () => {
        try {
          return !(await checkCompleted({ timeoutMs: 3000 }));
        } catch {
          return true;
        }
      },
    },
    {
      name: 'onboarding_interview_turn',
      description: "Send the talent's answer to the current onboarding-interview question and get the next one. Follow the answerMode the talent chose at onboarding_interview_start. drafted: `message` is the answer the talent APPROVED or edited after seeing your proposal; never send one they have not confirmed, unless they explicitly asked you to answer the rest yourself ('hazla entera', 'contéstalas tú todas'): from then on, as in full, send your own answers without per-answer approval. full: send your own answer to each question, built only from what they confirmed, and when it ends tell them you answered those questions yourself. own: `message` is ONLY the talent's REAL, VERBATIM answer — never invent, infer or complete it. Outside full, if the talent has not answered or approved yet, do NOT call this, wait for them. Relay the returned `response` (the next question) to the talent VERBATIM — do not reword, summarize or translate it. Keep calling with their next `message` until `ended` is true, then call onboarding_interview_complete. Do NOT show or mention `interviewId` to the talent (internal handle). If it returns reason 'unknown-interview' (the server was restarted and the live room is gone), start again with onboarding_interview_start.",
      inputSchema: INTERVIEW_TURN_SCHEMA,
      handler: interviewTurn,
    },
    {
      name: 'onboarding_interview_complete',
      description: "Close the onboarding interview once the turns report ended:true: the buffered transcript is saved and the live room is disconnected. `interviewId` is internal: never show it. Returns { state:'taken' }. If it returns reason 'unknown-interview' the room was already gone (server restart): nothing to complete. In the sign-up flow, go on to the main role (list_my_roles with waitSeconds, then set_main_role) and finish with open_web; do NOT call onboarding_finish there.",
      inputSchema: INTERVIEW_COMPLETE_SCHEMA,
      handler: interviewComplete,
    },
    {
      name: 'repeat_onboarding_interview',
      description: "OVERWRITE-repeat the onboarding interview: resets the talent's completed onboarding interview IN PLACE; the previous evaluation is DISCARDED and CANNOT be recovered. Clearly warn the talent that this is irreversible and get their explicit go-ahead BEFORE calling this. On success run the interview again (onboarding_interview_start, onboarding_interview_turn until ended, onboarding_interview_complete), then onboarding_finish. Returns { interviewId, language } or reason 'onboarding-not-found' (no onboarding yet), 'http-401'/'http-403'.",
      inputSchema: { type: 'object', properties: {} },
      handler: repeatOnboarding,
    },
    {
      name: 'onboarding_finish',
      description: "Mark the onboarding as COMPLETED on Shakers. NOT part of the sign-up flow (signup_start): there, never call it. Use it only to close a repeat_onboarding_interview run. Idempotent. Returns { finalized, onboardingStatus, registrationLevel, completedProfilePercentage, profileUrl }.",
      inputSchema: FINISH_SCHEMA,
      handler: onboardingFinish,
    },
  ];
}

module.exports = {
  makeRegisterTools,
  completedOnboardingInterview,
  INTERVIEW_START_SCHEMA,
  INTERVIEW_TURN_SCHEMA,
  INTERVIEW_COMPLETE_SCHEMA,
  FINISH_SCHEMA,
};
