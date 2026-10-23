'use strict';

const { NOOP_FUNNEL, sourceTypeFor, weeklyHours, rateTypes, workSituationValue } = require('./onboarding-funnel');

const FREELANCE_TYPES = ['FREELANCE', 'EMPLOYEE', 'AGENCY', 'POTENTIAL_FREELANCE'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];
const PRICE_MIN = 0;
const PRICE_MAX = 999999.99;
const MONTHLY_HOURS = ['40', '60', '80', '100', '120', '160', '> 160'];

const WORK_SITUATIONS = ['FREELANCE', 'EMPLOYED', 'BETWEEN_JOBS', 'STUDYING', 'OTHER'];
const EMPLOYMENT_PARTICIPATIONS = ['FULL_TIME', 'PART_TIME'];
const FREELANCE_OPINIONS = ['WAS_FREELANCE_BEFORE', 'OPEN_TO_FREELANCE', 'NOT_INTERESTED'];
const CHANGE_MOTIVATORS = ['HIGHER_RATE', 'SPECIFIC_PROJECT', 'LEARNING_CERTIFICATION', 'FLEXIBILITY', 'COMMUNITY', 'LIFESTYLE_CHANGE'];
// Work modes are combinable (multi-value array), mirroring the hub availability contract.
const WORK_MODES = ['REMOTE', 'HYBRID', 'IN_PERSON'];
const LANGUAGE_LEVELS = ['INTERMEDIATE_WRITTEN', 'INTERMEDIATE', 'ADVANCED', 'NATIVE'];
const LANGUAGE_CODES = ['es', 'en', 'fr', 'ca', 'de', 'eu', 'it', 'pt'];

// Success/confirmation line: green via io.success when available, plain notify otherwise.
function notifyOk(io, text) {
  (io.success ? io.success : io.notify).call(io, text);
}

function normalizeMonthlyHours(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return MONTHLY_HOURS.includes(s) ? s : null;
}

function normalizeCountry(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

function normalizeFreelanceType(value) {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return FREELANCE_TYPES.includes(upper) ? upper : null;
}

function freelanceIntentRequired(type) {
  return type === 'EMPLOYEE' || type === 'POTENTIAL_FREELANCE';
}

function deriveCurrentEmploymentStatus({ situation, participation } = {}) {
  if (situation === 'EMPLOYED') {
    if (participation === 'FULL_TIME') return 'IN_HOUSE_FULL_TIME';
    if (participation === 'PART_TIME') return 'IN_HOUSE_PART_TIME';
    return null;
  }
  return WORK_SITUATIONS.includes(situation) && situation !== 'EMPLOYED' ? situation : null;
}

function showsFreelanceOpinion(situation) {
  return WORK_SITUATIONS.includes(situation) && situation !== 'FREELANCE';
}

function deriveFreelanceIntent({ situation, opinion } = {}) {
  if (situation === 'FREELANCE') return 'ALREADY_FREELANCE';
  return FREELANCE_OPINIONS.includes(opinion) ? opinion : null;
}

function showsChangeMotivators(freelanceIntent) {
  return freelanceIntent === 'ALREADY_FREELANCE' || freelanceIntent === 'WAS_FREELANCE_BEFORE' || freelanceIntent === 'OPEN_TO_FREELANCE';
}

// The single freelanceType signal, derived from the work situation (asked once).
// AGENCY is not a work-situation option, so agencies map to FREELANCE (granularity lost, by decision).
const SITUATION_TO_FREELANCE_TYPE = {
  FREELANCE: 'FREELANCE',
  EMPLOYED: 'EMPLOYEE',
  BETWEEN_JOBS: 'POTENTIAL_FREELANCE',
  STUDYING: 'POTENTIAL_FREELANCE',
  OTHER: 'POTENTIAL_FREELANCE',
};

function deriveFreelanceTypeFromSituation(situation) {
  return SITUATION_TO_FREELANCE_TYPE[situation] || null;
}

// Transient default sent at signup (the account-creation DTO still requires
// freelanceType); the real value is set from the work situation right after.
const DEFAULT_SIGNUP_FREELANCE_TYPE = 'POTENTIAL_FREELANCE';

function validateWorkSituation(input = {}) {
  const situation = typeof input.situation === 'string' ? input.situation.trim().toUpperCase() : '';
  if (!WORK_SITUATIONS.includes(situation)) return { ok: false, reason: 'bad-situation' };

  let currentEmploymentStatus;
  if (situation === 'EMPLOYED') {
    const participation = typeof input.participation === 'string' ? input.participation.trim().toUpperCase() : '';
    if (!EMPLOYMENT_PARTICIPATIONS.includes(participation)) return { ok: false, reason: 'bad-participation' };
    currentEmploymentStatus = deriveCurrentEmploymentStatus({ situation, participation });
  } else {
    currentEmploymentStatus = deriveCurrentEmploymentStatus({ situation });
  }

  let freelanceIntent;
  if (situation === 'FREELANCE') {
    freelanceIntent = 'ALREADY_FREELANCE';
  } else {
    const opinion = typeof input.opinion === 'string' ? input.opinion.trim().toUpperCase() : '';
    if (!FREELANCE_OPINIONS.includes(opinion)) return { ok: false, reason: 'bad-opinion' };
    freelanceIntent = deriveFreelanceIntent({ situation, opinion });
  }

  const professionalDetails = { currentEmploymentStatus, freelanceIntent };
  const freelanceType = deriveFreelanceTypeFromSituation(situation);
  if (freelanceType) professionalDetails.freelanceType = freelanceType;
  if (showsChangeMotivators(freelanceIntent)) {
    const motivator = typeof input.changeMotivators === 'string' ? input.changeMotivators.trim().toUpperCase() : '';
    if (!CHANGE_MOTIVATORS.includes(motivator)) return { ok: false, reason: 'bad-motivation' };
    professionalDetails.changeMotivators = motivator;
  }
  return { ok: true, professionalDetails };
}

function validateLanguageRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'no-languages' };
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const language = typeof row.language === 'string' ? row.language.trim().toLowerCase() : '';
    const level = typeof row.level === 'string' ? row.level.trim().toUpperCase() : '';
    if (!language) return { ok: false, reason: 'bad-language' };
    if (!LANGUAGE_LEVELS.includes(level)) return { ok: false, reason: 'bad-level' };
    if (seen.has(language)) return { ok: false, reason: 'duplicate-language' };
    seen.add(language);
    out.push({ language, level });
  }
  return { ok: true, rows: out };
}

