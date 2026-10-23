'use strict';

const ID_PROPERTY = { type: 'string', description: 'Position id (UUID or legacy Mongo id) from find_projects or show_project. An internal handle: never show it to the talent.' };

const PREPARE_APPLICATION_SCHEMA = {
  type: 'object',
  properties: { id: ID_PROPERTY },
  required: ['id'],
};

const APPLY_TO_PROJECT_SCHEMA = {
  type: 'object',
  properties: {
    id: ID_PROPERTY,
    message: { type: 'string', description: "The talent's own message for the team, in their words, answering mainMotivationQuestion. Never write it for them." },
    answers: {
      type: 'array',
      description: 'The answers the talent gave, one per question they answered; leave out the ones they skipped.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'integer', description: 'The question number from prepare_application.' },
          answer: { type: 'string', description: 'For OPEN, the talent\'s text. For MULTIPLE_CHOICE, exactly one of that question\'s options.' },
        },
        required: ['question', 'answer'],
      },
    },
    confirm: { type: 'boolean', description: 'true ONLY after the talent explicitly said yes to the summary this tool returned for these exact arguments.' },
  },
  required: ['id'],
};

function parseAnswers(raw, questions) {
  const answers = [];
  const invalid = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const q = entry && Number.isInteger(entry.question) ? questions[entry.question - 1] : null;
    const said = entry && typeof entry.answer === 'string' ? entry.answer.trim() : '';
    if (!q) { invalid.push({ question: entry && entry.question, reason: 'unknown-question' }); continue; }
    if (!said) continue;
    if (q.type === 'MULTIPLE_CHOICE') {
      const option = q.options.find((o) => o.toLowerCase() === said.toLowerCase());
      if (!option) { invalid.push({ question: entry.question, reason: 'not-an-option', options: q.options }); continue; }
      answers.push({ question: q.text, answer: [option] });
    } else {
      answers.push({ question: q.text, answer: said });
    }
  }
  return { answers, invalid };
}

