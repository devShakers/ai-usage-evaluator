'use strict';

const path = require('path');
const { expandHome } = require('./env-paths');
const { toSignupLanguage } = require('./signup-copy');
const { signupLanguage } = require('./signup-language');
const { CHOICE_RULE, QUESTION_RULE, DRAFT_RULE, nextSayRule } = require('./mcp-instructions');

// Claude Desktop asks for approval once per tool, so the whole sign-up runs through one tool: `signup`, with a
// `step` that delegates to the handler of the tool that step used to be. The talent reads the same texts.

// Step -> the tool whose handler runs it.
const STEP_TOOLS = {
  start: 'signup_start',
  find_cv: 'suggest_register_context',
  read_cv: 'read_cv',
  open_linkedin: 'open_linkedin_profile',
  email: 'signup_email',
  local_preview: 'signup_draft',
  create_account: 'signup_create_account',
  status: 'signup_status',
  update_existing: 'update_existing_profile',
  save_details: 'save_profile_details',
  import: 'import_profile',
  ai_usage: 'ai_usage',
  ai_usage_upload: 'ai_usage_upload',
  ai_usage_result: 'ai_usage_result',
  interview: 'onboarding_interview_start',
  interview_turn: 'onboarding_interview_turn',
  interview_complete: 'onboarding_interview_complete',
  roles: 'list_my_roles',
  set_main_role: 'set_main_role',
  open_web: 'open_web',
};
const STEPS = Object.keys(STEP_TOOLS);
const TOOL_STEPS = Object.fromEntries(Object.entries(STEP_TOOLS).map(([step, tool]) => [tool, step]));

// Tools only the sign-up used: they are no longer listed, so the model cannot reach them one by one.
const ABSORBED_TOOLS = new Set(['signup_start', 'suggest_register_context', 'read_cv', 'open_linkedin_profile', 'signup_email', 'signup_draft', 'signup_create_account', 'signup_status', 'update_existing_profile', 'save_profile_details', 'import_profile']);

// The waits each step holds in one call, as the old instructions passed them; the tool sets them itself.
const STEP_WAIT_SECONDS = { status: 45, roles: 45, ai_usage_upload: 30 };
// Claude Desktop cuts a tool call at ~60 s and ignores progress: a wait that has not answered by then gets a retry answer.
const WAIT_DEADLINE_MS = 50000;

// Steps of the sign-up before the account window, which a talent can no longer redo once it opened.
const INTERVIEW_STEPS = new Set(['interview', 'interview_turn', 'interview_complete']);
const INTRO_STEPS = new Set(['start', 'find_cv', 'read_cv', 'open_linkedin', 'email', 'local_preview']);
// Answers that still wait for the talent, so the step they belong to is not done yet.
const PENDING_REASONS = new Set(['answer-required', 'consent-required', 'where-required', 'answer-mode-required', 'main-role-choice-required', 'main-role-ask', 'upload-approval-required']);

// Steps that read the talent's files or send their data, and the steps that lead into one: their answers say what to do when Claude's permission check blocks the next call.
const GUARDED_STEPS = new Set(['start', 'find_cv', 'read_cv', 'local_preview', 'create_account', 'import']);
const BLOCKED_MESSAGE = 'If Claude blocks your next signup call for lack of permission, do not retry it silently and do not give up: tell the talent in one sentence what was blocked and ask them to repeat the instruction naming the data and where it goes, in their language (for example: "yes, read my CV for my Shakers sign-up"). Never suggest any other way around the block.';

const TOOL_NAME_RE = new RegExp(`\\b(${Object.keys(TOOL_STEPS).sort((a, b) => b.length - a.length).join('|')})\\b`, 'g');

// What the model reads, in step words instead of tool names; waits are the tool's own, so their arguments go.
function inStepWords(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/\s*\(waitSeconds[^)]*\)/g, '')
    .replace(/ again with waitSeconds/g, ' again')
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/waitSeconds/.test(sentence))
    .join(' ')
    .replace(TOOL_NAME_RE, (name) => `signup step "${TOOL_STEPS[name]}"`);
}