function validatePhone(input = {}) {
  const code = typeof input.telephoneCode === 'string' ? input.telephoneCode.trim() : '';
  const number = typeof input.telephoneNumber === 'string' ? input.telephoneNumber.trim() : '';
  if (!code || !number) return { ok: false, reason: 'missing-phone' };
  if (code.length > 10) return { ok: false, reason: 'bad-telephone-code' };
  if (number.length > 20) return { ok: false, reason: 'bad-telephone-number' };
  return { ok: true, telephoneCode: code, telephoneNumber: number };
}

function normalizeCurrency(value) {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return CURRENCIES.includes(upper) ? upper : null;
}

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

function normalizeAmount(value) {
  let n;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    n = value;
  } else if (typeof value === 'string') {
    const s = value.trim();
    if (!AMOUNT_RE.test(s)) return null;
    n = Number(s);
  } else {
    return null;
  }
  if (n < PRICE_MIN || n > PRICE_MAX) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents / 100;
}

// Pricing input.
function validatePricing(input = {}) {
  const fullSelected = input.fullTimeSelected === true;
  const partSelected = input.partTimeSelected === true;
  if (!fullSelected && !partSelected) return { ok: false, reason: 'no-variant' };

  const fullCurrency = normalizeCurrency(input.fullTimeCurrency);
  const partCurrency = normalizeCurrency(input.partTimeCurrency);
  const fallbackCurrency = fullCurrency || partCurrency || 'EUR';

  let fullAmount = normalizeAmount(input.fullTimeAmount);
  let partAmount = normalizeAmount(input.partTimeAmount);

  if (fullSelected) {
    if (fullAmount === null) return { ok: false, reason: 'bad-full-amount' };
    if (!fullCurrency) return { ok: false, reason: 'bad-full-currency' };
  }
  if (partSelected) {
    if (partAmount === null) return { ok: false, reason: 'bad-part-amount' };
    if (!partCurrency) return { ok: false, reason: 'bad-part-currency' };
  }

  return {
    ok: true,
    pricing: buildPricingUpsert({
      fullSelected,
      fullAmount: fullSelected ? fullAmount : (fullAmount === null ? 0 : fullAmount),
      fullCurrency: fullCurrency || fallbackCurrency,
      partSelected,
      partAmount: partSelected ? partAmount : (partAmount === null ? 0 : partAmount),
      partCurrency: partCurrency || fallbackCurrency,
    }),
  };
}

function buildPricingUpsert({ fullSelected, fullAmount, fullCurrency, partSelected, partAmount, partCurrency }) {
  return {
    fullTimeProjectSelected: fullSelected === true,
    fullTimeProjectPrice: { amount: fullAmount, currency: fullCurrency },
    partTimeProjectSelected: partSelected === true,
    partTimeProjectPrice: { amount: partAmount, currency: partCurrency },
  };
}

// Availability + location.
function validateAvailability(input = {}) {
  const body = { confirmed: true };
  if (typeof input.available === 'boolean') body.available = input.available;
  if (input.monthlyHours != null && input.monthlyHours !== '') {
    const mh = normalizeMonthlyHours(input.monthlyHours);
    if (!mh) return { ok: false, reason: 'bad-monthly-hours' };
    body.monthlyHours = mh;
  }
  // workModes is a multi-value array (REMOTE/HYBRID/IN_PERSON); onlyRemote is derived server-side and no longer sent.
  if (input.workModes != null) {
    if (!Array.isArray(input.workModes)) return { ok: false, reason: 'bad-work-modes' };
    const modes = [];
    for (const raw of input.workModes) {
      const mode = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
      if (!WORK_MODES.includes(mode)) return { ok: false, reason: 'bad-work-modes' };
      if (!modes.includes(mode)) modes.push(mode);
    }
    if (modes.length) body.workModes = modes;
  }
  if (input.country != null && input.country !== '') {
    const cc = normalizeCountry(input.country);
    if (!cc) return { ok: false, reason: 'bad-country' };
    body.country = cc;
  }
  if (typeof input.timezone === 'string' && input.timezone.trim()) body.timezone = input.timezone.trim().slice(0, 100);
  if (typeof input.subdivision === 'string' && input.subdivision.trim()) body.subdivision = input.subdivision.trim().slice(0, 10);
  if (typeof input.longFullTimeProjects === 'boolean') body.longFullTimeProjects = input.longFullTimeProjects;
  return { ok: true, availability: body };
}