function makeApplyTools(deps = {}) {
  const {
    loadApplication = (opts) => require('./apply-client').loadApplication({}, opts),
    submitApplication = (opts) => require('./apply-client').submitApplication({}, opts),
    applicationSummary = require('./apply-client').applicationSummary,
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
    applyCopy = () => require('./signup-copy').applyCopy(require('./signup-language').signupLanguage(require('./i18n').detectFlowLang())),
  } = deps;

  const shownSummaries = new Set();

  const requireLoginSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — sign in with social_signin_start (or run `shakers login`) first (this tool is session-gated).');
    }
    return session;
  };

  async function readApplication(args) {
    const session = requireLoginSession();
    const positionId = typeof args.id === 'string' ? args.id.trim() : '';
    if (!positionId) return { session, result: { ok: false, reason: 'no-id' } };
    const app = await loadApplication({ hubAccessToken: session.hubAccessToken, positionId });
    if (!app.ok) return { session, result: { ok: false, reason: app.reason } };
    if (!app.open) return { session, result: { ok: false, reason: 'not-open', relayVerbatim: applyCopy().notOpen, message: 'Nothing was sent. Print relayVerbatim word for word.' } };
    return { session, positionId, app };
  }

  async function prepareApplication(args = {}) {
    const { result, app } = await readApplication(args);
    if (result) return result;
    const t = applyCopy();
    return {
      ok: true,
      title: app.title,
      company: app.company,
      mainMotivationQuestion: app.mainMotivationQuestion || t.mainMotivationFallback,
      questions: app.questions.map((q, i) => ({ number: i + 1, ...q })),
      reviewedByShakers: !!app.doubleCheck && app.doubleCheck !== 'NO',
      message: 'Nothing has been sent. Ask the talent the mainMotivationQuestion and then each question, one at a time, in their language; for MULTIPLE_CHOICE list its options numbered. Every answer is optional. Use only what the talent writes: never invent, complete or improve the message or the answers. Then call apply_to_project with them.',
    };
  }

  async function applyToProject(args = {}) {
    const { session, positionId, app, result } = await readApplication(args);
    if (result) return result;
    const t = applyCopy();
    const { answers, invalid } = parseAnswers(args.answers, app.questions);
    if (invalid.length) {
      return { ok: false, reason: 'invalid-answers', invalid, message: 'Nothing was sent. Some answers do not match the questions from prepare_application: ask the talent again for those and call apply_to_project with the question number and, for MULTIPLE_CHOICE, one of its options exactly.' };
    }
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    const key = JSON.stringify([positionId, message, answers]);
    if (args.confirm !== true || !shownSummaries.has(key)) {
      shownSummaries.add(key);
      return {
        ok: false,
        reason: 'confirmation-required',
        say: [...applicationSummary(t, app, { message, answers }), t.confirmQuestion].join('\n\n'),
        message: "Nothing has been sent. Print say word for word and wait for the talent. Call apply_to_project again with exactly the same arguments and confirm:true only if the talent explicitly says yes to sending it; if they want changes, collect them and call it without confirm. Only the talent decides: never confirm on their behalf, and never invent the message or the answers.",
      };
    }
    shownSummaries.delete(key);
    const mainMotivationQuestion = app.mainMotivationQuestion || t.mainMotivationFallback;
    const res = await submitApplication({ hubAccessToken: session.hubAccessToken, positionId, message, answers, mainMotivationQuestion });
    if (!res.ok) {
      if (res.reason === 'already-applied') return { ok: false, reason: res.reason, applicationStatus: res.applicationStatus, relayVerbatim: t.alreadyApplied(res.applicationStatus), message: 'Print relayVerbatim word for word.' };
      if (res.reason === 'position-unavailable') return { ok: false, reason: res.reason, relayVerbatim: t.notOpen, message: 'Print relayVerbatim word for word.' };
      return { ok: false, reason: res.reason, message: 'The application was not sent. Tell the talent it could not be sent and that they can try again later.' };
    }
    return {
      ok: true,
      status: res.status,
      relayVerbatim: res.status === 'PENDING' ? t.sentPending : t.sent,
      message: 'Print relayVerbatim word for word.',
    };
  }

  return [
    {
      name: 'prepare_application',
      title: 'See what applying to a project asks',
      description: 'Reads the questions you are asked when you apply to a Shakers project. It sends nothing.',
      guidance: "Read-only first step to apply to a project/Position as an already-registered talent: returns its title, company, the main motivation question and the extra questions (OPEN or MULTIPLE_CHOICE with options), numbered. If reason is not-open, the talent already applied or the project is closed: print relayVerbatim and stop. Then ask the talent each question in the chat and call apply_to_project with their own words. Never invent or complete answers. Requires an active session and the position id.",
      inputSchema: PREPARE_APPLICATION_SCHEMA,
      handler: prepareApplication,
    },
    {
      name: 'apply_to_project',
      title: 'Apply to a project',
      description: 'Shows you exactly what your application to a Shakers project will send and sends it only after you say yes.',
      guidance: "Apply to a project/Position for the talent with their message and their answers to the prepare_application questions. Only the message and the answers are sent: never budget, phone, location or availability. Call it first without confirm: it returns `say`, the literal summary and the question, to print word for word. Only when the talent explicitly answers yes, call it again with exactly the same arguments and confirm:true; a confirm without that summary shown counts for nothing. Never confirm on the talent's behalf and never invent, complete or improve their message or answers. Print relayVerbatim word for word. Requires an active session and the position id, which is an internal handle never shown to the talent.",
      inputSchema: APPLY_TO_PROJECT_SCHEMA,
      handler: applyToProject,
    },
  ];
}

module.exports = { makeApplyTools, parseAnswers, PREPARE_APPLICATION_SCHEMA, APPLY_TO_PROJECT_SCHEMA };
