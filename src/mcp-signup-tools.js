'use strict';

const {
  WORK_SITUATIONS, EMPLOYMENT_PARTICIPATIONS, FREELANCE_OPINIONS, CHANGE_MOTIVATORS,
  WORK_MODES, MONTHLY_HOURS, LANGUAGE_CODES, LANGUAGE_LEVELS,
} = require('./onboarding-flow');
const { signupCopy, legalCopy, renderDraft, amount } = require('./signup-copy');
const { fixSignupLanguage, signupLanguage } = require('./signup-language');
const { readLocalCv } = require('./cv-file');
const { emailFromHubToken } = require('./auth-session-store');
const { askAfterTexts } = require('./mcp-choice');

// MCP sign-up (ticket 39540): hub imports into an UNREGISTERED profile that the local window claims with a code kept only in memory.

const SIGNUP_WINDOW_TIMEOUT_MS = 15 * 60 * 1000;
// The browser opens this long after the tool answers, so the AI's line announcing it is on screen first.
const BROWSER_OPEN_DELAY_MS = 4000;
const MAX_WAIT_SECONDS = 25;
const IMPORT_POLL_MS = 3000;
// Languages the profile importer writes in.
const IMPORT_LANGUAGES = new Set(['es', 'en', 'it', 'pt', 'fr']);
// The web's high-rate notice; above it a rate is a per-project or annual figure in the wrong field.
const MAX_HOURLY_RATE = 500;
const MIN_ANNUAL_RATE = 1000;
// LinkedIn redirects a signed-in member from /in/me/ to their own /in/<slug>/.
const LINKEDIN_SELF_URL = 'https://www.linkedin.com/in/me/';
const LINKEDIN_PROFILE_RE = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]+)\/?(?:[?#].*)?$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Personal mailbox providers; any other domain may be the talent's employer, so the email question adds the work-email hint.
const PERSONAL_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'outlook.es', 'hotmail.com', 'hotmail.es', 'hotmail.it', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.es', 'yahoo.it', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.es', 'gmx.de', 'aol.com', 'zoho.com', 'tutanota.com', 'libero.it', 'virgilio.it', 'tiscali.it', 'sapo.pt', 'mail.com', 'yandex.com', 'fastmail.com', 'hey.com', 'uol.com.br', 'bol.com.br']);
const INVALID_LINKEDIN_MESSAGE = 'That is not a LinkedIn profile URL (linkedin.com/in/<slug>; /in/me only redirects to it). Ask the talent once more to copy the address bar of their profile page, or continue with the CV only.';
const VERBATIM = 'Show relayVerbatim word for word, as its own block, with nothing of your own added to it.';

function isPersonalEmail(email) {
  return PERSONAL_EMAIL_DOMAINS.has(String(email).split('@').pop().toLowerCase());
}

function isLinkedinProfileUrl(url) {
  const m = LINKEDIN_PROFILE_RE.exec(url);
  return !!m && m[1].toLowerCase() !== 'me';
}

// Web semantics: the hourly rate is the part-time project price and the annual target the full-time one, always EUR.
function pricingFromRates({ hourlyRate, annualRate } = {}) {
  const hourly = hourlyRate != null && hourlyRate !== '';
  const annual = annualRate != null && annualRate !== '';
  if ((hourly && Number(hourlyRate) > MAX_HOURLY_RATE) || (annual && Number(annualRate) < MIN_ANNUAL_RATE)) {
    return { ok: false, reason: 'implausible-rate', message: `hourlyRate is euros per hour (at most ${MAX_HOURLY_RATE}) and annualRate euros per year (at least ${MIN_ANNUAL_RATE}): re-estimate and save the pricing again.` };
  }
  return {
    ok: true,
    input: { partTimeSelected: hourly, partTimeAmount: hourlyRate, partTimeCurrency: 'EUR', fullTimeSelected: annual, fullTimeAmount: annualRate, fullTimeCurrency: 'EUR' },
  };
}

function labelledOptions(codes, labels) {
  return codes.map((code) => `${labels[code] || code} (${code})`).join(', ');
}