function makeDeps(overrides = {}) {
  const config = require('./config');
  const client = require('./onboarding-client');
  const ai = require('./ai');
  const inventory = require('./inventory-client');
  const auth = require('./auth-session-store');
  const signup = require('./signup-client');
  const livekit = require('./onboarding-livekit-client');
  return {
    loadAuthSession: auth.loadAuthSession,
    sessionStatus: auth.sessionStatus,
    saveAuthSession: auth.saveAuthSession,
    ensureFreshSession: require('./session-refresh').ensureFreshSession,
    getCompleteRegistrationEndpoint: config.getCompleteRegistrationEndpoint,
    getAuthTokenEndpoint: config.getAuthTokenEndpoint,
    getDeviceAuthorizeEndpoint: config.getDeviceAuthorizeEndpoint,
    getDeviceTokenEndpoint: config.getDeviceTokenEndpoint,
    runDeviceLogin: require('./device-login').runDeviceLogin,
    requestCompleteRegistration: signup.requestCompleteRegistration,
    buildRegistrationContext: signup.buildRegistrationContext,
    buildRegistrationConsent: signup.buildRegistrationConsent,
    getImportProfileEndpoint: config.getImportProfileEndpoint,
    getProfessionalDetailsEndpoint: config.getProfessionalDetailsEndpoint,
    getPricingRateEndpoint: config.getPricingRateEndpoint,
    getSetAvailabilityEndpoint: config.getSetAvailabilityEndpoint,
    getLanguagesEndpoint: config.getLanguagesEndpoint,
    getLanguagesCatalogEndpoint: config.getLanguagesCatalogEndpoint,
    getTalentMeEndpoint: config.getTalentMeEndpoint,
    getOnboardingInterviewsEndpoint: config.getOnboardingInterviewsEndpoint,
    getCompleteOnboardingEndpoint: config.getCompleteOnboardingEndpoint,
    getTalentProfileUrl: config.getTalentProfileUrl,
    getUsageDiscoveredInventoryEndpoint: config.getUsageDiscoveredInventoryEndpoint,
    requestImportProfile: client.requestImportProfile,
    requestSetProfessionalDetails: client.requestSetProfessionalDetails,
    requestSetPricingRate: client.requestSetPricingRate,
    requestSetAvailability: client.requestSetAvailability,
    requestLanguagesCatalog: client.requestLanguagesCatalog,
    requestSetLanguages: client.requestSetLanguages,
    requestSetTalentPhone: client.requestSetTalentPhone,
    requestCreateOnboardingInterview: client.requestCreateOnboardingInterview,
    requestStartLivekitSession: livekit.requestStartOnboardingLivekitSession,
    requestCompleteLivekitSession: livekit.requestCompleteOnboardingLivekitSession,
    requestStartTextSession: ai.requestStartTextSession,
    requestOnboardingTurn: ai.requestOnboardingTurn,
    requestCompleteTextSession: ai.requestCompleteTextSession,
    requestCompleteOnboarding: client.requestCompleteOnboarding,
    getOnboardingRestartEndpoint: config.getOnboardingRestartEndpoint,
    requestRestartOnboardingInterview: client.requestRestartOnboardingInterview,
    // Final onboarding step: pick the main role (roles-flow.js).
    runMainRoleStep: require('./roles-flow').runOnboardingMainRoleStep,
    makeRolesDeps: require('./roles-flow').makeRolesDeps,
    requestDiscoveredInventory: inventory.requestDiscoveredInventory,
    // Used by reattachConsentIdentity (A) to re-anchor the ingest identity.
    recordConsent: require('./share-consent-state').recordConsent,
    ...overrides,
  };
}

async function requireActiveSession(deps) {
  const session = typeof deps.ensureFreshSession === 'function'
    ? await deps.ensureFreshSession(process.env, { loadAuthSession: deps.loadAuthSession, saveAuthSession: deps.saveAuthSession })
    : deps.loadAuthSession();
  if (deps.sessionStatus(session) !== 'active') {
    return { ok: false, reason: 'no-session' };
  }
  return { ok: true, session };
}

async function registerWithDeviceFlow(deps, { provider = 'email', freelanceType, language, newsletterConsent = false } = {}, { openBrowser, onAuthUrl } = {}) {
  const { withDeviceParams, deviceSessionRecord } = require('./device-login');
  const authorizeEndpoint = deps.getDeviceAuthorizeEndpoint();
  const tokenEndpoint = deps.getDeviceTokenEndpoint();
  const authTokenEndpoint = typeof deps.getAuthTokenEndpoint === 'function' ? deps.getAuthTokenEndpoint() : null;
  const completeRegistrationEndpoint = typeof deps.getCompleteRegistrationEndpoint === 'function' ? deps.getCompleteRegistrationEndpoint() : null;
  if (!authorizeEndpoint || !tokenEndpoint || !authTokenEndpoint) return { ok: false, reason: 'no-endpoint' };

  const registrationContext = deps.buildRegistrationContext({
    preferredLanguage: language,
    newsletterConsent: newsletterConsent === true,
    freelanceType: normalizeFreelanceType(freelanceType) || DEFAULT_SIGNUP_FREELANCE_TYPE,
  });
  const consent = deps.buildRegistrationConsent({ newsletterConsent: newsletterConsent === true });

  const result = await deps.runDeviceLogin(
    { authorizeEndpoint, tokenEndpoint, authTokenEndpoint, completeRegistrationEndpoint, registrationContext, consent },
    {
      onPrompt: ({ verificationUriComplete, userCode }) => {
        const url = withDeviceParams(verificationUriComplete, { provider, mode: 'register', surface: 'cli' });
        if (typeof onAuthUrl === 'function') onAuthUrl(url, userCode);
        if (typeof openBrowser === 'function') { try { openBrowser(url); } catch { /* printed URL covers it */ } }
      },
    },
  );
  if (!result.ok) return { ok: false, reason: result.reason || 'register-failed' };

  try {
    deps.saveAuthSession(deviceSessionRecord(result));
  } catch {
    return { ok: false, reason: 'session-persist-failed' };
  }

  return { ok: true, kind: result.isNewUser ? 'registered' : 'account-already-exists', email: result.email || null };
}

async function startProfileImport(deps, sources = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const endpoint = deps.getImportProfileEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return deps.requestImportProfile(
    { ...sources, accessToken: gate.session.accessToken, hubAccessToken: gate.session.hubAccessToken },
    { endpoint },
  );
}