// Only fields written for the model are renamed; `say`, `question`, relayVerbatim and the rest are the talent's texts.
function forModel(result) {
  if (!result || typeof result !== 'object') return result;
  const out = { ...result };
  for (const key of ['message', 'cvNote', 'note']) if (typeof out[key] === 'string') out[key] = inStepWords(out[key]);
  if (typeof out.next === 'string' && TOOL_STEPS[out.next]) out.next = TOOL_STEPS[out.next];
  return out;
}

const resolvedPath = (p) => path.resolve(expandHome(String(p).trim()));
const isPending = (result) => !!result && PENDING_REASONS.has(result.reason);

function freshProgress() {
  return { started: false, email: false, draft: false, requested: false, signedIn: false, account: null, updateAnswered: false, profile: false, aiUsage: false, interview: false, interviewId: null, interviewEnded: false, roles: false, mainRole: false };
}

// In order: what has to have happened, and the step that does it.
const MILESTONES = [
  ['started', (p) => p.started, () => 'start'],
  ['email', (p) => p.email, () => 'email'],
  ['draft', (p) => p.draft, () => 'local_preview'],
  ['requested', (p) => p.requested, () => 'create_account'],
  ['account', (p) => p.account === 'created' || p.account === 'existing', () => 'status'],
  ['profile', (p) => p.profile, (p) => (p.account === 'existing' && !p.updateAnswered ? 'update_existing' : 'save_details')],
  ['aiUsage', (p) => p.aiUsage, () => 'ai_usage'],
  ['interview', (p) => p.interview && !p.interviewId, (p) => interviewStep(p)],
  ['roles', (p) => p.roles, () => 'roles'],
  ['mainRole', (p) => p.mainRole, () => 'set_main_role'],
];

// The last milestone each step needs.
const STEP_NEEDS = {
  start: null,
  find_cv: 'started',
  read_cv: 'started',
  open_linkedin: 'started',
  email: 'started',
  local_preview: 'email',
  create_account: 'draft',
  status: 'requested',
  update_existing: 'account',
  save_details: 'account',
  import: 'account',
  ai_usage: 'profile',
  ai_usage_upload: 'aiUsage',
  ai_usage_result: 'aiUsage',
  interview: 'aiUsage',
  interview_turn: 'aiUsage',
  interview_complete: 'aiUsage',
  roles: 'interview',
  set_main_role: 'roles',
  open_web: 'mainRole',
};

// A live interview goes on until it ends and is closed; without one, it is offered.
function interviewStep(p) {
  if (!p.interviewId) return 'interview';
  return p.interviewEnded ? 'interview_complete' : 'interview_turn';
}

function nextStep(progress) {
  const missing = MILESTONES.find(([, done]) => !done(progress));
  return missing ? missing[2](progress) : 'open_web';
}

function refusal(step, progress) {
  if (step === 'import' && progress.signedIn) return null;
  const windowOpen = progress.requested && progress.account !== 'failed';
  if ((INTRO_STEPS.has(step) || step === 'create_account') && windowOpen && !(step === 'create_account' && progress.account === 'waiting')) return nextStep(progress);
  const needs = STEP_NEEDS[step];
  if (!needs) return null;
  const upTo = MILESTONES.findIndex(([name]) => name === needs);
  const missing = MILESTONES.slice(0, upTo + 1).find(([, done]) => !done(progress));
  if (step === 'update_existing' && !missing && progress.account !== 'existing') return nextStep(progress);
  // A room is opened once; while it lives the talent answers it or, as on the web, ends it early.
  if (!missing && INTERVIEW_STEPS.has(step) && (step === 'interview') === !!progress.interviewId) return nextStep(progress);
  return missing ? missing[2](progress) : null;
}

