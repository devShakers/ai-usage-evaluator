'use strict';

const {
  WORK_SITUATIONS, EMPLOYMENT_PARTICIPATIONS, FREELANCE_OPINIONS, CHANGE_MOTIVATORS,
  WORK_MODES, MONTHLY_HOURS, LANGUAGE_CODES, LANGUAGE_LEVELS,
} = require('./onboarding-flow');
const { signupCopy, legalCopy, renderDraft, amount } = require('./signup-copy');
const { fixSignupLanguage, signupLanguage } = require('./signup-language');
const path = require('path');
const { readLocalCv } = require('./cv-file');
const { emailFromHubToken } = require('./auth-session-store');
const { askAfterTexts, askConsent, optionFor, queueNotice, takeNotices } = require('./mcp-choice');
const { expandHome, tildify } = require('./env-paths');
const { NOOP_FUNNEL, weeklyHours, rateTypes, workSituationValue } = require('./onboarding-funnel');

// MCP sign-up: hub imports into an UNREGISTERED profile that the local window claims with a code kept only in memory.

const SIGNUP_WINDOW_TIMEOUT_MS = 15 * 60 * 1000;
// The browser opens this long after the tool answers, so the AI's reply is on screen first.
const BROWSER_OPEN_DELAY_MS = 4000;
// Each signup_status call holds up to this long waiting for a change, so a higher value means fewer calls
// (and fewer per-call approval prompts in the client) cover the same wait. Kept under the ~60 s hard cap
// Claude Desktop puts on a tool call (progress notifications do not extend it there), with margin for the
// round-trip.
const MAX_WAIT_SECONDS = 45;
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
// What the model must send instead when a work-situation section is refused.
const SECTION_HELP = {
  'bad-situation': 'workSituation.situation must be one of its enum codes.',
  'bad-participation': 'workSituation.participation (FULL_TIME or PART_TIME) is required when situation is EMPLOYED.',
  'bad-opinion': 'workSituation.opinion is required unless situation is FREELANCE: pick your best match from its enum.',
  'bad-motivation': 'workSituation.changeMotivators is required when situation is FREELANCE or opinion is WAS_FREELANCE_BEFORE or OPEN_TO_FREELANCE: pick your best match from its enum.',
};
// What the closing words may say about the profile import, by the state read at that moment.
const IMPORT_CLOSING = {
  done: 'The profile import finished: if you mention it, say it is done, never that it is pending.',
  running: 'The profile import is still running: if you mention it, say it finishes on its own in a few minutes.',
  failed: 'Say nothing more about the profile import than the fixed lines already shown.',
  none: 'Say nothing about the state of the profile import.',
};
const VERBATIM = 'Print relayVerbatim word for word now, as its own block, before any other tool call, with nothing of your own added to it.';