// A: anchor the ingest identity to THIS talent's session email so a stale
// consent.json from a prior alta doesn't misattribute the footprint. Never throws.
function reattachConsentIdentity(deps) {
  if (typeof deps.recordConsent !== 'function') return { ok: false, reason: 'unsupported' };
  // Only needs the session EMAIL (no fresh JWT), so it stays sync and reads the
  // session directly rather than through the async refreshing gate.
  const session = deps.loadAuthSession();
  if (deps.sessionStatus(session) !== 'active') return { ok: false, reason: 'no-session' };
  const email = session && typeof session.email === 'string' ? session.email.trim() : '';
  if (!email) return { ok: false, reason: 'no-session-email' };
  try {
    deps.recordConsent('granted', email, { verified: true });
    return { ok: true, email };
  } catch (e) {
    return { ok: false, reason: 'record-failed', error: e && e.message };
  }
}

async function saveWorkSituation(deps, input = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const validated = validateWorkSituation(input);
  if (!validated.ok) return validated;
  const endpoint = deps.getProfessionalDetailsEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return deps.requestSetProfessionalDetails(
    { ...validated.professionalDetails, accessToken: gate.session.accessToken, hubAccessToken: gate.session.hubAccessToken },
    { endpoint },
  );
}

async function savePricing(deps, pricingInput = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const validated = validatePricing(pricingInput);
  if (!validated.ok) return validated;
  const endpoint = deps.getPricingRateEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return deps.requestSetPricingRate(
    { pricing: validated.pricing, accessToken: gate.session.accessToken, hubAccessToken: gate.session.hubAccessToken },
    { endpoint },
  );
}

async function saveAvailability(deps, availabilityInput = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const validated = validateAvailability(availabilityInput);
  if (!validated.ok) return validated;
  const endpoint = deps.getSetAvailabilityEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return deps.requestSetAvailability(
    { availability: validated.availability, accessToken: gate.session.accessToken, hubAccessToken: gate.session.hubAccessToken },
    { endpoint },
  );
}

async function saveLanguages(deps, rows) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const validated = validateLanguageRows(rows);
  if (!validated.ok) return validated;

  const catalogEndpoint = deps.getLanguagesCatalogEndpoint();
  if (!catalogEndpoint) return { ok: false, reason: 'no-endpoint' };
  const catalog = await deps.requestLanguagesCatalog({ hubAccessToken: gate.session.hubAccessToken }, { endpoint: catalogEndpoint });
  if (!catalog.ok) return { ok: false, reason: catalog.reason };

  const byCode = new Map();
  for (const entry of catalog.languages) {
    if (entry && typeof entry.code === 'string' && typeof entry.numId === 'number') {
      byCode.set(entry.code.toLowerCase(), entry.numId);
    }
  }

  const resolved = [];
  const unresolved = [];
  for (const row of validated.rows) {
    const id = byCode.get(row.language);
    if (id === undefined) unresolved.push(row.language);
    else resolved.push({ id, level: row.level });
  }
  if (unresolved.length > 0) return { ok: false, reason: 'unresolved-languages', unresolved };

  const endpoint = deps.getLanguagesEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return deps.requestSetLanguages(
    { languages: resolved, accessToken: gate.session.accessToken, hubAccessToken: gate.session.hubAccessToken },
    { endpoint },
  );
}

async function savePhone(deps, phoneInput = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const validated = validatePhone(phoneInput);
  if (!validated.ok) return validated;
  const endpoint = deps.getTalentMeEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return deps.requestSetTalentPhone(
    {
      telephoneCode: validated.telephoneCode,
      telephoneNumber: validated.telephoneNumber,
      accessToken: gate.session.accessToken,
      hubAccessToken: gate.session.hubAccessToken,
    },
    { endpoint },
  );
}

// Whether to OFFER step 4 (usage consent).
async function detectPriorUsage(deps) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return { ok: false, reason: 'no-session' };
  const endpoint = deps.getUsageDiscoveredInventoryEndpoint();
  if (!endpoint) return { ok: true, hasEvidence: null };
  const inv = await deps.requestDiscoveredInventory({ accessToken: gate.session.accessToken }, { endpoint });
  if (inv.ok) {
    const hasEvidence = (Array.isArray(inv.skills) && inv.skills.length > 0)
      || (Array.isArray(inv.agents) && inv.agents.length > 0);
    return { ok: true, hasEvidence };
  }
  if (inv.reason === 'no-inventory') return { ok: true, hasEvidence: false };
  return { ok: true, hasEvidence: null };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeJwtSub(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function candidateIdFor(deps, override) {
  if (typeof override === 'string' && UUID_RE.test(override)) return override;
  const session = deps.loadAuthSession();
  if (session && typeof session.userId === 'string' && UUID_RE.test(session.userId)) return session.userId;
  return session && session.accessToken ? decodeJwtSub(session.accessToken) : null;
}

async function createOnboardingInterview(deps, { candidateId } = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const base = deps.getOnboardingInterviewsEndpoint();
  if (!base) return { ok: false, reason: 'no-endpoint' };
  const id = candidateIdFor(deps, candidateId);
  if (!id) return { ok: false, reason: 'no-candidate' };
  return deps.requestCreateOnboardingInterview({ candidateId: id, accessToken: gate.session.accessToken }, { base });
}

// LiveKit credentials for an already-created interview (onboarding OR dimension);
// the `/interviews/:id/livekit-text-session` route is shared across kinds.
async function startLivekitForInterview(deps, { interviewId, language } = {}) {
  if (!interviewId) return { ok: false, reason: 'no-interview', step: 'start' };
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const base = deps.getOnboardingInterviewsEndpoint();
  if (!base) return { ok: false, reason: 'no-endpoint', step: 'start' };

  const started = await deps.requestStartLivekitSession(
    { interviewId, language, accessToken: gate.session.accessToken },
    { base },
  );
  if (!started.ok) return { ok: false, reason: started.reason, step: 'start' };
  return {
    ok: true,
    interviewId: started.interviewId || interviewId,
    livekitUrl: started.livekitUrl,
    token: started.token,
    roomName: started.roomName || null,
    closingMessage: started.closingMessage || null,
  };
}

async function createAndStartLivekitOnboarding(deps, { candidateId, language } = {}) {
  const created = await createOnboardingInterview(deps, { candidateId });
  if (!created.ok) return { ok: false, reason: created.reason, step: 'create' };
  return startLivekitForInterview(deps, { interviewId: created.interviewId, language });
}

// Persist the LiveKit-transport onboarding interview's transcript on session end.
async function completeLivekitOnboarding(deps, { interviewId, durationSeconds, transcripts } = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const base = deps.getOnboardingInterviewsEndpoint();
  if (!base) return { ok: false, reason: 'no-endpoint' };
  return deps.requestCompleteLivekitSession(
    { interviewId, durationSeconds, transcripts, accessToken: gate.session.accessToken },
    { base },
  );
}

async function startOnboardingSession(deps, { interviewId, language } = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const base = deps.getOnboardingInterviewsEndpoint();
  if (!base) return { ok: false, reason: 'no-endpoint' };
  return deps.requestStartTextSession({ interviewId, language, accessToken: gate.session.accessToken }, { base });
}

async function submitOnboardingTurn(deps, { interviewId, message } = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const base = deps.getOnboardingInterviewsEndpoint();
  if (!base) return { ok: false, reason: 'no-endpoint' };
  return deps.requestOnboardingTurn({ interviewId, message, accessToken: gate.session.accessToken }, { base });
}

async function completeOnboarding(deps, { interviewId } = {}) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const base = deps.getOnboardingInterviewsEndpoint();
  if (!base) return { ok: false, reason: 'no-endpoint' };
  return deps.requestCompleteTextSession({ interviewId, accessToken: gate.session.accessToken }, { base });
}

