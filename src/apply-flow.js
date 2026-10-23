'use strict';

const { styleLabelPrefix } = require('./ansi');
const { sanitizeRenderText: clean } = require('./sanitize-network-text');
const { applicationSummary } = require('./apply-client');

function makeApplyDeps(overrides = {}) {
  const client = require('./apply-client');
  return {
    loadApplication: (opts) => client.loadApplication({}, opts),
    submitApplication: (opts) => client.submitApplication({}, opts),
    resolveRef: (raw) => require('./find-projects-cache').resolvePositionRef(raw),
    promptSelect: (opts) => require('./prompt-select').promptSelect(opts),
    ...overrides,
  };
}

async function askAnswers({ io, ask, fp, questions, opts, deps }) {
  const answers = [];
  for (const q of questions) {
    if (q.type === 'MULTIPLE_CHOICE') {
      const picked = await deps.promptSelect({
        ask,
        stdinIsTTY: true,
        out: (s) => io.notify(s),
        header: clean(q.text),
        hint: fp.choiceHint,
        items: [...q.options.map((value) => ({ label: clean(value), value })), { label: fp.skipChoice, value: null }],
        labelFor: (x) => x.label,
        input: opts.input,
        output: opts.output,
      });
      if (picked && picked.value) answers.push({ question: q.text, answer: [picked.value] });
    } else {
      const answer = String(await io.ask(fp.askOpen(clean(q.text)))).trim();
      if (answer) answers.push({ question: q.text, answer });
    }
  }
  return answers;
}

function paintedSummary(fp, app, message, answers) {
  return applicationSummary(fp, {
    title: app.title && clean(app.title),
    company: app.company && clean(app.company),
    doubleCheck: app.doubleCheck,
  }, {
    message,
    answers: answers.map((a) => ({ question: clean(a.question), answer: Array.isArray(a.answer) ? a.answer.map(clean) : a.answer })),
  });
}

async function runApply({ io, ask, session, catalog, opts = {}, deps = makeApplyDeps() }) {
  const fp = catalog.apply;
  if (!opts.stdinIsTTY) {
    io.error(fp.needsInteractive);
    return { ok: false, reason: 'non-interactive' };
  }
  const resolved = deps.resolveRef(opts.id);
  if (!resolved.ok) {
    io.error(resolved.reason === 'no-cache' ? fp.refNoCache
      : resolved.reason === 'out-of-range' ? fp.refOutOfRange(resolved.count)
        : fp.idRequired);
    return { ok: false, reason: resolved.reason };
  }
  const positionId = resolved.id;
  const hubAccessToken = session ? session.hubAccessToken : null;

  const app = await io.withProgress(fp.loading, () => deps.loadApplication({ hubAccessToken, positionId }));
  if (!app.ok) {
    io.error(app.reason === 'not-found' ? fp.notFound : fp.fetchFailed(app.reason));
    return { ok: false, reason: app.reason };
  }
  if (!app.open) {
    io.notify(fp.notOpen);
    return { ok: false, reason: 'not-open' };
  }

  io.section(app.title ? clean(app.title) : fp.untitled);
  if (app.company) io.notify(styleLabelPrefix(fp.companyLine(clean(app.company))));
  const mainMotivationQuestion = app.mainMotivationQuestion || fp.mainMotivationFallback;
  const message = String(await io.ask(fp.askMessage(clean(mainMotivationQuestion)))).trim();
  const answers = await askAnswers({ io, ask, fp, questions: app.questions, opts, deps });

  const [heading, ...lines] = paintedSummary(fp, app, message, answers);
  io.section(heading);
  for (const line of lines) io.notify(line);
  if (!(await io.confirm(fp.confirm))) {
    io.notify(fp.cancelled);
    return { ok: true, cancelled: true };
  }

  const res = await io.withProgress(fp.sending, () => deps.submitApplication({ hubAccessToken, positionId, message, answers, mainMotivationQuestion }));
  if (!res.ok) {
    if (res.reason === 'already-applied') io.notify(fp.alreadyApplied(res.applicationStatus));
    else if (res.reason === 'position-unavailable') io.error(fp.notOpen);
    else if (res.reason === 'not-found') io.error(fp.notFound);
    else io.error(fp.failed(res.reason));
    return { ok: false, reason: res.reason };
  }
  io.success(res.status === 'PENDING' ? fp.sentPending : fp.sent);
  return { ok: true, status: res.status };
}

module.exports = { makeApplyDeps, runApply };