function buildDetailsSchema(lang) {
  const L = require('./i18n').getCatalog(lang).onboarding;
  const show = 'Show the talent the label, pass the code';
  return {
    type: 'object',
    description: 'Every section is optional and saved on its own; send what you inferred.',
    properties: {
      workSituation: {
        type: 'object',
        description: 'Current work situation, inferred from what you know (an employer in the CV or memory means EMPLOYED there).',
        properties: {
          situation: { type: 'string', enum: WORK_SITUATIONS, description: `${show}: ${labelledOptions(WORK_SITUATIONS, L.workSituationLabels)}. 'EMPLOYED' requires participation.` },
          participation: { type: 'string', enum: EMPLOYMENT_PARTICIPATIONS, description: `Only when EMPLOYED. ${show}: ${labelledOptions(EMPLOYMENT_PARTICIPATIONS, L.employmentParticipationLabels)}.` },
          opinion: { type: 'string', enum: FREELANCE_OPINIONS, description: `Opinion on freelancing, required unless FREELANCE. ${show}: ${labelledOptions(FREELANCE_OPINIONS, L.freelanceOpinionLabels)}.` },
          changeMotivators: { type: 'string', enum: CHANGE_MOTIVATORS, description: `Motivation, your best match; omit when opinion is NOT_INTERESTED. ${show}: ${labelledOptions(CHANGE_MOTIVATORS, L.changeMotivatorLabels)}.` },
        },
        required: ['situation'],
      },
      pricing: {
        type: 'object',
        description: 'The two rates the web asks for, in euros: your concrete estimate from role, seniority, stack and location. Plain numbers, no thousands separators. Send both when you can.',
        properties: {
          hourlyRate: { type: 'number', description: `Euros per hour (e.g. 45), at most ${MAX_HOURLY_RATE}.` },
          annualRate: { type: 'number', description: `Target euros per year (e.g. 60000), at least ${MIN_ANNUAL_RATE}.` },
        },
      },
      availability: {
        type: 'object',
        description: 'Availability AND location (there is no separate location field).',
        properties: {
          available: { type: 'boolean' },
          monthlyHours: { type: 'string', enum: MONTHLY_HOURS, description: "Exactly one of the enum values ('> 160' verbatim, with the space)." },
          workModes: { type: 'array', items: { type: 'string', enum: WORK_MODES }, description: `Any subset of ${WORK_MODES.join('/')}.` },
          country: { type: 'string', description: 'ISO-2 country code (ES, US, GB).' },
          timezone: { type: 'string', description: 'IANA timezone (Europe/Madrid).' },
          subdivision: { type: 'string', description: 'Optional region code (ES-CT).' },
          longFullTimeProjects: { type: 'boolean' },
        },
      },
      languages: {
        type: 'array',
        description: `The FULL list of languages the talent speaks (bulk upsert). Languages: ${labelledOptions(LANGUAGE_CODES, L.languageNames)}. Levels: ${labelledOptions(LANGUAGE_LEVELS, L.languageLevelLabels)}.`,
        items: {
          type: 'object',
          properties: {
            language: { type: 'string', enum: LANGUAGE_CODES },
            level: { type: 'string', enum: LANGUAGE_LEVELS },
          },
          required: ['language', 'level'],
        },
      },
      phone: {
        type: 'object',
        description: 'Only a phone the talent gave or that is on their CV.',
        properties: {
          telephoneCode: { type: 'string', description: "International code, e.g. '+34'." },
          telephoneNumber: { type: 'string' },
        },
        required: ['telephoneCode', 'telephoneNumber'],
      },
    },
  };
}

const WELCOME_SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', description: "ISO code of the language the talent wrote their first message in (es, en, it, pt...). It fixes the language of every sign-up text from here on." },
    firstName: { type: 'string', description: 'Only if you already know it: the welcome greets them by name.' },
    shown: { type: 'boolean', description: 'true only after you showed relayVerbatim from the previous call: it then asks the question in a dialog.' },
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
  },
  required: ['language'],
};

const EMAIL_SCHEMA = {
  type: 'object',
  properties: {
    email: { type: 'string', description: 'The best email you know for the talent (CV first, then what they told you). Omit it when you know none.' },
    typed: { type: 'boolean', description: 'true when `email` is the one the talent just wrote in answer to the email question: it is taken as is.' },
    shown: { type: 'boolean' },
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
  },
};

const DRAFT_SCHEMA = {
  type: 'object',
  description: 'Your draft of the profile, from the CV, LinkedIn and what you know. Every field is shown as you write it, in the talent\'s language.',
  properties: {
    name: { type: 'string', description: 'Full name.' },
    role: { type: 'string', description: 'Role, e.g. "Data Engineer".' },
    city: { type: 'string' },
    yearsOfExperience: { type: 'number' },
    stack: { type: 'string', description: 'Main technologies, comma separated, at most five.' },
    languages: { type: 'string', description: 'Languages and level, e.g. "Español nativo, inglés C1".' },
    workMode: { type: 'string', description: 'Remote, hybrid or on site, in the talent\'s language.' },
    monthlyHours: { type: 'string', description: `Hours a month they can work: one of ${MONTHLY_HOURS.join(', ')}.` },
    hourlyRate: { type: 'number', description: `Your estimate in euros per hour (part-time projects), at most ${MAX_HOURLY_RATE}.` },
    annualRate: { type: 'number', description: `Your estimate in euros per year (full-time projects), at least ${MIN_ANNUAL_RATE}.` },
    shown: { type: 'boolean' },
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
  },
};

const CREATE_SCHEMA = {
  type: 'object',
  properties: {
    windowAnnounced: { type: 'boolean', description: 'true only after you showed the talent, word for word, the text announcing the window (signup_draft returns it).' },
    linkedinUrl: { type: 'string', description: 'The talent\'s LinkedIn profile URL (linkedin.com/in/<slug>, never /in/me).' },
    cvPath: { type: 'string', description: 'Path of the talent\'s own CV on this machine (from read_cv / suggest_register_context, ~/ form is fine). Only a PDF is uploaded at sign-up.' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    userQuery: { type: 'string', description: 'EVERYTHING you know about the talent as free text (max 20000 chars): roles, projects, stack, education, languages, location, what they want next, and the CV text when the CV was only attached in the chat.' },
  },
};

const STATUS_SCHEMA = {
  type: 'object',
  properties: {
    waitSeconds: { type: 'number', description: `Wait up to this many seconds (max ${MAX_WAIT_SECONDS}) for the account or the import to change before answering.` },
    windowLink: { type: 'boolean', description: 'true only when the talent says the sign-up window did not open: returns the text with its link.' },
  },
};

const UPDATE_EXISTING_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
  },
};

const IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    linkedinUrl: { type: 'string' },
    cvPath: { type: 'string', description: 'Path of the talent\'s own CV on this machine (PDF, DOC or DOCX, max 10 MB).' },
    githubUrl: { type: 'string' },
    websiteUrl: { type: 'string' },
    userQuery: { type: 'string', description: 'Everything you know about the talent, as free text.' },
    language: { type: 'string', enum: [...IMPORT_LANGUAGES] },
  },
};

function defaultSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Hub's sign-up takes the CV only as a PDF; anything else travels as text in userQuery and is imported after sign-up.
function readSignupCv(cvPath) {
  return readLocalCv(cvPath, { extensions: ['.pdf'], badFormat: 'cv-not-pdf' });
}

let currentSignup = null;

// Whether a sign-up window opened by this process is still waiting for the talent.
function isSignupPending() {
  return signupPhase() === 'waiting';
}

// Where this process's sign-up stands: ai_usage is offered only once the account exists.
function signupPhase() {
  const account = currentSignup ? currentSignup.account.state : 'not-started';
  if (account === 'waiting') return 'waiting';
  return account === 'created' || account === 'existing' ? 'account' : 'none';
}

function makeSignupTools(deps = {}) {
  const lang = () => signupLanguage(deps.lang || 'en');
  const copy = () => signupCopy(lang());
  const flow = require('./onboarding-flow');
  const resolved = flow.makeDeps(deps.flowDeps || {});
  const config = require('./config');
  const {
    requestMcpSignup = require('./mcp-signup-client').requestMcpSignup,
    requestMyImportStatus = require('./mcp-signup-client').requestMyImportStatus,
    requestOneTimeToken = require('./mcp-signup-client').requestOneTimeToken,
    getMcpSignupEndpoint = config.getMcpSignupEndpoint,
    getMyImportStatusEndpoint = config.getMyImportStatusEndpoint,
    getOneTimeTokenEndpoint = config.getOneTimeTokenEndpoint,
    getOneTimeLoginUrl = config.getOneTimeLoginUrl,
    getDeviceAuthorizeEndpoint = config.getDeviceAuthorizeEndpoint,
    getDeviceTokenEndpoint = config.getDeviceTokenEndpoint,
    getAuthTokenEndpoint = config.getAuthTokenEndpoint,
    getCompleteRegistrationEndpoint = config.getCompleteRegistrationEndpoint,
    startDeviceLogin = require('./device-login').startDeviceLogin,
    pollDeviceToken = require('./device-login').pollDeviceToken,
    finalizeDeviceSession = require('./device-login').finalizeDeviceSession,
    appendProviderParam = require('./device-login').appendProviderParam,
    buildRegistrationContext = require('./signup-client').buildRegistrationContext,
    runLoopbackAuth = require('./mcp-auth-form').runLoopbackAuth,
    checkOnboardingCompleted = require('./onboarding-availability').checkOnboardingCompleted,
    fetchPricingRate = (opts) => require('./rate-client').fetchPricingRate({}, opts),
    fetchAvailability = (opts) => require('./availability-client').fetchAvailability({}, opts),
    openBrowser = require('./open-file').openPath,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = deps;

  const state = {
    claimCode: null,
    windowUrl: null,
    windowOpenFailed: false,
    sessionToken: null,
    email: null,
    draft: null,
    draftConfirmed: false,
    sources: null,
    account: { state: 'not-started' },
    reported: { account: null, import: null },
    wake: null,
  };
  currentSignup = state;

  function setAccount(next) {
    state.account = next;
    if (state.wake) state.wake();
  }

  function changed() {
    return new Promise((resolve) => { state.wake = resolve; });
  }

  function openSoon(url, onFailed = () => {}) {
    sleep(BROWSER_OPEN_DELAY_MS).then(() => { if (openBrowser(url) === false) onFailed(); }).catch(onFailed);
  }

  // Background device flow behind the window's Google button; the claim code is read when it finalizes.
  async function finishGoogle(authz, tokenEndpoint, authTokenEndpoint) {
    let interval = authz.interval;
    const deadline = now() + authz.expiresIn * 1000;
    while (now() < deadline) {
      await sleep(interval * 1000);
      const res = await pollDeviceToken({ deviceCode: authz.deviceCode, tokenEndpoint });
      if (res.status === 'pending') continue;
      if (res.status === 'slow_down') { interval += 5; continue; }
      if (res.status !== 'authorized') {
        setAccount({ state: 'failed', reason: res.status === 'denied' || res.status === 'expired' ? `google-${res.status}` : (res.reason || 'google-failed') });
        return;
      }
      const fin = await finalizeDeviceSession({
        sessionToken: res.accessToken,
        isNewUser: res.isNewUser,
        authTokenEndpoint,
        completeRegistrationEndpoint: getCompleteRegistrationEndpoint(),
        registrationContext: buildRegistrationContext({ preferredLanguage: lang(), newsletterConsent: false, freelanceType: 'POTENTIAL_FREELANCE' }),
        claimCode: res.isNewUser ? state.claimCode : null,
      });
      if (!fin.ok) {
        setAccount({ state: 'failed', reason: fin.reason });
        return;
      }
      const email = res.email || emailFromHubToken(fin.token);
      try {
        resolved.saveAuthSession({ accessToken: fin.token, hubAccessToken: fin.token, email });
      } catch {
        setAccount({ state: 'failed', reason: 'session-persist-failed' });
        return;
      }
      state.sessionToken = res.accessToken;
      setAccount(res.isNewUser
        ? { state: 'created', via: 'google', email, claimed: fin.claimed === true }
        : { state: 'existing', via: 'google', email });
      return;
    }
    setAccount({ state: 'failed', reason: 'google-expired' });
  }

  async function onGoogle() {
    const authorizeEndpoint = getDeviceAuthorizeEndpoint();
    const tokenEndpoint = getDeviceTokenEndpoint();
    const authTokenEndpoint = getAuthTokenEndpoint();
    if (!authorizeEndpoint || !tokenEndpoint || !authTokenEndpoint) return { ok: false, reason: 'no-endpoint' };
    const authz = await startDeviceLogin({ authorizeEndpoint });
    if (!authz.ok) return { ok: false, reason: authz.reason || 'authorize-failed' };
    finishGoogle(authz, tokenEndpoint, authTokenEndpoint).catch(() => setAccount({ state: 'failed', reason: 'google-failed' }));
    return { ok: true, url: appendProviderParam(authz.verificationUriComplete, 'google') };
  }

  function openWindow(identity) {
    setAccount({ state: 'waiting' });
    let announce;
    const announced = new Promise((resolve) => { announce = resolve; });
    runLoopbackAuth(
      {
        mode: 'register',
        deps: resolved,
        lang: lang(),
        registerFields: {
          email: identity.email,
          name: identity.firstName,
          lastName: identity.lastName,
          preferredLanguage: lang(),
          claimCode: () => state.claimCode,
        },
      },
      {
        timeoutMs: SIGNUP_WINDOW_TIMEOUT_MS,
        openBrowser: (url) => openSoon(url, () => { state.windowOpenFailed = true; }),
        onGoogle,
        onUrl: (url) => { state.windowUrl = url; announce(url); },
      },
    ).then((outcome) => {
      if (outcome && outcome.viaSocial) return;
      if (!outcome || !outcome.ok) {
        setAccount({ state: 'failed', reason: (outcome && outcome.reason) || 'window-failed' });
        return;
      }
      setAccount(outcome.accountExists
        ? { state: 'existing', via: 'email', email: outcome.email }
        : { state: 'created', via: 'email', email: outcome.email, claimed: outcome.claimed === true });
    }, () => setAccount({ state: 'failed', reason: 'window-failed' }));
    return Promise.race([announced, sleep(2000).then(() => state.windowUrl)]);
  }

  // Step 1: welcome, value proposal, the three steps and one question (may I look for your CV here?).
  async function signupStart(args = {}, ctx = {}) {
    if (args.shown !== true && !nonEmpty(args.answer)) {
      fixSignupLanguage(args.language);
      state.draft = null;
      state.draftConfirmed = false;
      state.email = null;
    }
    const c = copy();
    const asked = await askAfterTexts(ctx, {
      tool: 'signup_start',
      texts: [c.welcome(nonEmpty(args.firstName))],
      question: c.welcomeQuestion,
      options: [c.cvSearch, c.cvAttach],
      shown: args.shown,
      answer: args.answer,
    });
    if (asked.reply) return { ...asked.reply, language: lang() };
    const linkedin = `LinkedIn: use the URL in the CV (read_cv returns links.linkedin). Only if it has none, ask \`linkedinAsk\` word for word; only if they say they do not know where to find it, say \`linkedinOpening\` and call open_linkedin_profile. Then call signup_email.`;
    if (asked.answer === c.cvSearch) {
      return {
        ok: true,
        step: 'cv-search',
        cvNotFound: c.cvNotFound,
        linkedinAsk: c.linkedinAsk,
        linkedinOpening: c.linkedinOpening,
        message: `The talent allowed you to look for their CV: call suggest_register_context and read_cv on the most likely one without asking again. If there is none, show \`cvNotFound\` word for word and wait for the file. ${linkedin}`,
      };
    }
    return {
      ok: true,
      step: 'cv-attach',
      relayVerbatim: c.cvAttachAsk,
      linkedinAsk: c.linkedinAsk,
      linkedinOpening: c.linkedinOpening,
      message: `${VERBATIM} Then wait for the CV in the chat. ${linkedin}`,
    };
  }

  // Step 2: which email the account is created with, the one they read most; a company domain gets the work-email hint.
  async function signupEmail(args = {}, ctx = {}) {
    const c = copy();
    const email = nonEmpty(args.email);
    if (email && !EMAIL_RE.test(email)) return { ok: false, reason: 'invalid-email', relayVerbatim: c.emailUnknown, message: `That is not an email. ${VERBATIM} Then call signup_email with email set to what they write and typed:true.` };
    if (email && args.typed === true) {
      state.email = email;
      return { ok: true, email, next: 'signup_draft', message: 'Email set. Now show the profile draft with signup_draft.' };
    }
    if (!email) {
      return { ok: false, reason: 'email-required', relayVerbatim: c.emailUnknown, message: `${VERBATIM} It is the whole question. Then call signup_email with email set to what they write and typed:true.` };
    }
    const question = isPersonalEmail(email) ? c.emailKnown(email) : `${c.emailKnown(email)} ${c.emailWorkHint}`;
    const asked = await askAfterTexts(ctx, { tool: 'signup_email', texts: [], question, options: [c.emailYes, c.emailOther], answer: args.answer });
    if (asked.reply) return asked.reply;
    if (asked.answer === c.emailYes) {
      state.email = email;
      return { ok: true, email, next: 'signup_draft', message: 'Email set. Now show the profile draft with signup_draft.' };
    }
    return { ok: false, reason: 'email-required', relayVerbatim: c.emailUnknown, message: `${VERBATIM} Then call signup_email with email set to what they write and typed:true.` };
  }

  // Step 3: the draft of the profile and the data notice; the talent confirms it before the window opens.
  async function signupDraft(args = {}, ctx = {}) {
    const c = copy();
    const pricing = pricingFromRates(args);
    if (!pricing.ok) return pricing;
    const draft = {};
    for (const key of ['name', 'role', 'city', 'yearsOfExperience', 'stack', 'languages', 'workMode', 'monthlyHours', 'hourlyRate', 'annualRate']) {
      if (args[key] !== undefined && args[key] !== null && args[key] !== '') draft[key] = args[key];
    }
    if (!draft.name || !draft.role) return { ok: false, reason: 'draft-incomplete', message: 'The draft needs at least name and role: read the CV first.' };
    const asked = await askAfterTexts(ctx, {
      tool: 'signup_draft',
      texts: [renderDraft(lang(), draft), legalCopy(lang()).signupNotice],
      question: c.draftQuestion,
      options: [c.draftOk, c.draftChange],
      shown: args.shown,
      answer: args.answer,
    });
    if (asked.reply) return { ...asked.reply, message: `${asked.reply.message} Pass the same draft fields again.` };
    if (asked.answer === c.draftChange) {
      state.draftConfirmed = false;
      return { ok: false, reason: 'draft-change', message: 'Ask what they want to change in one short question, then call signup_draft again with the corrected fields.' };
    }
    state.draft = draft;
    state.draftConfirmed = true;
    return {
      ok: true,
      next: 'signup_create_account',
      relayVerbatim: c.windowOpening,
      message: `Confirmed. ${VERBATIM} Then call signup_create_account with windowAnnounced:true: the window opens a few seconds later.`,
    };
  }

  function signupFailureHelp(reason) {
    switch (reason) {
      case 'invalid-linkedin-url':
        return { message: INVALID_LINKEDIN_MESSAGE };
      case 'invalid-cv':
        return { message: 'Shakers could not read that CV as a PDF. Ask for another file, or continue with LinkedIn only.' };
      case 'missing-source':
        return { message: 'Sign-up needs the LinkedIn URL or a PDF CV.' };
      case 'rate-limited':
        return { message: 'Too many sign-ups from this network in the last hour. Ask the talent to try again later or register on the web.' };
      default:
        return { message: 'The sign-up could not start right now. Try again in a moment.' };
    }
  }

  // Step 4: hub starts the import into an UNREGISTERED profile and the window opens to create the account (or sign in).
  async function signupCreateAccount(args = {}) {
    const c = copy();
    if (!state.draftConfirmed) {
      return { ok: false, reason: 'draft-not-confirmed', message: 'Show the draft with signup_draft and get the talent\'s confirmation first.' };
    }
    if (args.windowAnnounced !== true) {
      return { ok: false, reason: 'window-not-announced', relayVerbatim: c.windowOpening, message: `${VERBATIM} Then call signup_create_account again with windowAnnounced:true.` };
    }
    const session = resolved.loadAuthSession();
    if (resolved.sessionStatus(session) === 'active' && state.account.state !== 'waiting') {
      return {
        ok: false,
        reason: 'already-signed-in',
        next: 'import_profile',
        message: 'This machine is already signed in to Shakers. If that account is the talent\'s, import their LinkedIn/CV into it with import_profile; if it is not, call logout and then signup_create_account again.',
      };
    }

    const sources = { linkedinUrl: nonEmpty(args.linkedinUrl), cvPath: nonEmpty(args.cvPath), userQuery: nonEmpty(args.userQuery) };
    if (sources.linkedinUrl && !isLinkedinProfileUrl(sources.linkedinUrl)) return { ok: false, reason: 'invalid-linkedin-url', message: INVALID_LINKEDIN_MESSAGE };
    let cv = null;
    let cvNote = null;
    if (sources.cvPath) {
      const read = readSignupCv(sources.cvPath);
      if (read.ok) cv = read.file;
      else if (read.reason === 'cv-not-pdf') cvNote = 'The CV is not a PDF, so it was not uploaded now: make sure its text is in userQuery, and once the account exists import the file with import_profile.';
      else return { ok: false, reason: read.reason, message: 'That CV could not be read. Ask the talent to check the file, or continue with LinkedIn and what you know.' };
    }
    if (!sources.linkedinUrl && !cv) {
      return { ok: false, reason: 'missing-source', linkedinAsk: c.linkedinAsk, message: 'Sign-up needs the LinkedIn URL or a PDF CV: ask `linkedinAsk` word for word.' };
    }

    const identity = { email: state.email, firstName: nonEmpty(args.firstName), lastName: nonEmpty(args.lastName) };
    const language = IMPORT_LANGUAGES.has(lang()) ? lang() : 'en';
    const res = await requestMcpSignup(
      { linkedinUrl: sources.linkedinUrl, cv, ...identity, userQuery: sources.userQuery, language },
      { endpoint: getMcpSignupEndpoint() },
    );
    if (!res.ok) return { ok: false, reason: res.reason, ...signupFailureHelp(res.reason) };

    state.claimCode = res.claimCode;
    state.sources = sources;
    state.reported = { account: 'waiting', import: 'none' };
    const reused = state.account.state === 'waiting';
    if (!reused) await openWindow(identity);
    return {
      ok: true,
      status: 'window-open',
      ...(cvNote ? { cvNote } : {}),
      next: 'signup_status',
      message: (reused ? 'The sign-up window was already open; it now uses the new data. ' : 'The window opens in the talent\'s browser in a few seconds: they create the account with Google or a password there, or sign in if they already have one. ')
        + 'Say nothing more about it. Only if they say it did not open, call signup_status with windowLink:true. Call signup_status (waitSeconds 20) until the account exists.',
    };
  }

  async function readImport() {
    // An account that already existed got no import from this sign-up: its last import is not news.
    if (state.account.state === 'existing') return { state: 'none' };
    const session = resolved.loadAuthSession();
    if (resolved.sessionStatus(session) !== 'active' || !session || !session.hubAccessToken) return { state: 'none' };
    const res = await requestMyImportStatus({ hubAccessToken: session.hubAccessToken }, { endpoint: getMyImportStatusEndpoint() });
    return res.ok ? { state: res.state, sources: res.sources, ...(res.code ? { code: res.code } : {}) } : { state: 'unknown', reason: res.reason };
  }

  function nextSteps(account) {
    const interview = 'Then the onboarding interview: if onboardingInterview.completed is true do not offer it; otherwise call onboarding_interview_start without disclaimerAcknowledged (it asks here now or later on the web). Then, also if they skip it, the main role: list_my_roles (waitSeconds 20) and set_main_role without clusterId. Finally open_web.';
    const aiUsage = 'Then ai_usage without consent: it returns the two AI-usage disclaimers and the question (show them right before asking; no scan happens before a yes).';
    if (account.state === 'existing') {
      return `This talent already had an account and signed in. Call update_existing_profile: it shows what would change and asks whether to update. ${aiUsage} ${interview}`;
    }
    const unclaimed = account.claimed === false ? ' This account did not take over the imported profile: call import_profile with the same LinkedIn/CV first.' : '';
    return `The account exists.${unclaimed} Now, without asking: save_profile_details with the confirmed draft (situation, motivation, both rates, availability and location, languages). ${aiUsage} ${interview}`;
  }

  function guidance(account, imp) {
    const lines = [];
    const linkedin = imp.sources && imp.sources.linkedin;
    if (linkedin && linkedin.state === 'failed') {
      lines.push('The LinkedIn import failed. Tell the talent once, without codes, and check the URL with them; retry once with import_profile; if it fails again, ask for their website or GitHub and send them with import_profile.');
    }
    if (account.state === 'waiting') lines.push('The talent is still in the sign-up window. Call signup_status again.');
    if (account.state === 'failed') lines.push('The sign-up window ended without an account. Ask the talent whether to try again; signup_create_account reopens it.');
    if (account.state === 'created' || account.state === 'existing') lines.push(nextSteps(account));
    return lines.join(' ');
  }

  async function signupStatus(args = {}) {
    if (state.account.state === 'not-started') {
      return { ok: false, reason: 'no-signup', message: 'No sign-up was started in this session: follow signup_start.' };
    }
    const waitMs = Math.min(Math.max(Number(args.waitSeconds) || 0, 0), MAX_WAIT_SECONDS) * 1000;
    const deadline = now() + waitMs;
    let imp = await readImport();
    const fresh = () => state.account.state !== state.reported.account || imp.state !== state.reported.import;
    while (now() < deadline && !fresh()) {
      await Promise.race([changed(), sleep(Math.min(IMPORT_POLL_MS, Math.max(deadline - now(), 0)))]);
      imp = await readImport();
    }
    state.reported = { account: state.account.state, import: imp.state };

    const account = { ...state.account };
    const out = { ok: true, account, import: imp };
    if (account.state === 'waiting' && (args.windowLink === true || state.windowOpenFailed) && state.windowUrl) {
      out.relayVerbatim = copy().windowLink(state.windowUrl);
    }
    if (account.state === 'created' || account.state === 'existing') {
      let completed = null;
      try { completed = await checkOnboardingCompleted({}); } catch { completed = null; }
      out.onboardingInterview = { completed };
    }
    out.message = [out.relayVerbatim ? VERBATIM : '', guidance(account, imp)].filter(Boolean).join(' ');
    return out;
  }

  async function importProfile(args = {}) {
    if (nonEmpty(args.linkedinUrl) && !isLinkedinProfileUrl(nonEmpty(args.linkedinUrl))) return { ok: false, reason: 'invalid-linkedin-url', message: INVALID_LINKEDIN_MESSAGE };
    const res = await flow.startProfileImport(resolved, {
      linkedinUrl: nonEmpty(args.linkedinUrl),
      cvPath: nonEmpty(args.cvPath),
      githubUrl: nonEmpty(args.githubUrl),
      websiteUrl: nonEmpty(args.websiteUrl),
      userQuery: nonEmpty(args.userQuery),
      language: IMPORT_LANGUAGES.has(args.language) ? args.language : (IMPORT_LANGUAGES.has(lang()) ? lang() : 'en'),
      fillEmptyOnly: true,
    });
    if (!res.ok) {
      if (res.reason === 'no-session') {
        return { ok: false, reason: isSignupPending() ? 'signup-pending' : 'no-session', message: isSignupPending() ? 'The account does not exist yet: wait for signup_status to report it.' : 'The talent is not signed in: use login first.' };
      }
      return { ok: false, reason: res.reason };
    }
    const failed = res.report ? res.report.sources.filter((src) => src.status === 'failed') : [];
    return {
      ok: true,
      report: res.report,
      message: failed.length
        ? `Imported, except: ${failed.map((src) => src.source).join(', ')}. Tell the talent which source did not come through, without codes.`
        : 'Imported. Existing texts and languages were kept; lists were added without duplicates.',
    };
  }

  function money(value, unit) {
    return value === null || value === undefined ? copy().existingEmpty : `${amount(lang(), value)} ${unit}`;
  }

  // What the confirmed draft would change in an existing profile: the rates and hours it overwrites, plus the import that only adds.
  async function existingDiff() {
    const c = copy();
    const draft = state.draft || {};
    const session = resolved.loadAuthSession();
    const hubAccessToken = session && session.hubAccessToken;
    const [rate, availability] = await Promise.all([
      fetchPricingRate({ hubAccessToken }).catch(() => ({ ok: false })),
      fetchAvailability({ hubAccessToken }).catch(() => ({ ok: false })),
    ]);
    const lines = [];
    const pricing = rate && rate.ok ? rate.pricing : null;
    const currentHourly = pricing && pricing.partTimePrice ? pricing.partTimePrice.amount : null;
    const currentAnnual = pricing && pricing.fullTimePrice ? pricing.fullTimePrice.amount : null;
    if (draft.hourlyRate !== undefined && Number(draft.hourlyRate) !== currentHourly) lines.push(c.existingRate(money(currentHourly, c.perHour), money(draft.hourlyRate, c.perHour)));
    if (draft.annualRate !== undefined && Number(draft.annualRate) !== currentAnnual) lines.push(c.existingAnnual(money(currentAnnual, c.perYear), money(draft.annualRate, c.perYear)));
    const currentHours = availability && availability.ok && availability.availability ? availability.availability.monthlyHours : null;
    if (draft.monthlyHours !== undefined && String(draft.monthlyHours) !== String(currentHours)) {
      lines.push(c.existingHours(currentHours ? c.hours(currentHours) : c.existingEmpty, c.hours(draft.monthlyHours)));
    }
    lines.push(c.existingLists);
    return `${c.existingTitle}\n\n${lines.map((l) => `· ${l}`).join('\n')}`;
  }

  // Existing account: after signing in, the talent sees what would change and decides whether to update.
  async function updateExistingProfile(args = {}, ctx = {}) {
    const c = copy();
    const session = resolved.loadAuthSession();
    if (resolved.sessionStatus(session) !== 'active') return { ok: false, reason: 'no-session', message: 'The talent is not signed in yet: wait for signup_status.' };
    const question = await existingDiff();
    const asked = await askAfterTexts(ctx, { tool: 'update_existing_profile', texts: [], question, options: [c.existingYes, c.existingNo], answer: args.answer });
    if (asked.reply) return asked.reply;
    if (asked.answer === c.existingNo) {
      return { ok: true, updated: false, relayVerbatim: c.existingKept, message: `${VERBATIM} Do not save the draft. Carry on with ai_usage.` };
    }
    const sources = state.sources || {};
    const imported = sources.linkedinUrl || sources.cvPath || sources.userQuery ? await importProfile(sources) : { ok: true };
    return {
      ok: true,
      updated: true,
      import: imported,
      message: `${imported.ok ? '' : 'The import did not go through; carry on anyway. '}Now save_profile_details with the confirmed draft, without asking. Then ai_usage without consent.`,
    };
  }

  async function savePricing(rates) {
    const mapped = pricingFromRates(rates);
    return mapped.ok ? flow.savePricing(resolved, mapped.input) : mapped;
  }

  function ratesSaved(rates) {
    if (!rates || typeof rates !== 'object') return null;
    const c = copy();
    const shown = [];
    if (rates.hourlyRate != null && rates.hourlyRate !== '') shown.push(`${c.hourlyRateLabel}: ${money(rates.hourlyRate, c.perHour)}`);
    if (rates.annualRate != null && rates.annualRate !== '') shown.push(`${c.annualRateLabel}: ${money(rates.annualRate, c.perYear)}`);
    return c.ratesSaved(shown);
  }

  async function saveProfileDetails(args = {}) {
    const { saved } = copy();
    const sections = [
      ['workSituation', args.workSituation, (v) => flow.saveWorkSituation(resolved, v), saved.workSituation],
      ['pricing', args.pricing, savePricing, ratesSaved(args.pricing)],
      ['availability', args.availability, (v) => flow.saveAvailability(resolved, v), saved.availability],
      ['languages', Array.isArray(args.languages) && args.languages.length ? args.languages : null, (v) => flow.saveLanguages(resolved, v), saved.languages],
      ['phone', args.phone, (v) => flow.savePhone(resolved, v), saved.phone],
    ];
    const results = {};
    const confirmations = [];
    for (const [name, value, save, saved] of sections) {
      if (!value || typeof value !== 'object') continue;
      const res = await save(value);
      if (res.ok) confirmations.push(saved);
      if (!res.ok && res.reason === 'no-session') return { ok: false, reason: 'no-session', message: 'The talent is not signed in yet.' };
      results[name] = res.ok ? { ok: true } : { ok: false, reason: res.reason, ...(res.message ? { message: res.message } : {}) };
    }
    return { ok: Object.values(results).every((r) => r.ok), results, confirmations };
  }

  async function openWeb(args = {}) {
    const session = resolved.loadAuthSession();
    const cookie = session && resolved.sessionStatus(session) === 'active' ? session.cookie || null : null;
    let url = null;
    if (cookie || state.sessionToken) {
      const minted = await requestOneTimeToken({ cookie, sessionToken: state.sessionToken }, { endpoint: getOneTimeTokenEndpoint() });
      if (minted.ok) url = getOneTimeLoginUrl(minted.token);
    }
    const loggedIn = !!url;
    if (!url) url = flow.profileUrl(resolved);
    if (!url) return { ok: false, reason: 'no-endpoint' };
    // The address reaches the AI only when the talent needs a link: the AI comments on hosts it sees.
    const opened = args.open !== false && openBrowser(url) !== false;
    if (opened) {
      return {
        ok: true,
        opened: true,
        loggedIn,
        message: (loggedIn ? 'Shakers opened in the talent\'s browser, signed in.' : 'Shakers opened in the talent\'s browser at the sign-in page; they sign in there.')
          + ' If they say it did not open, call open_web with open:false and give them its link.',
      };
    }
    return {
      ok: true,
      opened: false,
      loggedIn,
      link: url,
      message: 'Give the talent `link` to click, with no comment on the address.' + (loggedIn ? ' It works once, for 2 minutes.' : ''),
    };
  }

  function openLinkedinProfile() {
    openSoon(LINKEDIN_SELF_URL);
    return {
      ok: true,
      url: LINKEDIN_SELF_URL,
      relayVerbatim: copy().linkedinOpened,
      message: `${VERBATIM} The browser opens in a few seconds. If they say it did not open, give \`url\` as a link. When they paste the URL, check it is linkedin.com/in/<slug> (not /in/me, a feed or a search) and ask once more if not.`,
    };
  }

  return [
    {
      name: 'signup_start',
      description: "FIRST call when the talent asks to sign up or register on Shakers, before you write anything: pass `language` = the language of their message. It returns the welcome to show word for word and its one question (may I look for your CV on this computer?). Then follow its message: CV, LinkedIn, signup_email, signup_draft, signup_create_account, signup_status. Every text it and the next sign-up tools return in relayVerbatim is shown word for word, in that language.",
      inputSchema: WELCOME_SCHEMA,
      handler: signupStart,
    },
    {
      name: 'signup_email',
      description: 'Sign-up step after the CV and LinkedIn: asks which email to create the account with (the one they read most). Pass the best email you know, or none. Never comment on the email yourself.',
      inputSchema: EMAIL_SCHEMA,
      handler: signupEmail,
    },
    {
      name: 'signup_draft',
      description: 'Sign-up step before the account: shows the talent the profile draft you prepared from their CV, LinkedIn and what you know, with the data notice, and asks them to confirm it. The window to create the account opens only after they confirm.',
      inputSchema: DRAFT_SCHEMA,
      handler: signupDraft,
    },
    {
      name: 'signup_create_account',
      description: "After the talent confirmed the draft and you showed the window text word for word: starts the profile import on Shakers and, a few seconds later, opens a window in the talent's browser where they create the account with Google or a password, or sign in if they already have one. No password ever goes through the chat. Returns next: signup_status.",
      inputSchema: CREATE_SCHEMA,
      handler: signupCreateAccount,
    },
    {
      name: 'signup_status',
      description: "State of the sign-up: account (waiting | created | existing | failed) and, once it exists, the profile import per source (linkedin, cv: running | done | failed). Pass waitSeconds (up to 25) to wait for a change. Follow `message`: it gives the remaining steps. Never show internal codes to the talent.",
      inputSchema: STATUS_SCHEMA,
      handler: signupStatus,
    },
    {
      name: 'update_existing_profile',
      description: 'When signup_status says the talent already had an account: shows what the confirmed draft would change in their profile and asks whether to update it; on yes it imports their LinkedIn/CV filling only what is empty.',
      inputSchema: UPDATE_EXISTING_SCHEMA,
      handler: updateExistingProfile,
    },
    {
      name: 'import_profile',
      description: "Import LinkedIn, CV, GitHub or website into the SIGNED-IN talent's profile, filling only what is empty: existing texts and languages are kept, lists are added without duplicates. Use it when the sign-up import failed for a source, or for a non-PDF CV. Takes up to ~90 s.",
      inputSchema: IMPORT_SCHEMA,
      handler: importProfile,
    },
    {
      name: 'save_profile_details',
      description: "After the account exists, write the confirmed draft — work situation and motivation, hourly rate and annual target, availability and location, languages, phone — WITHOUT asking again: they can edit every field on the web. Each section is saved on its own; returns per-section results.",
      inputSchema: buildDetailsSchema(deps.lang || 'en'),
      handler: saveProfileDetails,
    },
    {
      name: 'open_web',
      description: "Open Shakers in the talent's browser already signed in (one-time link, valid 2 minutes, single use). Use it at the end of the sign-up, or when the onboarding interview has to be done on the web. Returns { opened, loggedIn }, plus `link` only when the browser was not opened.",
      inputSchema: { type: 'object', properties: { open: { type: 'boolean', description: 'false returns a fresh link without opening the browser: only when the talent says the browser did not open.' } } },
      handler: openWeb,
    },
    {
      name: 'open_linkedin_profile',
      description: "Open the talent's own LinkedIn profile in their browser (linkedin.com/in/me redirects to it) so they copy the address bar. Use it ONLY when the talent says they do not know where to find their LinkedIn URL, and only after showing them, word for word, the `linkedinOpening` text signup_start returned.",
      inputSchema: { type: 'object', properties: {} },
      handler: openLinkedinProfile,
    },
  ];
}

module.exports = { makeSignupTools, isSignupPending, signupPhase, readSignupCv, isPersonalEmail, WELCOME_SCHEMA, EMAIL_SCHEMA, DRAFT_SCHEMA, CREATE_SCHEMA, STATUS_SCHEMA, IMPORT_SCHEMA };