// Terminal step: flip onboarding_status -> COMPLETED via complete-onboarding, which moves registration_level to ONBOARDING_COMPLETED (the metrics Data consumes).
async function completeOnboardingRegistration(deps) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const endpoint = deps.getCompleteOnboardingEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return deps.requestCompleteOnboarding(
    { accessToken: gate.session.accessToken, hubAccessToken: gate.session.hubAccessToken },
    { endpoint },
  );
}

function profileUrl(deps) {
  return deps.getTalentProfileUrl() || null;
}

function usageDisclaimers(lang) {
  const c = require('./signup-copy').legalCopy(lang);
  return { infoAccessed: c.usageInfoAccessed, goalDuration: c.usageGoalDuration };
}

function interviewDisclaimers(lang) {
  const c = require('./signup-copy').legalCopy(lang);
  return { infoAccessed: c.interviewInfoAccessed, goalDuration: c.interviewGoalDuration };
}

function trackImport(funnel, attempted, importRes, durationMs) {
  const bySource = new Map();
  const report = importRes.ok && importRes.report ? importRes.report.sources : [];
  for (const src of report) bySource.set(sourceTypeFor(src.source), src);
  for (const type of attempted) {
    const src = bySource.get(type);
    const ok = importRes.ok && (!src || src.status === 'imported');
    if (ok) {
      funnel.track('source_import_completed', 'import_sources', { source_type: type, duration_ms: durationMs });
    } else {
      funnel.track('source_import_failed', 'import_sources', { source_type: type, duration_ms: durationMs, failure_reason: (src && src.code) || importRes.reason });
    }
  }
}