function record(progress, step, result) {
  const r = result || {};
  switch (step) {
    case 'start':
      progress.started = true;
      break;
    case 'email':
      progress.email = r.ok === true && !!r.email;
      break;
    case 'local_preview':
      if (r.ok === true) progress.draft = true;
      else if (r.reason === 'draft-change') progress.draft = false;
      break;
    case 'create_account':
      if (r.ok === true) { progress.requested = true; progress.account = 'waiting'; }
      if (r.reason === 'already-signed-in') progress.signedIn = true;
      break;
    case 'status':
      if (r.account && r.account.state) progress.account = r.account.state;
      if (r.onboardingInterview && r.onboardingInterview.completed === true) progress.interview = true;
      break;
    case 'update_existing':
      if (r.ok === true) { progress.updateAnswered = true; if (r.updated === false) progress.profile = true; }
      break;
    case 'save_details':
      if (r.ok === true) progress.profile = true;
      break;
    case 'ai_usage':
      if (r.background === true || r.reason === 'consent-declined') progress.aiUsage = true;
      break;
    case 'interview':
      if (r.ok === true && r.interviewId) { progress.interviewId = r.interviewId; progress.interviewEnded = r.ended === true; }
      else if (!isPending(r)) progress.interview = true;
      break;
    case 'interview_turn':
      if (r.ok === true) { if (r.ended === true) progress.interviewEnded = true; break; }
      // The room is gone: done if the talent does it on the web, otherwise offered again.
      progress.interviewId = null;
      progress.interviewEnded = false;
      progress.interview = r.next === 'open_web';
      break;
    case 'interview_complete':
      // As on the web, closing moves on to the roles whatever certs kept: an unsaved interview stays pending there.
      progress.interviewId = null;
      progress.interviewEnded = false;
      progress.interview = true;
      break;
    case 'roles':
      if (r.next === 'set_main_role' || r.next === 'open_web') progress.roles = true;
      if (r.next === 'open_web') progress.mainRole = true;
      break;
    case 'set_main_role':
      if (!isPending(r)) progress.mainRole = true;
      break;
    default:
      break;
  }
}