// Providers that serve the same personal mailboxes under many country domains (hotmail.co.uk, yahoo.com.br, outlook.it).
const PERSONAL_EMAIL_PROVIDERS = new Set(['gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'msn', 'yahoo', 'ymail', 'icloud', 'proton', 'protonmail', 'gmx', 'aol', 'zoho', 'tutanota', 'libero', 'virgilio', 'tiscali', 'sapo', 'yandex', 'fastmail', 'uol', 'bol', 'terra']);
// Reserved for documentation and tests (RFC 2606, RFC 6761): never anybody's employer.
const RESERVED_EMAIL_DOMAIN_RE = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/;

function emailDomain(email) {
  return String(email).split('@').pop().toLowerCase();
}

function isPersonalEmail(email) {
  const domain = emailDomain(email);
  return PERSONAL_EMAIL_DOMAINS.has(domain) || PERSONAL_EMAIL_PROVIDERS.has(domain.split('.')[0]);
}

// Only an address that looks like a company one gets the hint to prefer a personal email.
function looksLikeWorkEmail(email) {
  return !isPersonalEmail(email) && !RESERVED_EMAIL_DOMAIN_RE.test(emailDomain(email));
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
          opinion: { type: 'string', enum: FREELANCE_OPINIONS, description: `Opinion on freelancing. Required unless situation is FREELANCE. ${show}: ${labelledOptions(FREELANCE_OPINIONS, L.freelanceOpinionLabels)}.` },
          changeMotivators: { type: 'string', enum: CHANGE_MOTIVATORS, description: `Motivation, your best match. Required when situation is FREELANCE or opinion is WAS_FREELANCE_BEFORE or OPEN_TO_FREELANCE; omit it only when opinion is NOT_INTERESTED. ${show}: ${labelledOptions(CHANGE_MOTIVATORS, L.changeMotivatorLabels)}.` },
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
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
    cvPath: { type: 'string', description: 'When the talent\'s first message or answer already gives their CV as a path on this machine: that exact file is read, with no CV question, no search and no request for the file.' },
    linkedinMissing: { type: 'boolean', description: 'true only after read_cv, when the CV has no LinkedIn URL: returns the LinkedIn question to print as your whole reply.' },
  },
  required: ['language'],
};

const EMAIL_SCHEMA = {
  type: 'object',
  properties: {
    email: { type: 'string', description: 'The best email you know for the talent (CV first, then what they told you). Omit it when you know none.' },
    typed: { type: 'boolean', description: 'true when `email` is the one the talent just wrote in answer to the email question: it is taken as is.' },
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
  },
};

// In the order the data notice names them.
const DRAFT_SOURCES = ['linkedin', 'cv'];
const DRAFT_FIELDS = ['name', 'role', 'city', 'country', 'situation', 'participation', 'yearsOfExperience', 'stack', 'languages', 'workMode', 'monthlyHours', 'hourlyRate', 'annualRate'];
// Draft fields per funnel step, for was_edited.
const STEP_DRAFT_FIELDS = {
  work_situation: ['situation', 'participation'],
  availability: ['monthlyHours', 'workMode'],
  rates: ['hourlyRate', 'annualRate'],
  languages: ['languages'],
  location: ['country', 'city'],
};

const DRAFT_SCHEMA = {
  type: 'object',
  description: 'Your draft of the profile, from the CV, LinkedIn and what you know. Every field is shown as you write it, in the talent\'s language.',
  properties: {
    name: { type: 'string', description: 'Full name.' },
    role: { type: 'string', description: 'Role, e.g. "Data Engineer".' },
    city: { type: 'string' },
    country: { type: 'string', description: 'ISO-2 country code (ES, US, GB): the same country save_profile_details will write.' },
    situation: { type: 'string', enum: WORK_SITUATIONS, description: 'Current work situation, the same code save_profile_details will write.' },
    participation: { type: 'string', enum: EMPLOYMENT_PARTICIPATIONS, description: 'Only when situation is EMPLOYED.' },
    yearsOfExperience: { type: 'number' },
    stack: { type: 'string', description: 'Main technologies, comma separated, at most five.' },
    languages: { type: 'string', description: 'Languages and level, e.g. "Español nativo, inglés C1".' },
    workMode: { type: 'string', description: 'Remote, hybrid or on site, in the talent\'s language.' },
    monthlyHours: { type: 'string', description: `Hours a month they can work: one of ${MONTHLY_HOURS.join(', ')}.` },
    hourlyRate: { type: 'number', description: `Euros per hour (part-time projects), at most ${MAX_HOURLY_RATE}: the talent's figure, else your estimate from role, seniority, stack and location.` },
    annualRate: { type: 'number', description: `Euros per year (full-time projects), at least ${MIN_ANNUAL_RATE}: the talent's figure, else your estimate.` },
    ratesFromTalent: { type: 'boolean', description: 'true only when the talent gave you both rates; omit it when you estimated them (they are shown as your estimate).' },
    sources: { type: 'array', items: { type: 'string', enum: DRAFT_SOURCES }, description: "What the draft comes from: 'cv' when you read their CV, 'linkedin' only when you have their LinkedIn URL. The data notice names exactly these." },
    answer: { type: 'string', description: 'The option the talent picked when you asked the question in the chat.' },
  },
  required: ['name', 'role', 'hourlyRate', 'annualRate', 'sources'],
};

const CREATE_SCHEMA = {
  type: 'object',
  properties: {
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
    answer: { type: 'string', description: 'The option the talent picked when you printed the question this tool returned about the CV file. Never set it yourself.' },
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
    deviceSessionRecord = require('./device-login').deviceSessionRecord,
    buildRegistrationContext = require('./signup-client').buildRegistrationContext,
    runLoopbackAuth = require('./mcp-auth-form').runLoopbackAuth,
    checkOnboardingCompleted = require('./onboarding-availability').checkOnboardingCompleted,
    fetchPricingRate = (opts) => require('./rate-client').fetchPricingRate({}, opts),
    fetchAvailability = (opts) => require('./availability-client').fetchAvailability({}, opts),
    fetchLanguages = (opts) => require('./profile-client').fetchLanguages({}, opts),
    funnel = NOOP_FUNNEL,
    fetchTelephone = (opts) => require('./profile-client').fetchTelephone({}, opts),
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
    firstDraft: null,
    draftConfirmed: false,
    keepProfile: false,
    // Fields the update question already told the talent they keep.
    toldKept: new Set(),
    // The confirmed draft already said the account exists (this machine knew it).
    toldExisting: false,
    sources: null,
    account: { state: 'not-started' },
    reported: { account: null, import: null },
    failedSources: new Set(),
    cvPath: null,
    wake: null,
    importStartedAt: null,
    importReported: new Set(),
    authAttempts: undefined,
  };
  currentSignup = state;

  function setAccount(next) {
    const before = state.account.state;
    state.account = next;
    if ((next.state === 'created' || next.state === 'existing') && before !== next.state) {
      funnel.completed('account_creation', { auth_method: next.via, auth_attempts: state.authAttempts, is_returning_account: next.state === 'existing' });
      funnel.identified({ newAccount: next.state === 'created' });
    }
    if (next.state === 'failed' && before !== 'failed') {
      funnel.errored('account_creation', next.reason);
      funnel.flush();
    }
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
        resolved.saveAuthSession(deviceSessionRecord({ token: fin.token, sessionToken: res.accessToken, sessionExpiresIn: res.expiresIn, email }));
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
      if (outcome && outcome.ok) state.authAttempts = outcome.attempts;
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

  // Step 1: welcome, value proposal, the three steps and one question (send me your CV, or shall I look for it here?).
  async function signupStart(args = {}, ctx = {}) {
    // The LinkedIn question is a tool block, so a welcome still pending is read before it and the AI words nothing.
    if (args.linkedinMissing === true && !nonEmpty(args.answer)) {
      const c = copy();
      return {
        ok: true,
        step: 'linkedin-ask',
        say: [...takeNotices(), c.linkedinAsk].join('\n\n'),
        linkedinOpening: c.linkedinOpening,
        message: 'Print `say` word for word as your whole reply, with nothing of your own before or after it, and call no tool until the talent answers. With their URL, call signup_email. Only if they say they do not know where to find it, say `linkedinOpening` word for word and call open_linkedin_profile.',
      };
    }
    if (!nonEmpty(args.answer)) {
      fixSignupLanguage(args.language);
      funnel.begin();
      funnel.viewed('start');
      state.draft = null;
      state.firstDraft = null;
      state.importStartedAt = null;
      state.importReported = new Set();
      state.draftConfirmed = false;
      state.email = null;
      state.failedSources.clear();
      state.toldKept = new Set();
      state.toldExisting = false;
      state.cvPath = null;
      takeNotices();
    }
    if (nonEmpty(args.cvPath)) state.cvPath = nonEmpty(args.cvPath);
    const c = copy();
    const linkedin = 'LinkedIn: use the URL in the CV (read_cv returns links.linkedin) and call signup_email. Only if the CV has none, call signup_start with linkedinMissing:true: it returns the LinkedIn question to print. Never ask for LinkedIn in your own words.';
    // A CV path in the first message already answers the CV question: that CV is read, and the welcome
    // rides on the next question block, because models skip a relay that comes before another tool call.
    if (!nonEmpty(args.answer) && state.cvPath) {
      funnel.completed('start');
      funnel.viewed('import_sources', { sources_offered: DRAFT_SOURCES });
      queueNotice(c.welcome(nonEmpty(args.firstName)));
      return {
        ok: true,
        step: 'cv-given',
        cvPath: state.cvPath,
        language: lang(),
        message: `Never explain to the talent what you are doing or what the CV holds: every text they read in this step comes from the tools, the welcome included. Now call read_cv with cvPath: it asks the talent itself before reading the file, so ask nothing about the CV in your own words. ${linkedin}`,
      };
    }
    const asked = await askAfterTexts(ctx, {
      tool: 'signup_start',
      texts: [c.welcome(nonEmpty(args.firstName))],
      question: c.welcomeQuestion,
      options: [c.cvAttach, c.cvSearch],
      answer: args.answer,
    });
    if (asked.reply) return { ...asked.reply, language: lang() };
    funnel.completed('start');
    funnel.viewed('import_sources', { sources_offered: DRAFT_SOURCES });
    // A CV path the talent gave wins over both answers: searching could read another candidate.
    const cvPath = state.cvPath;
    if (cvPath) {
      return {
        ok: true,
        step: 'cv-given',
        cvPath,
        message: `The talent already gave their CV: call read_cv with cvPath now (it asks the talent itself before reading the file), saying nothing about attaching it. ${linkedin}`,
      };
    }
    if (asked.answer === c.cvSearch) {
      return {
        ok: true,
        step: 'cv-search',
        cvNotFound: c.cvNotFound,
        message: `The talent chose to look for their CV on this computer: call suggest_register_context, then read_cv on its first candidate, even when nameMatch is null (their name is just unknown). Each of them asks the talent itself before searching or reading, so ask nothing in your own words. Only if there is no candidate, or every one comes back mentionsTalent:false, show \`cvNotFound\` word for word and wait for the file. ${linkedin}`,
      };
    }
    return {
      ok: true,
      step: 'cv-attach',
      relayVerbatim: c.cvAttachAsk,
      message: `If their message already holds the CV (attached, pasted or as a path), do not print relayVerbatim: use that CV. Otherwise ${VERBATIM} Then wait for the CV in the chat. ${linkedin}`,
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
    const question = looksLikeWorkEmail(email) ? `${c.emailKnown(email)} ${c.emailWorkHint}` : c.emailKnown(email);
    const asked = await askAfterTexts(ctx, { tool: 'signup_email', texts: [], question, options: [c.emailYes, c.emailOther], answer: args.answer });
    if (asked.reply) return asked.reply;
    if (asked.answer === c.emailYes) {
      state.email = email;
      return { ok: true, email, next: 'signup_draft', message: 'Email set. Now show the profile draft with signup_draft.' };
    }
    return { ok: false, reason: 'email-required', relayVerbatim: c.emailUnknown, message: `${VERBATIM} Then call signup_email with email set to what they write and typed:true.` };
  }

  // A session this machine kept for the same email means the account exists, so the window will ask to sign in.
  function knownAccount() {
    const stored = resolved.loadAuthSession();
    const email = stored && typeof stored.email === 'string' ? stored.email.toLowerCase() : null;
    return !!email && !!state.email && email === state.email.toLowerCase();
  }

  // Step 3: the draft, the data notice and how the window works; confirming it is what opens the window.
  async function signupDraft(args = {}, ctx = {}) {
    const c = copy();
    const pricing = pricingFromRates(args);
    if (!pricing.ok) return pricing;
    const draft = {};
    for (const key of DRAFT_FIELDS) {
      if (args[key] !== undefined && args[key] !== null && args[key] !== '') draft[key] = args[key];
    }
    if (typeof draft.country === 'string') draft.country = draft.country.trim().toUpperCase();
    if (!draft.name || !draft.role) return { ok: false, reason: 'draft-incomplete', message: 'The draft needs at least name and role: read the CV first.' };
    if (draft.hourlyRate === undefined || draft.annualRate === undefined) {
      return { ok: false, reason: 'draft-rates-required', message: 'The draft needs both rates: if the talent gave them, send them with ratesFromTalent:true; otherwise estimate hourlyRate (€/h) and annualRate (€/year) from role, seniority, stack and location, and send them without it. Then call signup_draft again.' };
    }
    if (args.ratesFromTalent === true) draft.ratesFromTalent = true;
    const sources = Array.isArray(args.sources) ? DRAFT_SOURCES.filter((s) => args.sources.includes(s)) : [];
    // A confirmation of the printed block stands even if the model drops sources on the answer call.
    if (!sources.length && !optionFor(args.answer, [c.draftOk, c.draftChange])) {
      return { ok: false, reason: 'draft-sources-required', message: "The draft needs sources: 'cv' if you read their CV, 'linkedin' only if you have their LinkedIn URL. Then call signup_draft again." };
    }
    if (!state.firstDraft) state.firstDraft = draft;
    trackDraftShown(draft);
    const asked = await askAfterTexts(ctx, {
      tool: 'signup_draft',
      texts: [renderDraft(lang(), draft), legalCopy(lang()).signupNotice(sources), knownAccount() ? c.windowNoticeSignIn : c.windowNotice],
      question: c.draftQuestion,
      options: [c.draftOk, c.draftChange],
      answer: args.answer,
    });
    if (asked.reply) return { ...asked.reply, message: `${asked.reply.message} Pass the same draft fields again.` };
    if (asked.answer === c.draftChange) {
      state.draftConfirmed = false;
      return { ok: false, reason: 'draft-change', message: 'Ask what they want to change in one short question, then call signup_draft again with the corrected fields.' };
    }
    state.draft = draft;
    state.draftConfirmed = true;
    state.toldExisting = knownAccount();
    return {
      ok: true,
      next: 'signup_create_account',
      message: 'Confirmed. Call signup_create_account now: the talent already read how the window works, so say nothing before it.',
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
    if (!state.importStartedAt) {
      const attempted = DRAFT_SOURCES.filter((source) => (source === 'cv' ? !!cv : !!sources.linkedinUrl));
      state.importStartedAt = Object.fromEntries(attempted.map((source) => [source, now()]));
      for (const source of attempted) funnel.track('source_import_started', 'import_sources', { source_type: source });
      funnel.completed('import_sources', { sources_attempted: attempted, sources_connected: attempted, sources_connected_count: attempted.length });
    }
    if (!reused) {
      funnel.viewed('account_creation', { auth_methods_offered: require('./mcp-auth-form').WINDOW_METHODS.register });
      await openWindow(identity);
    }
    return {
      ok: true,
      status: 'window-open',
      ...(cvNote ? { cvNote } : {}),
      next: 'signup_status',
      message: (reused ? 'The sign-up window was already open; it now uses the new data. ' : 'The window opens in the talent\'s browser in a few seconds; they read how it works in the draft they confirmed. ')
        + 'Say nothing about the window. Only if they say it did not open, call signup_status with windowLink:true. Now call signup_status (waitSeconds 45) until the account exists.',
    };
  }

  function trackImportOutcome(imp) {
    if (!state.importStartedAt) return;
    let tracked = false;
    for (const [source, startedAt] of Object.entries(state.importStartedAt)) {
      if (state.importReported.has(source)) continue;
      const outcome = imp.sources && imp.sources[source] ? imp.sources[source].state : (imp.state === 'failed' ? 'failed' : null);
      if (outcome !== 'done' && outcome !== 'failed') continue;
      state.importReported.add(source);
      const code = imp.sources && imp.sources[source] && imp.sources[source].code ? imp.sources[source].code : imp.code;
      funnel.track(outcome === 'done' ? 'source_import_completed' : 'source_import_failed', 'import_sources', {
        source_type: source,
        duration_ms: Math.max(0, now() - startedAt),
        ...(outcome === 'failed' && code ? { failure_reason: code } : {}),
      });
      tracked = true;
    }
    if (tracked) funnel.flush();
  }

  async function readImport() {
    // An account that already existed got no import from this sign-up: its last import is not news.
    if (state.account.state === 'existing') return { state: 'none' };
    const session = resolved.loadAuthSession();
    if (resolved.sessionStatus(session) !== 'active' || !session || !session.hubAccessToken) return { state: 'none' };
    const res = await requestMyImportStatus({ hubAccessToken: session.hubAccessToken }, { endpoint: getMyImportStatusEndpoint() });
    if (!res.ok) return { state: 'unknown', reason: res.reason };
    const imp = { state: res.state, sources: res.sources, ...(res.code ? { code: res.code } : {}) };
    trackImportOutcome(imp);
    return imp;
  }

  function nextSteps(account) {
    const interview = 'Then the onboarding interview: if onboardingInterview.completed is true, skip it without mentioning it; otherwise call onboarding_interview_start without disclaimerAcknowledged (it asks here now or later on the web). Then, also if they skip it, the main role: list_my_roles (waitSeconds 45), then set_main_role without clusterId only when its next says so. Finally open_web.';
    const aiUsage = 'Then ai_usage without consent: it returns the two AI-usage disclaimers and the question (show them right before asking; no scan happens before a yes). After a yes, ai_usage_upload (waitSeconds 30) shows the talent what would be sent and asks; nothing is uploaded without their pick.';
    if (account.state === 'existing') {
      return `This talent already had an account and signed in. Call update_existing_profile: it shows what would change and asks whether to update, and its text tells the talent about the account, so say nothing about it yourself. ${aiUsage} ${interview}`;
    }
    const unclaimed = account.claimed === false ? ' This account did not take over the imported profile: call import_profile with the same LinkedIn/CV first.' : '';
    return `The account exists.${unclaimed} Now, without asking: save_profile_details with the confirmed draft (situation, motivation, both rates, availability and location with its country, languages). ${aiUsage} ${interview}`;
  }

  // A source that did not import gets its fixed line once, on the next question block.
  function noticeFailed(sources) {
    const fresh = sources.filter((s) => !state.failedSources.has(s));
    fresh.forEach((s) => state.failedSources.add(s));
    const c = copy();
    if (fresh.length) queueNotice(c.importFailed(fresh.map((s) => c.importSources[s] || s)));
    return fresh.length > 0;
  }

  function guidance(account, imp) {
    const lines = [];
    const linkedin = imp.sources && imp.sources.linkedin;
    if (linkedin && linkedin.state === 'failed') {
      noticeFailed(['linkedin']);
      lines.push('The LinkedIn import failed. Its fixed line for the talent comes with the next question: do not add your own, never with codes; retry once with import_profile; if it fails again, ask for their website or GitHub and send them with import_profile.');
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

  // The tool: a CV file from this computer is sent only after the talent says yes to that file.
  async function importProfileAsked(args = {}, ctx = {}) {
    if (nonEmpty(args.cvPath)) {
      const file = path.resolve(expandHome(nonEmpty(args.cvPath)));
      const c = copy().consent;
      const asked = await askConsent(ctx, { tool: 'import_profile', key: `import_profile:${file}`, question: c.cvSend(tildify(file)), yes: c.yes, no: c.no, answer: args.answer });
      if (asked.reply) return asked.reply;
      if (!asked.granted) return { ok: false, reason: 'consent-declined', message: 'The talent said no: nothing was sent. Do not send that file; call import_profile again without cvPath if the other sources still need importing.' };
      return importProfile({ ...args, cvPath: file });
    }
    return importProfile(args);
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
        return { ok: false, reason: isSignupPending() ? 'signup-pending' : 'no-session', message: isSignupPending() ? 'The account does not exist yet: wait for signup_status to report it.' : 'The talent is not signed in: sign them in with social_signin_start first.' };
      }
      return { ok: false, reason: res.reason };
    }
    const failed = res.report ? res.report.sources.filter((src) => src.status === 'failed').map((src) => src.source) : [];
    noticeFailed(failed);
    return {
      ok: true,
      report: res.report,
      message: failed.length
        ? `Imported, except: ${failed.join(', ')}. Its fixed line for the talent comes with the next question: do not add your own, never with codes.`
        : 'Imported. Existing texts and languages were kept; lists were added without duplicates.',
    };
  }

  function money(value, unit) {
    return value === null || value === undefined ? copy().existingEmpty : `${amount(lang(), value)} ${unit}`;
  }

  // The existing profile as far as it can be read; a field that could not be read counts as set, so it is never overwritten.
  async function currentProfile() {
    const session = resolved.loadAuthSession();
    const hubAccessToken = session && session.hubAccessToken;
    const [rate, availability, languages] = await Promise.all([
      fetchPricingRate({ hubAccessToken }).catch(() => ({ ok: false })),
      fetchAvailability({ hubAccessToken }).catch(() => ({ ok: false })),
      fetchLanguages({ hubAccessToken }).catch(() => ({ ok: false })),
    ]);
    const pricing = rate && rate.ok ? rate.pricing || {} : null;
    // An unselected rate may keep an old amount: only a selected one counts as set.
    const amountOf = (selected, price) => (selected === true && price && typeof price.amount === 'number' ? price.amount : null);
    return {
      pricing: pricing && { hourly: amountOf(pricing.partTimeSelected, pricing.partTimePrice), annual: amountOf(pricing.fullTimeSelected, pricing.fullTimePrice) },
      availability: availability && availability.ok ? availability.availability || {} : null,
      languageCount: languages && languages.ok ? languages.languageCount : null,
    };
  }

  // Fill-empty only: per draft field, what it fills or the value the profile keeps, plus the import that only adds.
  async function existingDiff() {
    const c = copy();
    const draft = state.draft || {};
    const current = await currentProfile();
    const lines = [];
    const kept = new Set();
    const has = (v) => v !== undefined && v !== null && v !== '';
    // An unreadable section (undefined) counts as set, as fillEmpty never writes it.
    const field = (key, now, filled, label, shown) => {
      if (!has(draft[key])) return;
      if (now === null) { lines.push(filled); return; }
      kept.add(key);
      lines.push(c.existingStays(label, now === undefined ? null : shown(now), shown(draft[key])));
    };
    const pricing = current.pricing || { hourly: undefined, annual: undefined };
    const hours = current.availability ? (has(current.availability.monthlyHours) ? current.availability.monthlyHours : null) : undefined;
    field('hourlyRate', pricing.hourly, c.existingRate(c.existingEmpty, money(draft.hourlyRate, c.perHour)), c.hourlyRateLabel, (v) => money(v, c.perHour));
    field('annualRate', pricing.annual, c.existingAnnual(c.existingEmpty, money(draft.annualRate, c.perYear)), c.annualRateLabel, (v) => money(v, c.perYear));
    field('monthlyHours', hours, c.existingHours(c.existingEmpty, c.hours(draft.monthlyHours)), c.keptLabels.availability, (v) => c.hours(v));
    if (has(draft.languages) && current.languageCount !== 0) { kept.add('languages'); lines.push(c.existingStays(c.keptLabels.languages)); }
    if (kept.size) lines.push(c.existingStaysNote);
    state.toldKept = kept;
    const given = state.sources ? [state.sources.linkedinUrl && 'linkedin', state.sources.cvPath && 'cv'].filter(Boolean) : [];
    if (given.length) lines.push(c.existingLists(given));
    return `${state.toldExisting ? c.existingUpdateQuestion : c.existingTitle}\n\n${lines.map((l) => `· ${l}`).join('\n')}`;
  }

  // The sections of save_profile_details an existing profile can take (only fields it leaves empty), and what it keeps instead.
  async function fillEmpty(details) {
    const current = await currentProfile();
    const out = {};
    const kept = {};
    const has = (v) => v !== undefined && v !== null && v !== '';
    const keep = (section, key, value, requested) => { kept[section] = { ...kept[section], [key]: { kept: value, requested } }; };
    const p = details.pricing;
    if (p && typeof p === 'object') {
      const now = current.pricing || { hourly: undefined, annual: undefined };
      for (const [key, field] of [['hourlyRate', 'hourly'], ['annualRate', 'annual']]) {
        if (has(p[key]) && now[field] !== null) keep('pricing', key, now[field] ?? null, p[key]);
      }
      const fills = current.pricing && ((current.pricing.hourly === null && has(p.hourlyRate)) || (current.pricing.annual === null && has(p.annualRate)));
      if (fills) out.pricing = { hourlyRate: current.pricing.hourly ?? p.hourlyRate, annualRate: current.pricing.annual ?? p.annualRate };
    }
    const a = details.availability;
    if (a && typeof a === 'object') {
      const now = current.availability;
      const empty = (key) => !!now && (key === 'workModes' ? !(Array.isArray(now.workModes) && now.workModes.length) : !has(now[key]));
      const given = Object.entries(a).filter(([, value]) => has(value));
      given.filter(([key]) => !empty(key)).forEach(([key, value]) => keep('availability', key, now ? now[key] ?? null : null, value));
      const filled = Object.fromEntries(given.filter(([key]) => empty(key)));
      if (Object.keys(filled).length) out.availability = filled;
    }
    if (Array.isArray(details.languages) && details.languages.length) {
      if (current.languageCount === 0) out.languages = details.languages;
      else kept.languages = { kept: current.languageCount, requested: details.languages.length };
    }
    for (const section of ['workSituation', 'phone']) if (details[section] && typeof details[section] === 'object') kept[section] = { kept: null, requested: details[section] };
    return { details: out, kept };
  }

  // What the existing profile kept, for the model per field and for the talent as one fixed line without what the update question already told.
  function keptReport(kept) {
    const c = copy();
    const fields = [];
    const items = [];
    const told = (key) => state.toldKept.has(key);
    if (kept.workSituation) { fields.push('workSituation: not changed (the profile keeps what it had)'); items.push(c.keptLabels.workSituation); }
    for (const [key, label, unit] of [['hourlyRate', c.hourlyRateLabel, c.perHour], ['annualRate', c.annualRateLabel, c.perYear]]) {
      const k = kept.pricing && kept.pricing[key];
      if (!k) continue;
      fields.push(k.kept === null ? `${key}: not changed (the profile keeps what it had, not ${k.requested})` : `${key}: kept existing value ${k.kept} (not changed, not ${k.requested})`);
      if (!told(key)) items.push(k.kept === null ? label : `${label}: ${money(k.kept, unit)}`);
    }
    for (const [key, k] of Object.entries(kept.availability || {})) {
      fields.push(k.kept === null ? `${key}: not changed (the profile keeps what it had)` : `${key}: kept existing value ${Array.isArray(k.kept) ? k.kept.join('/') : k.kept} (not changed, not ${Array.isArray(k.requested) ? k.requested.join('/') : k.requested})`);
    }
    const hours = kept.availability && kept.availability.monthlyHours;
    if (hours && !told('monthlyHours')) items.push(hours.kept === null ? c.keptLabels.availability : `${c.keptLabels.availability}: ${c.hours(hours.kept)}`);
    if (kept.languages) { fields.push('languages: not changed (the profile already had languages)'); if (!told('languages')) items.push(c.keptLabels.languages); }
    if (kept.phone) { fields.push('phone: not changed (the profile keeps what it had)'); items.push(c.keptLabels.phone); }
    return { fields, line: items.length ? c.existingUnchanged(items) : null };
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
      state.keepProfile = true;
      return { ok: true, updated: false, relayVerbatim: c.existingKept, message: `${VERBATIM} Do not save the draft. Carry on with ai_usage.` };
    }
    state.keepProfile = false;
    const sources = state.sources || {};
    const imported = sources.linkedinUrl || sources.cvPath || sources.userQuery ? await importProfile(sources) : { ok: true };
    return {
      ok: true,
      updated: true,
      import: imported,
      message: `${imported.ok ? '' : 'The import did not go through; carry on anyway. '}Now save_profile_details with the confirmed draft, without asking: it only fills what the profile leaves empty. Then ai_usage without consent.`,
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
    return c.ratesSaved(shown, !(state.draft && state.draft.ratesFromTalent));
  }

  function trackDraftShown(draft) {
    const prefilled = (step) => ({ is_prefilled: STEP_DRAFT_FIELDS[step].some((key) => draft[key] !== undefined) });
    funnel.viewed('work_situation', prefilled('work_situation'));
    funnel.viewed('availability', prefilled('availability'));
    funnel.viewed('rates', { suggested_rate_shown: draft.ratesFromTalent !== true });
    funnel.viewed('languages', prefilled('languages'));
    funnel.viewed('location', prefilled('location'));
    funnel.viewed('profile_summary');
  }

  function draftFieldsEdited() {
    if (!state.firstDraft || !state.draft) return undefined;
    return DRAFT_FIELDS.filter((key) => String(state.firstDraft[key] ?? '') !== String(state.draft[key] ?? '')).length;
  }

  function wasEdited(step) {
    if (!state.firstDraft || !state.draft) return undefined;
    return STEP_DRAFT_FIELDS[step].some((key) => String(state.firstDraft[key] ?? '') !== String(state.draft[key] ?? ''));
  }

  function trackSavedSteps(details, results) {
    const saved = (section) => results[section] && results[section].ok === true;
    const draftTime = funnel.stepTime('profile_summary');
    const step = (name, props) => funnel.completed(name, { ...props, is_prefilled: true, was_edited: wasEdited(name), time_on_step_ms: draftTime });
    if (saved('workSituation')) {
      step('work_situation', { work_situation: workSituationValue(String(details.workSituation.situation || '').trim().toUpperCase()) });
    }
    if (saved('availability')) {
      const a = details.availability;
      step('availability', { availability_hours_per_week: weeklyHours(a.monthlyHours) });
      const country = typeof a.country === 'string' && /^[A-Za-z]{2}$/.test(a.country.trim()) ? a.country.trim().toUpperCase() : null;
      const proposed = state.firstDraft && state.firstDraft.country;
      const modes = Array.isArray(a.workModes) ? a.workModes.map((m) => String(m).toUpperCase()) : [];
      step('location', {
        location_country: country ? country.toLowerCase() : undefined,
        location_method: country && proposed === country ? 'prefilled' : 'manual',
        is_remote_only: modes.length ? modes.every((m) => m === 'REMOTE') : undefined,
      });
    }
    if (saved('pricing')) {
      const types = rateTypes(pricingFromRates(details.pricing).input);
      funnel.completed('rates', { rate_types_selected: types, rate_type: types[0], rate_currency: 'EUR', is_prefilled: !(state.draft && state.draft.ratesFromTalent), was_edited: wasEdited('rates'), time_on_step_ms: draftTime });
    }
    if (saved('languages')) {
      const codes = details.languages.map((row) => String(row.language || '').trim().toLowerCase()).filter(Boolean);
      step('languages', { languages_count: codes.length, languages: codes });
    }
    const sections = Object.entries(results).filter(([name]) => name !== 'phone');
    if (sections.length && sections.every(([, r]) => r.ok === true)) {
      funnel.completed('profile_summary', { fields_edited_count: draftFieldsEdited(), time_on_step_ms: draftTime });
    }
    funnel.flush();
  }

  async function saveProfileDetails(args = {}) {
    const { saved } = copy();
    const existing = state.account.state === 'existing';
    if (existing && state.keepProfile) return { ok: true, kept: true, results: {}, confirmations: [], message: 'The talent chose to keep their profile as it is: nothing was saved.' };
    // An existing profile only takes what it leaves empty; the work situation and the phone cannot be read, so they are never written there.
    const { details, kept } = existing ? await fillEmpty(args) : { details: args, kept: {} };
    const keptPricing = kept.pricing || {};
    const shownPricing = details.pricing && Object.fromEntries(Object.entries(details.pricing).filter(([key]) => !keptPricing[key]));
    const sections = [
      ['workSituation', details.workSituation, (v) => flow.saveWorkSituation(resolved, v), saved.workSituation],
      ['pricing', details.pricing, savePricing, ratesSaved(shownPricing)],
      ['availability', details.availability, (v) => flow.saveAvailability(resolved, v), saved.availability],
      ['languages', Array.isArray(details.languages) && details.languages.length ? details.languages : null, (v) => flow.saveLanguages(resolved, v), saved.languages],
      ['phone', details.phone, (v) => flow.savePhone(resolved, v), saved.phone],
    ].filter(([, value]) => value && typeof value === 'object');
    // Hub's async profile-completion recalculation saves the whole users row from a copy it read earlier, so a
    // phone written while it runs comes back NULL: the phone goes first, and is read back once the rest is saved.
    const phoneFirst = [...sections.filter(([name]) => name === 'phone'), ...sections.filter(([name]) => name !== 'phone')];
    const results = {};
    for (const [name, value, save] of phoneFirst) {
      const res = await save(value);
      if (!res.ok && res.reason === 'no-session') return { ok: false, reason: 'no-session', message: 'The talent is not signed in yet.' };
      const help = res.message || SECTION_HELP[res.reason];
      results[name] = res.ok ? { ok: true } : { ok: false, reason: res.reason, ...(help ? { message: help } : {}) };
    }
    if (results.phone && results.phone.ok) {
      const session = resolved.loadAuthSession();
      const stored = await fetchTelephone({ hubAccessToken: session && session.hubAccessToken }).catch(() => ({ ok: false }));
      if (stored.ok && !stored.telephone) {
        const again = await flow.savePhone(resolved, details.phone);
        results.phone = again.ok ? { ok: true } : { ok: false, reason: again.reason };
      }
    }
    trackSavedSteps(details, results);
    const confirmations = sections.filter(([name]) => results[name] && results[name].ok).map(([, , , text]) => text);
    const ok = Object.values(results).every((r) => r.ok);
    const report = keptReport(kept);
    if (report.line) queueNotice(report.line);
    const messages = [
      ok ? '' : 'Some sections were not saved: fix each one as its message says and call save_profile_details again with only those sections. Never show the talent these reasons.',
      report.fields.length ? `This account already existed, so these values were NOT saved: ${report.fields.join('; ')}. Never tell the talent they were saved; the fixed line saying so comes with the next question.` : '',
    ].filter(Boolean);
    return {
      ok,
      results,
      confirmations,
      ...(report.fields.length ? { kept } : {}),
      ...(messages.length ? { message: messages.join(' ') } : {}),
    };
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
    // Read right before the closing words, so they never state an import state that is already stale.
    const imp = await readImport();
    // A source that failed after the last signup_status gets its fixed line here, as there is no question left.
    const failed = DRAFT_SOURCES.filter((s) => imp.sources && imp.sources[s] && imp.sources[s].state === 'failed');
    noticeFailed(failed);
    // The flow ends here, so a fixed line no question carried is printed now.
    const unseen = takeNotices();
    const relay = unseen.length ? { relayVerbatim: unseen.join('\n\n') } : {};
    const importLine = failed.length
      ? `The import of ${failed.join(' and ')} failed and its fixed line is the only thing to say about it: never say or imply it was imported; if you mention the import, name only what did import.`
      : IMPORT_CLOSING[imp.state] || IMPORT_CLOSING.none;
    const where = opened
      ? `Shakers is open in their browser${loggedIn ? ', already signed in' : ' at the sign-in page, where they sign in'}`
      : `they open Shakers from \`link\` (give it to click, with no comment on the address${loggedIn ? '; it works once, for 2 minutes' : ''})`;
    const closing = `one short closing sentence of your own, in the talent's language, saying ${where}.`;
    const reply = unseen.length
      ? `Your reply has two parts and needs both: first relayVerbatim word for word as its own block, then ${closing}`
      : `End with ${closing}`;
    return {
      ok: true,
      opened,
      loggedIn,
      ...(opened ? {} : { link: url }),
      import: { state: imp.state },
      ...relay,
      message: `${reply}${opened ? ' If they say it did not open, call open_web with open:false and give them its link.' : ''} ${importLine}`,
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
      title: 'Start your Shakers sign-up',
      description: 'Starts your sign-up here in the chat and asks whether you send your CV or want it looked for on this computer.',
      guidance: "FIRST call when the talent asks to sign up or register on Shakers, before you write anything: pass `language` = the language of their message. It returns the welcome to show word for word and its one question (send me your CV, or shall I look for it on this computer?). Then follow its message: CV, LinkedIn, signup_email, signup_draft, signup_create_account, signup_status. Every text it and the next sign-up tools return in `say` or relayVerbatim is printed word for word, in that language.",
      inputSchema: WELCOME_SCHEMA,
      handler: signupStart,
    },
    {
      name: 'signup_email',
      title: 'Choose your account email',
      description: 'Asks which email your Shakers account will use.',
      guidance: 'Sign-up step after the CV and LinkedIn: asks which email to create the account with (the one they read most). Pass the best email you know, or none. Never comment on the email yourself.',
      inputSchema: EMAIL_SCHEMA,
      handler: signupEmail,
    },
    {
      name: 'signup_draft',
      title: 'Review your profile draft',
      description: 'Shows the profile draft prepared from your CV and LinkedIn, explains how your data is used and asks you to confirm it. Your account is not created until you confirm.',
      guidance: 'Sign-up step before the account: shows the talent the profile draft you prepared from their CV, LinkedIn and what you know, with the data notice and how the account window works, and asks them to confirm it. The window to create the account opens only after they confirm.',
      inputSchema: DRAFT_SCHEMA,
      handler: signupDraft,
    },
    {
      name: 'signup_create_account',
      title: 'Create your account',
      description: 'Once you confirm the draft, sends your CV, LinkedIn and draft to Shakers and opens a browser window where you create your account with Google or a password. Your password never goes through the chat.',
      guidance: "After the talent confirmed the draft: starts the profile import on Shakers and, a few seconds later, opens a window in the talent's browser where they create the account with Google or a password, or sign in if they already have one. No password ever goes through the chat. Returns next: signup_status.",
      inputSchema: CREATE_SCHEMA,
      handler: signupCreateAccount,
    },
    {
      name: 'signup_status',
      title: 'Sign-up progress',
      description: 'Shows whether your account is ready and how the import of your profile is going.',
      guidance: "State of the sign-up: account (waiting | created | existing | failed) and, once it exists, the profile import per source (linkedin, cv: running | done | failed). Pass waitSeconds (up to 45) to wait for a change; a high value means fewer calls cover the wait. Follow `message`: it gives the remaining steps. Never show internal codes to the talent.",
      inputSchema: STATUS_SCHEMA,
      annotations: { readOnlyHint: true },
      handler: signupStatus,
    },
    {
      name: 'update_existing_profile',
      title: 'Update your existing profile',
      description: 'If you already had an account, shows what your draft would add to the empty fields of your profile and asks before changing anything. It never overwrites what you already filled in.',
      guidance: 'When signup_status says the talent already had an account: shows what the confirmed draft would fill in the empty fields of their profile and the value each field they already had keeps, and asks whether to update it; on yes it imports their LinkedIn/CV filling only what is empty.',
      inputSchema: UPDATE_EXISTING_SCHEMA,
      handler: updateExistingProfile,
    },
    {
      name: 'import_profile',
      title: 'Import into your profile',
      description: 'Sends your LinkedIn, GitHub or website to Shakers to fill the empty parts of your profile, and a CV file from this computer only after asking you first. What you already wrote is kept.',
      guidance: "Import LinkedIn, CV, GitHub or website into the SIGNED-IN talent's profile, filling only what is empty: existing texts and languages are kept, lists are added without duplicates. Use it when the sign-up import failed for a source, or for a non-PDF CV. With cvPath the tool first asks the talent, naming the file (a dialog when the client has one, otherwise it returns `say` to print word for word as your whole reply); nothing is sent until they answer yes. After a `say`, call it again with the same arguments and answer set to the option they pick. Never answer for them. Takes up to ~90 s.",
      inputSchema: IMPORT_SCHEMA,
      handler: importProfileAsked,
    },
    {
      name: 'save_profile_details',
      title: 'Save your profile details',
      description: 'Saves the details you confirmed in your draft (work situation, rates, availability, location, languages and phone) to your Shakers profile. On an existing account it only fills empty fields.',
      guidance: "After the account exists, write the confirmed draft — work situation and motivation, hourly rate and annual target, availability and location, languages, phone — WITHOUT asking again: they can edit every field on the web. Each section is saved on its own; returns per-section results. On an account that already existed it only fills what the profile leaves empty, never overwrites a value the talent set.",
      inputSchema: buildDetailsSchema(deps.lang || 'en'),
      handler: saveProfileDetails,
    },
    {
      name: 'open_web',
      title: 'Open Shakers in your browser',
      description: 'Opens Shakers in your browser, already signed in.',
      guidance: "Open Shakers in the talent's browser already signed in (one-time link, valid 2 minutes, single use). Use it at the end of the sign-up, or when the onboarding interview has to be done on the web. Returns { opened, loggedIn }, plus `link` only when the browser was not opened.",
      inputSchema: { type: 'object', properties: { open: { type: 'boolean', description: 'false returns a fresh link without opening the browser: only when the talent says the browser did not open.' } } },
      handler: openWeb,
    },
    {
      name: 'open_linkedin_profile',
      title: 'Open your LinkedIn profile',
      description: 'Opens your own LinkedIn profile in your browser so you can copy its address.',
      guidance: "Open the talent's own LinkedIn profile in their browser (linkedin.com/in/me redirects to it) so they copy the address bar. Use it ONLY when the talent says they do not know where to find their LinkedIn URL, and only after showing them, word for word, the `linkedinOpening` text signup_start returned.",
      inputSchema: { type: 'object', properties: {} },
      handler: openLinkedinProfile,
    },
  ];
}

module.exports = { makeSignupTools, isSignupPending, signupPhase, readSignupCv, isPersonalEmail, looksLikeWorkEmail, WELCOME_SCHEMA, EMAIL_SCHEMA, DRAFT_SCHEMA, CREATE_SCHEMA, STATUS_SCHEMA, IMPORT_SCHEMA };