// Blocking orchestrator used by the CLI (`bin/onboarding.js`).
async function runOnboarding(io, deps = makeDeps(), { method = 'email', openBrowser, onAuthUrl, openProfile, funnel = NOOP_FUNNEL } = {}) {
  const { getCatalog } = require('./i18n');
  const c = getCatalog(io.lang).onboarding;

  funnel.begin();
  funnel.viewed('start');
  funnel.completed('start');
  io.section(c.signupTitle);
  funnel.viewed('account_creation', { auth_methods_offered: require('./auth-methods').methodIdsForFlow('register') });
  funnel.flush();
  const accountFailed = (reason) => {
    funnel.errored('account_creation', reason);
    funnel.flush();
    return { ok: false, reason, step: 'signup' };
  };

  const terms = await io.askTerms(c);
  if (!terms.accepted) {
    io.warn(c.termsDeclined);
    return accountFailed('terms-declined');
  }
  const reg = await registerWithDeviceFlow(
    deps,
    { provider: method, language: io.lang, newsletterConsent: terms.newsletterConsent },
    { openBrowser, onAuthUrl },
  );
  if (!reg.ok) {
    io.error(c.signupError);
    return accountFailed(reg.reason);
  }
  funnel.completed('account_creation', { auth_method: method, auth_attempts: 1, is_returning_account: reg.kind === 'account-already-exists' });
  funnel.identified({ newAccount: reg.kind !== 'account-already-exists' });
  if (reg.kind === 'account-already-exists') {
    io.warn(c.accountExists);
    return { ok: true, alreadyRegistered: true };
  }
  notifyOk(io, c.accountReady);

  io.section(c.title);
  funnel.viewed('import_sources', { sources_offered: ['linkedin', 'cv', 'github', 'web_page'] });
  const linkedinUrl = (await io.ask(c.askLinkedin) || '').trim();
  if (!linkedinUrl) {
    funnel.errored('import_sources', 'no-linkedin', { error_field: 'linkedin' });
    funnel.flush();
    return { ok: false, reason: 'no-linkedin', step: 'import' };
  }
  const cvPath = (await io.ask(c.askCv) || '').trim();
  const githubUrl = (await io.ask(c.askGithub) || '').trim();
  const websiteUrl = (await io.ask(c.askWebsite) || '').trim();

  // The hub import is SYNCHRONOUS (the POST returns once it finishes), so show the
  // loader AROUND that wait, then the real outcome. No background job to poll.
  const withProgress = typeof io.withProgress === 'function' ? io.withProgress : (_l, task) => task();
  const attempted = [linkedinUrl && 'linkedin', cvPath && 'cv', githubUrl && 'github', websiteUrl && 'web_page'].filter(Boolean);
  for (const type of attempted) funnel.track('source_import_started', 'import_sources', { source_type: type });
  const importStartedAt = Date.now();
  const importRes = await withProgress(c.importChecking, () =>
    startProfileImport(deps, { linkedinUrl, cvPath, githubUrl, websiteUrl, language: io.lang }));
  trackImport(funnel, attempted, importRes, Date.now() - importStartedAt);
  funnel.completed('import_sources', { sources_attempted: attempted, sources_connected: attempted, sources_connected_count: attempted.length });
  funnel.flush();
  if (importRes.ok) notifyOk(io, c.importDone);
  else io.warn(c.importUnavailable);

  // Steps 4-8 are saved out of funnel order: sent together once all are answered.
  io.section(c.professionalTitle);
  funnel.viewed('work_situation', { is_prefilled: false });
  const workSituationInput = await io.askWorkSituation(c);
  const workSituationRes = await saveWorkSituation(deps, workSituationInput);
  if (!workSituationRes.ok) {
    funnel.errored('work_situation', workSituationRes.reason);
    funnel.flush();
    return { ok: false, reason: workSituationRes.reason, step: 'work-situation' };
  }
  funnel.completed('work_situation', { work_situation: workSituationValue(String(workSituationInput.situation || '').trim().toUpperCase()), was_edited: true });
  notifyOk(io, c.professionalSaved);

  io.section(c.pricingTitle);
  funnel.viewed('rates', { suggested_rate_shown: false });
  const pricingInput = await io.askPricing(c);
  const priceRes = await savePricing(deps, pricingInput);
  if (!priceRes.ok) {
    funnel.errored('rates', priceRes.reason);
    funnel.flush();
    return { ok: false, reason: priceRes.reason, step: 'pricing' };
  }
  const selectedRates = rateTypes(pricingInput);
  funnel.completed('rates', {
    rate_types_selected: selectedRates,
    rate_type: selectedRates[0],
    rate_currency: normalizeCurrency(pricingInput.partTimeSelected === true ? pricingInput.partTimeCurrency : pricingInput.fullTimeCurrency) || undefined,
    was_edited: true,
  });
  notifyOk(io, c.pricingSaved);

  // Optional/skippable and fail-soft: a decline or a failed write never aborts the alta.
  io.section(c.availabilityTitle);
  funnel.viewed('availability', { is_prefilled: false });
  if (await io.confirm(c.availabilityAsk)) {
    let availabilityTime;
    const availabilityInput = await io.askAvailability(c, {
      onLocation: () => {
        availabilityTime = funnel.stepTime('availability');
        funnel.viewed('location', { is_prefilled: false });
      },
    });
    const availRes = await saveAvailability(deps, availabilityInput);
    if (availRes.ok) {
      funnel.completed('availability', { availability_hours_per_week: weeklyHours(normalizeMonthlyHours(availabilityInput.monthlyHours)), time_on_step_ms: availabilityTime, was_edited: true });
      const country = normalizeCountry(availabilityInput.country);
      const modes = Array.isArray(availabilityInput.workModes) ? availabilityInput.workModes.map((m) => String(m).trim().toUpperCase()) : [];
      funnel.completed('location', {
        location_country: country ? country.toLowerCase() : undefined,
        location_method: 'manual',
        is_remote_only: modes.length ? modes.every((m) => m === 'REMOTE') : undefined,
        was_edited: true,
      });
      notifyOk(io, c.availabilitySaved);
    } else {
      funnel.errored('availability', availRes.reason);
      io.warn(c.availabilityUnavailable);
    }
    if (availabilityInput.telephoneCode || availabilityInput.telephoneNumber) {
      const phoneRes = await savePhone(deps, availabilityInput);
      if (phoneRes.ok) notifyOk(io, c.phoneSaved); else io.warn(c.phoneUnavailable);
    }
  } else {
    funnel.skipped('availability');
    funnel.skipped('location');
    io.notify(c.availabilitySkipped);
  }

  io.section(c.languagesTitle);
  funnel.viewed('languages', { is_prefilled: false });
  if (await io.confirm(c.languagesAsk)) {
    const languageRows = await io.askLanguages(c);
    const langRes = await saveLanguages(deps, languageRows);
    if (langRes.ok) {
      const codes = validateLanguageRows(languageRows).rows.map((r) => r.language);
      funnel.completed('languages', { languages_count: codes.length, languages: codes, was_edited: true });
      notifyOk(io, c.languagesSaved);
    } else {
      funnel.errored('languages', langRes.reason);
      io.warn(c.languagesUnavailable);
    }
  } else {
    funnel.skipped('languages');
    io.notify(c.languagesSkipped);
  }
  funnel.flush();

  const prior = await detectPriorUsage(deps);
  let didUsage = false;
  const offerUsage = !(prior.ok && prior.hasEvidence === true);
  if (offerUsage) {
    io.section(c.usageTitle);
    io.disclaimer(c.usageInfoAccessed, c.usageGoalDuration);
    if (await io.confirm(c.usageAccept)) {
      // A: attribute the footprint to THIS talent, not a stale consent.json.
      reattachConsentIdentity(deps);
      await io.runUsage();
      didUsage = true;
    }
  } else {
    io.notify(c.usageSkippedEvidence);
  }

  const finalize = async () => {
    const fin = await completeOnboardingRegistration(deps);
    if (!fin.ok) {
      io.warn(c.finalizeWarn(fin.reason));
    } else if (typeof fin.completedProfilePercentage === 'number') {
      notifyOk(io, c.finalizedAt(fin.completedProfilePercentage));
    } else {
      notifyOk(io, c.finalizedGeneric);
    }
    return fin;
  };

  // Every ending points the Talent at their profile, and opens it when a browser is at hand.
  const showProfile = () => {
    const url = profileUrl(deps);
    funnel.viewed('profile_summary');
    notifyOk(io, url ? c.profileReadyUrl(url) : c.profileReadyNoUrl);
    if (url && typeof openProfile === 'function') {
      try { openProfile(url); } catch { /* the printed link covers it */ }
    }
    funnel.completed('profile_summary');
    funnel.flush();
    return url;
  };

  const mainRole = async () => {
    let shown = null;
    const role = await runMainRoleFinalStep(io, deps, {
      onRolesShown: (info) => {
        shown = info;
        funnel.viewed('supercluster', { suggested_superclusters: info.suggested, suggestion_source: 'assigned_clusters', suggestions_count: info.suggested.length });
      },
    });
    if (role && role.ok && role.chosen) {
      funnel.completed('supercluster', {
        supercluster: role.chosen,
        clusters_count: shown ? shown.clustersCount : undefined,
        was_suggestion_accepted: shown ? shown.suggested.includes(role.chosen) : undefined,
      });
    } else if (role && role.ok) funnel.skipped('supercluster');
    funnel.flush();
  };

  funnel.holdUntil('profile_summary');
  io.section(c.interviewTitle);
  funnel.viewed('pre_interview');
  io.disclaimer(c.interviewInfoAccessed, c.interviewGoalDuration);
  if (!(await io.confirm(c.interviewAccept))) {
    funnel.completed('pre_interview', { interview_choice: 'skip' });
    await mainRole();
    const fin = await finalize();
    const url = showProfile();
    return { ok: true, completed: 'skipped-interview', didUsage, profileUrl: url, finalized: fin.ok, registration: fin };
  }
  funnel.completed('pre_interview', { interview_choice: 'start_now' });

  const interview = await conductLivekitInterview(io, deps, { funnel });
  if (!interview.ok) {
    funnel.errored('interview', interview.reason);
    await mainRole();
    const fin = await finalize();
    const url = showProfile();
    return { ok: true, completed: 'interview-unavailable', reason: interview.reason, didUsage, profileUrl: url, finalized: fin.ok, registration: fin };
  }
  funnel.completed('interview', { interview_mode: 'text' });
  notifyOk(io, c.interviewComplete);
  await mainRole();
  const fin = await finalize();
  const url = showProfile();
  return { ok: true, completed: 'interview', didUsage, profileUrl: url, finalized: fin.ok, registration: fin };
}