function withDeadline(promise, ms) {
  let timer;
  const expired = new Promise((resolve) => { timer = setTimeout(resolve, ms, null); });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function propertiesOf(schemas) {
  const out = {};
  for (const [step, schema] of schemas) {
    for (const [key, prop] of Object.entries((schema && schema.properties) || {})) {
      if (key === 'waitSeconds' || key === 'interviewId') continue;
      if (out[key]) { out[key].steps.push(step); continue; }
      out[key] = { prop, steps: [step] };
    }
  }
  return Object.fromEntries(Object.entries(out).map(([key, { prop, steps }]) => {
    const { enum: values, ...rest } = prop;
    // A name two steps share with different vocabularies keeps each step's own check in its handler.
    const shared = steps.length > 1 && values ? rest : prop;
    return [key, { ...shared, description: inStepWords(`Step ${steps.join(', ')}: ${prop.description || ''}`.trim()) }];
  }));
}

function makeSignupTool(tools, { waitSeconds = STEP_WAIT_SECONDS, waitDeadlineMs = WAIT_DEADLINE_MS } = {}) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const handlerOf = (step) => {
    const tool = byName.get(STEP_TOOLS[step]);
    if (!tool) throw new Error(`signup needs the ${STEP_TOOLS[step]} tool`);
    return tool.handler;
  };
  STEPS.forEach(handlerOf);

  let progress = freshProgress();
  // The CV files the talent let read_cv read: the only ones create_account may upload.
  let confirmedCvs = new Set();

  async function run(step, args, ctx) {
    const handler = handlerOf(step);
    if (step === 'read_cv') {
      const file = args.path || args.cvPath;
      const result = await handler({ ...args, path: file }, ctx);
      if (result && result.ok === true && result.mentionsTalent !== false && typeof file === 'string' && file.trim()) confirmedCvs.add(resolvedPath(file));
      return result;
    }
    if (step === 'save_details') return handler(args.details || {}, ctx);
    // The terms and the newsletter are asked one after the other: the talent's answer goes to whichever is pending.
    if (step === 'create_account' && args.answer !== undefined) {
      const { answer, ...rest } = args;
      return handler({ termsAnswer: answer, newsletterAnswer: answer, ...rest }, ctx);
    }
    if (step === 'ai_usage_result') return handler({ ...args, explained: true }, ctx);
    if (step === 'local_preview') return handler({ ...(args.preview || {}), ...(args.answer !== undefined ? { answer: args.answer } : {}) }, ctx);
    if (step === 'interview_turn' || step === 'interview_complete') return handler({ ...args, interviewId: progress.interviewId }, ctx);
    if (waitSeconds[step] !== undefined) return handler({ ...args, waitSeconds: waitSeconds[step] }, ctx);
    return handler(args, ctx);
  }

  // Waits that poll: a repeat runs the step again.
  const holdsAWait = (step, args) => step === 'status' || step === 'roles' || step === 'ai_usage_result' || (step === 'ai_usage_upload' && args.confirm === undefined);
  // Work that must run once (opening the room, sending an answer, saving the interview): a repeat waits for the same work.
  const runsOnce = (step, args) => step === 'interview_turn' || step === 'interview_complete' || (step === 'interview' && args.disclaimerAcknowledged === true);
  let running = null;
  const stillWaiting = (step) => ({ ok: false, reason: 'still-waiting', message: `Nothing changed yet. Say nothing about it and call signup with step "${step}" again.` });

  async function handler(raw = {}, ctx = {}) {
    const { step, ...args } = raw || {};
    if (!STEPS.includes(step)) {
      return { ok: false, reason: 'unknown-step', expected: nextStep(progress), message: `Call signup with step "${nextStep(progress)}".` };
    }
    if (running && running.step !== step) return { ...stillWaiting(running.step), expected: running.step };
    let work = running && running.work;
    if (!work) {
      // A new sign-up starts over, as signup_start itself does.
      if (step === 'start' && !(typeof args.answer === 'string' && args.answer.trim()) && args.linkedinMissing !== true && !(progress.requested && progress.account !== 'failed')) {
        progress = freshProgress();
        confirmedCvs = new Set();
      }
      const expected = refusal(step, progress);
      if (expected) {
        return { ok: false, reason: 'out-of-order', step, expected, message: `Not yet: nothing was done and the talent sees nothing of this. Call signup with step "${expected}" now.` };
      }
      if (step === 'local_preview' && !(args.preview && typeof args.preview === 'object')) {
        return { ok: false, reason: 'preview-required', message: 'Nothing was shown. Pass your draft of the profile inside `preview` (name, role, rates, sources...), and the talent\'s pick as `answer` next to it.' };
      }
      if (step === 'create_account' && typeof args.cvPath === 'string' && args.cvPath.trim() && !confirmedCvs.has(resolvedPath(args.cvPath))) {
        return { ok: false, reason: 'cv-not-confirmed', expected: 'read_cv', message: 'Only a CV the talent let you read with signup step "read_cv" can be sent: pass that same path as cvPath, or none.' };
      }
      work = run(step, args, ctx);
    }
    const once = !!running || runsOnce(step, args);
    // Held before the first await, so a call that arrives meanwhile waits for this work instead of starting it again.
    if (once && !running) running = { step, work };
    const release = () => { if (running && running.work === work) running = null; };
    let result;
    try {
      result = once || holdsAWait(step, args) ? await withDeadline(work, waitDeadlineMs) : await work;
    } catch (e) {
      release();
      throw e;
    }
    if (result === null) {
      work.catch(() => {});
      return stillWaiting(step);
    }
    release();
    record(progress, step, result);
    const next = nextStep(progress);
    if (INTERVIEW_STEPS.has(step) && result.next === 'open_web') return onTheWebLater(result, step, next);
    // An answer still waiting for the talent goes back to the same step.
    const out = forModel({ ...result, step: result.step || step, ...(result.ok === false && !isPending(result) ? {} : { nextStep: isPending(result) ? step : next }) });
    return GUARDED_STEPS.has(step) ? { ...out, message: [out.message, BLOCKED_MESSAGE].filter(Boolean).join(' ') } : out;
  }

  // An interview that cannot run here is done on the web, which the last step opens: the sign-up goes on.
  function onTheWebLater(result, step, next) {
    const { next: _web, ...rest } = result;
    const relay = typeof result.relayVerbatim === 'string' ? 'Print relayVerbatim word for word now. ' : '';
    return { ...rest, step: result.step || step, nextStep: next, message: `${relay}The talent does the interview on the web, which signup step "open_web" opens at the end of the sign-up. Call signup with step "${next}" now.` };
  }

  const previewOf = (schema) => {
    const { answer: _answer, ...fields } = schema.properties;
    return { ...schema, description: `Shown to the talent here in the chat as a preview; nothing is sent to Shakers in this step or with the email question. ${schema.description}`, properties: fields };
  };
  const schemaOf = (step) => {
    const schema = byName.get(STEP_TOOLS[step]).inputSchema;
    if (step === 'save_details') return { properties: { details: schema } };
    // The email question takes the same draft, so that its answer hands the draft over.
    if (step === 'email') return { ...schema, properties: { ...schema.properties, preview: previewOf(byName.get(STEP_TOOLS.local_preview).inputSchema) } };
    if (step !== 'local_preview') return schema;
    return { properties: { preview: previewOf(schema), answer: schema.properties.answer } };
  };
  const schemas = STEPS.map((step) => [step, schemaOf(step)]);
  const stepGuides = STEPS.map((step) => `- ${step}: ${inStepWords(byName.get(STEP_TOOLS[step]).guidance || '')}`);

  return {
    name: 'signup',
    title: 'Sign up on Shakers',
    description: 'Signs you up on Shakers from this chat (your CV and LinkedIn, your profile draft, your account, created on the Shakers website after you accept the Terms, your AI analysis, the interview offer and your main role), asking you before looking for or reading your CV on this computer or analysing how you work with AI, and sending nothing to Shakers until you confirm. The assistant speaks to you as Shakers, writes out the text of each step for you in full here in the chat, and never mentions tools, steps or checks.',
    guidance: [
      'The whole Shakers sign-up, one step per call: pass `step` and that step\'s arguments. Every answer says in `message` what to do next and in nextStep which step comes next; a step out of order is refused with the step to call (`expected`) and nothing done. Waits happen inside the tool: call the same step again when it says so.',
      `The text of a step that follows an answer of the talent (notices, legal texts, the whole draft) comes one answer early as nextSay, with the answer it follows: ${nextSayRule(['<that answer>'])} That question comes as \`question\` and its \`options\` (at most four): ${QUESTION_RULE} A text that only exists after an action of the same turn (what an existing account would fill, what the AI-usage analysis found, the recommended roles, a line about an import that failed) comes as \`say\`, first in the result, with the question and its options numbered at its end, and no \`options\` for you: ${CHOICE_RULE} ${DRAFT_RULE} An answer counts only in a call after the one that returned its question. One question per message, at its end. The welcome comes as \`say\` too, ending with an open line and no options: the talent answers it in their own words. local_preview only shows the draft here and sends nothing; nothing reaches Shakers before the talent confirms it.`,
      'Talk as Shakers talking to the talent. Never mention tools, MCP, steps, calls, arguments, permissions or a confirmation a tool asks for, or servers (never "let me check what the sign-up asks for", "the tool asks for its own confirmation").',
      'If Claude blocks a signup call for lack of permission, never retry it silently and never give up: tell the talent in one sentence what was blocked and ask them to repeat the instruction naming the data and where it goes (for example: "yes, read my CV for my Shakers sign-up"). Never suggest any other way around the block.',
      'Steps:',
      ...stepGuides,
      'The interview runs through these steps too: interview, then interview_turn once per answer until ended, then interview_complete; the tool keeps the interview handle, so never pass interviewId. When it has to be done on the web, the web opens at signup step "open_web", the last step: go on with nextStep. Never call another tool during the sign-up.',
    ].join('\n'),
    // One tool that reads this computer and writes to Shakers, so not read-only; it never deletes and never overwrites a value the talent set, and it talks to Shakers.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: STEPS, description: 'The sign-up step to run.' },
        ...propertiesOf(schemas),
      },
      required: ['step'],
    },
    handler,
  };
}

// The tool whose narration opens a result: each sign-up step says what its own tool does.
function narratedTool(name, args) {
  const step = name === 'signup' && args && typeof args === 'object' ? args.step : null;
  return STEP_TOOLS[step] || name;
}

// The narration's language: the first call of a sign-up names the talent's language before the step fixes it.
function narrationLanguage(name, args, fallback) {
  const opening = name === 'signup' && args && args.step === 'start' && !args.answer && toSignupLanguage(args.language);
  return opening || signupLanguage(fallback);
}

// A tool the sign-up also runs as a step stays listed for use outside it.
function outsideSignup(tool) {
  const step = TOOL_STEPS[tool.name];
  if (!step || ABSORBED_TOOLS.has(tool.name)) return tool;
  return { ...tool, guidance: `During the sign-up use signup step "${step}" instead. ${tool.guidance || ''}`.trim() };
}

module.exports = { makeSignupTool, outsideSignup, narratedTool, narrationLanguage, inStepWords, ABSORBED_TOOLS, BLOCKED_MESSAGE, GUARDED_STEPS, STEP_TOOLS, STEP_WAIT_SECONDS, STEPS, WAIT_DEADLINE_MS };