// Adapts an InterviewClient (LiveKit text-streams) to the { open, turn } shape io.interviewLoop consumes, so a LiveKit run reuses the shared interview UX.
function livekitTurnBridge(client, transcript) {
  return {
    open: async () => {
      try {
        const t = await client.receiveTurn();
        transcript.recordAgent(t.text);
        return { ok: true, greeting: t.text, ended: t.ended === true };
      } catch (e) {
        return { ok: false, reason: (e && e.kind) || 'no-greeting' };
      }
    },
    turn: async (message) => {
      transcript.recordUser(message);
      try {
        const t = await client.sendTurn(message);
        transcript.recordAgent(t.text);
        return { ok: true, response: t.text, ended: t.ended === true };
      } catch (e) {
        return { ok: false, reason: (e && e.kind) || 'turn-error' };
      }
    },
  };
}

// The onboarding/dimension interview over LiveKit text transport. LiveKit Node SDK is an optional lazily-required dep; a `livekit-not-installed` connect prints a hint, not a stack trace. Persists the transcript on session end even when interrupted; a failed PATCH warns, never crashes.
async function conductLivekitInterview(io, deps, { interviewId = null, language = null, plain = false, funnel = null } = {}) {
  const { getCatalog } = require('./i18n');
  const c = getCatalog(io.lang).onboarding;
  const { TranscriptBuffer } = require('./interview-transcript');

  // A pre-created interviewId (dimension) starts LiveKit directly; onboarding creates first.
  const start = interviewId
    ? await startLivekitForInterview(deps, { interviewId, language: language || io.lang })
    : await createAndStartLivekitOnboarding(deps, { language: language || io.lang });
  if (!start.ok) return { ok: false, reason: start.reason, step: start.step || 'interview' };
  if (funnel) funnel.viewed('interview', { interview_mode: 'text' });

  const closing = start.closingMessage;
  const isClosing = closing ? (t) => typeof t === 'string' && t.includes(closing) : null;
  const client = deps.makeInterviewClient({ isClosing });
  const transcript = new TranscriptBuffer();

  let connectAt = null;
  try {
    io.notify(c.interviewConnecting);
    try {
      await client.connect(start.livekitUrl, start.token);
      connectAt = Date.now();
    } catch (e) {
      const kind = e && e.kind;
      // Non-fatal: the interview is optional and the alta still finalizes → warning.
      io.warn(
        kind === 'livekit-not-installed' ? c.livekitMissing
          : kind === 'livekit-no-text-streams' ? c.livekitOld
            : c.livekitConnectError,
      );
      return { ok: false, reason: kind || 'connect-failed', step: 'interview' };
    }

    const loop = await io.interviewLoop({ ...livekitTurnBridge(client, transcript), plain });

    if (transcript.length > 0) {
      const durationSeconds = connectAt != null ? Math.max(0, Math.floor((Date.now() - connectAt) / 1000)) : 0;
      const saved = await completeLivekitOnboarding(deps, {
        interviewId: start.interviewId,
        durationSeconds,
        transcripts: transcript.toTranscripts(),
      });
      if (!saved.ok) io.warn(c.transcriptWarn(saved.reason));
    }

    if (loop && loop.ok === false) return { ok: false, reason: loop.reason, step: 'interview' };
    return { ok: true, completed: 'interview', interviewId: start.interviewId };
  } finally {
    try { await client.disconnect(); } catch {}
  }
}

// Runs the final main-role step, degrading softly (never aborts the flow / never throws).
async function runMainRoleFinalStep(io, deps, { onRolesShown } = {}) {
  const active = typeof deps.loadAuthSession === 'function' ? deps.loadAuthSession() : null;
  if (typeof deps.runMainRoleStep !== 'function' || !active) return;
  const { getCatalog } = require('./i18n');
  const catalog = getCatalog(io.lang);
  try {
    const rolesDeps = typeof deps.makeRolesDeps === 'function' ? deps.makeRolesDeps() : undefined;
    return await deps.runMainRoleStep({ io, session: active, catalog, deps: rolesDeps, onRolesShown });
  } catch {
    return null;
  }
}

// Overwrite-repeat: PATCH /interviews/onboarding/restart. Candidate certs JWT, like its onboarding siblings.
async function restartOnboarding(deps) {
  const gate = await requireActiveSession(deps);
  if (!gate.ok) return gate;
  const endpoint = deps.getOnboardingRestartEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return deps.requestRestartOnboardingInterview({ accessToken: gate.session.accessToken }, { endpoint });
}

// `shakers onboarding --repeat`: warn + explicit confirm, then overwrite the prior
// onboarding interview and run it again (interview only — no main-role step).
async function runRepeatOnboardingInterview(io, deps = makeDeps(), { confirmed = false } = {}) {
  const { getCatalog } = require('./i18n');
  const c = getCatalog(io.lang).onboarding;

  const gate = await requireActiveSession(deps);
  if (!gate.ok) return { ok: false, reason: 'no-session' };

  io.section(c.repeatWarnTitle);
  io.warn(c.repeatWarnBody);
  let ok = confirmed;
  if (!ok && typeof io.select === 'function') {
    const choice = await io.select({
      header: c.repeatConfirmPrompt,
      items: [{ id: 'yes', label: c.repeatConfirmYes }, { id: 'no', label: c.repeatConfirmNo }],
      labelFor: (it) => it.label,
    });
    ok = !!(choice && choice.id === 'yes');
  }
  if (!ok) {
    io.notify(c.repeatAborted);
    return { ok: true, repeated: false };
  }

  const reset = await restartOnboarding(deps);
  if (!reset.ok) {
    if (reset.reason === 'onboarding-not-found') io.error(c.repeatNotFound);
    else if (reset.reason === 'http-401' || reset.reason === 'http-403') io.error(c.repeatAuthError);
    else io.error(c.repeatFailed(reset.reason));
    return { ok: false, reason: reset.reason };
  }
  io.notify(c.repeatRestarted);

  // Standalone repeat runs the interview only — main-role belongs to `register`.
  const interview = await conductLivekitInterview(io, deps);
  if (interview.ok) notifyOk(io, c.interviewComplete);
  return interview.ok ? { ok: true, repeated: true, completed: 'interview' } : { ok: true, repeated: true, completed: 'interview-unavailable', reason: interview.reason };
}

// Standalone `shakers onboarding`: the interview ONLY. The main-role step is part of
// registration (`runOnboarding`), never of running the interview on its own.
async function runOnboardingInterview(io, deps = makeDeps()) {
  const { getCatalog } = require('./i18n');
  const c = getCatalog(io.lang).onboarding;

  const gate = await requireActiveSession(deps);
  if (!gate.ok) return { ok: false, reason: 'no-session' };

  io.section(c.interviewOnlyTitle);
  io.disclaimer(c.interviewInfoAccessed, c.interviewGoalDuration);
  if (!(await io.confirm(c.interviewAccept))) {
    const url = profileUrl(deps);
    notifyOk(io, url ? c.profileReadyUrl(url) : c.profileReadyNoUrl);
    return { ok: true, completed: 'skipped' };
  }

  const interview = await conductLivekitInterview(io, deps);
  // An already-completed onboarding cannot be re-run without --repeat (certs reuses the
  // taken interview) — say so plainly instead of surfacing a raw 400.
  if (!interview.ok && interview.reason === 'interview-already-started') {
    io.notify(c.interviewAlreadyDone);
    return { ok: true, completed: 'already-done' };
  }
  if (interview.ok) notifyOk(io, c.interviewComplete);
  return interview;
}

module.exports = {
  FREELANCE_TYPES,
  CURRENCIES,
  MONTHLY_HOURS,
  WORK_SITUATIONS,
  EMPLOYMENT_PARTICIPATIONS,
  FREELANCE_OPINIONS,
  CHANGE_MOTIVATORS,
  WORK_MODES,
  LANGUAGE_LEVELS,
  LANGUAGE_CODES,
  normalizeFreelanceType,
  freelanceIntentRequired,
  deriveFreelanceTypeFromSituation,
  normalizeCurrency,
  normalizeAmount,
  normalizeMonthlyHours,
  normalizeCountry,
  validatePricing,
  validateAvailability,
  buildPricingUpsert,
  deriveCurrentEmploymentStatus,
  showsFreelanceOpinion,
  deriveFreelanceIntent,
  showsChangeMotivators,
  validateWorkSituation,
  validateLanguageRows,
  validatePhone,
  makeDeps,
  registerWithDeviceFlow,
  startProfileImport,
  reattachConsentIdentity,
  saveWorkSituation,
  savePricing,
  saveAvailability,
  saveLanguages,
  savePhone,
  detectPriorUsage,
  createOnboardingInterview,
  startLivekitForInterview,
  createAndStartLivekitOnboarding,
  completeLivekitOnboarding,
  startOnboardingSession,
  submitOnboardingTurn,
  completeOnboarding,
  completeOnboardingRegistration,
  profileUrl,
  usageDisclaimers,
  interviewDisclaimers,
  conductLivekitInterview,
  restartOnboarding,
  runRepeatOnboardingInterview,
  runOnboarding,
  runOnboardingInterview,
};
