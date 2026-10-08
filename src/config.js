'use strict';

const fs = require('fs');
const path = require('path');
const { readEnv } = require('./env-paths');
const { getConfigDir } = require('./config-dir');

// Persistent CLI config file (skill-code-certification, endpoint-config task).
function configDir(env = process.env) {
  return getConfigDir(env);
}

function configFilePath(env = process.env) {
  return path.join(configDir(env), 'config.json');
}

function loadConfigFile(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFilePath(env), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// DISTRIBUTION PROFILE (talents-ai-score, ADR-058 fase 1).
const VALID_PROFILES = new Set(['external', 'talent']);
const PROFILE_DEFAULT_WHEN_ABSENT = 'talent';

function getProfile(env = process.env) {
  const fromFile = loadConfigFile(env).profile;
  return VALID_PROFILES.has(fromFile) ? fromFile : PROFILE_DEFAULT_WHEN_ABSENT;
}

function isTalentProfile(env = process.env) {
  return getProfile(env) === 'talent';
}

// Explicit UI-language preference: SHAKERS_CLI_LANG env > config.json `lang`.
// Returns 'es' | 'en', or null when neither is set (OS detection then fills it, see i18n.js).
const VALID_UI_LANGS = new Set(['es', 'en']);

function getUiLang(env = process.env) {
  const fromEnv = String(readEnv(env, 'LANG') || '').trim().toLowerCase();
  if (VALID_UI_LANGS.has(fromEnv)) return fromEnv;
  const fromFile = String(loadConfigFile(env).lang || '').trim().toLowerCase();
  if (VALID_UI_LANGS.has(fromFile)) return fromFile;
  return null;
}

// config.json holds the superadmin session token (ADR-027) and consent/ endpoint data, so it must never be briefly world/group-readable.
function saveConfigFile(config, env = process.env) {
  const dir = configDir(env);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFilePath(env), JSON.stringify(config, null, 2), { mode: 0o600 });
  try { fs.chmodSync(configFilePath(env), 0o600); } catch { /* e.g. Windows */ }
}

// Endpoint safety (skill-code-certification, endpoint-config task) — BOUNDED.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SHAKERS_CLI_DOMAINS = [];

function isAllowedShakersDomain(host) {
  const h = String(host || '').toLowerCase();
  return SHAKERS_CLI_DOMAINS.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

function validateEndpoint(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, reason: 'empty' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'bad-protocol' };
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const isLocal = LOCAL_HOSTS.has(host);
  if (!isLocal && u.protocol !== 'https:') {
    return { ok: false, reason: 'insecure-remote' };
  }
  const isAllowlisted = isLocal || isAllowedShakersDomain(host);
  return { ok: true, value: raw, host, isLocal, isAllowlisted };
}

// Persists the ingest endpoint into config.json after validating it.
function setIngestEndpoint(value, env = process.env, { confirmed = false } = {}) {
  const v = validateEndpoint(value);
  if (!v.ok) return { ok: false, reason: v.reason };
  if (!v.isAllowlisted && !confirmed) return { ok: false, reason: 'needs-confirmation', host: v.host };
  const config = loadConfigFile(env);
  config.ingestEndpoint = v.value;
  saveConfigFile(config, env);
  return { ok: true, value: v.value, path: configFilePath(env) };
}

const RETIRED_FALLBACK_CONFIG_KEY = 'ingestEndpointFallback';

// Whether the persisted config still carries the retired fallback key, so `--show-endpoint` can say it is being ignored.
function hasRetiredFallbackConfig(env = process.env) {
  const value = loadConfigFile(env)[RETIRED_FALLBACK_CONFIG_KEY];
  return typeof value === 'string' && value.trim().length > 0;
}

// Resolves the effective ingest endpoint AND its source, for `--show-endpoint`.
function resolveIngestEndpoint(env = process.env) {
  const fromEnv = readEnv(env, 'INGEST_ENDPOINT');
  if (fromEnv && fromEnv.trim()) {
    return { endpoint: fromEnv.trim(), source: 'env' };
  }
  const fromFile = loadConfigFile(env).ingestEndpoint;
  if (fromFile && String(fromFile).trim()) {
    const v = validateEndpoint(String(fromFile).trim());
    if (v.ok) return { endpoint: v.value, source: 'config-file', path: configFilePath(env) };
    return { endpoint: null, source: 'config-file-invalid', path: configFilePath(env), reason: v.reason };
  }
  return { endpoint: null, source: 'none' };
}

// Baked backend targets per distribution flavor (talents-ai-score, ADR-007/065).
// Only the DEFAULT bases; per-endpoint SHAKERS_CLI_* env and config.json overrides
// still win at each getter (env > config.json > baked profile).
const ENV_PROFILES = {
  staging: {
    certsBase: 'https://api.staging.certifications.shakersworks.com/api/v1',
    hubBase: 'https://api.hub.staging.shakersworks.com/api/v1',
    profileUrl: 'https://works.staging.shakersworks.com/login',
  },
  dev: {
    certsBase: 'https://api.dev.certifications.shakersworks.com/api/v1',
    hubBase: 'https://api.hub.new-works.dev.shakersworks.com/api/v1',
    profileUrl: 'https://works.new-works.dev.shakersworks.com/login',
  },
  local: {
    certsBase: 'http://localhost:3004/api/v1',
    hubBase: 'http://localhost:3001/api/v1',
    profileUrl: 'http://localhost:8081/login',
  },
};

// Which flavor is baked: SHAKERS_CLI_ENV override wins, else derived from the
// published package name (beta -> staging, private -> dev), else dev (safe default).
const PACKAGE_NAME_ENV = { 'shakers-cli-beta': 'staging', '@shakers/shakers-cli': 'dev' };
const DEFAULT_ENV_PROFILE = 'dev';

function bakedEnvProfileName() {
  try {
    const name = require('../package.json').name;
    if (PACKAGE_NAME_ENV[name]) return PACKAGE_NAME_ENV[name];
  } catch { /* package.json unreadable — fall through to the safe default */ }
  return DEFAULT_ENV_PROFILE;
}

function getEnvProfileName(env = process.env) {
  const override = readEnv(env, 'ENV');
  if (override && ENV_PROFILES[String(override).trim()]) return String(override).trim();
  return bakedEnvProfileName();
}

function getEnvProfile(env = process.env) {
  return ENV_PROFILES[getEnvProfileName(env)] || ENV_PROFILES[DEFAULT_ENV_PROFILE];
}

function explicitIngest(env = process.env) {
  const value = readEnv(env, 'INGEST_ENDPOINT');
  if (value && value.trim()) return value.trim();
  const fromFile = loadConfigFile(env).ingestEndpoint;
  if (fromFile && String(fromFile).trim()) {
    const v = validateEndpoint(String(fromFile).trim());
    if (!v.ok) return null;
    // The ai-footprint -> shakers config migration rewrote the old hub ingest
    // (`/works/ai-footprint/reports`) to `/works/usage/reports`, a route no service
    // has: ingestion lives in certs. Kept, it silently sent every report and the
    // agent evaluation there and both failed ("agentes sin categoria", 2026-09-25).
    // Ignored, the endpoint derives from certsBase like a fresh install. The same
    // goes for the loopback default install.sh used to bake into every config.
    if (LEGACY_HUB_INGEST.test(v.value) || v.value === RETIRED_INSTALL_INGEST) return null;
    return v.value;
  }
  return null;
}

const LEGACY_HUB_INGEST = /\/works\/(usage|ai-footprint)\/reports\/?$/;
const RETIRED_INSTALL_INGEST = 'http://localhost:3004/api/v1/usage/reports';

function getCertsBase(env = process.env) {
  const value = readEnv(env, 'CERTS_BASE');
  if (value && value.trim()) return value.trim().replace(/\/+$/, '');
  const fromFile = loadConfigFile(env).certsBase;
  if (fromFile && String(fromFile).trim()) {
    const v = validateEndpoint(String(fromFile).trim());
    if (v.ok) return v.value.replace(/\/+$/, '');
  }
  const ingest = explicitIngest(env);
  if (ingest) return ingest.replace(/\/usage\/reports\/?$/, '').replace(/\/+$/, '');
  // No explicit override anywhere -> the baked flavor profile (never null when a
  // profile exists), so switching the published flavor "just works" without a
  // seeded config.json (ADR-065 revised).
  const baked = getEnvProfile(env).certsBase;
  return baked ? baked.replace(/\/+$/, '') : null;
}

function getIngestEndpoint(env = process.env) {
  const explicit = explicitIngest(env);
  if (explicit) return explicit;
  const base = getCertsBase(env);
  return base ? `${base}/usage/reports` : null;
}

// Agent-synthesis endpoint (talents-ai-score, ADR-010/ADR-011).
function getSynthesisEndpoint(env = process.env) {
  const value = readEnv(env, 'SYNTHESIS_ENDPOINT');
  if (value && value.trim()) return value.trim();
  // Issue 111: derived as an ingest sibling when the override is unset.
  return deriveFromIngest(env, 'agent-synthesis');
}

function getRoadmapEndpoint(env = process.env) {
  const value = readEnv(env, 'ROADMAP_ENDPOINT');
  if (value && value.trim()) return value.trim();
  return deriveFromIngest(env, 'roadmap-personalize');
}

// Email-verification endpoints (ADR-006): the OTP "prove you own this email" step that gates PERSISTENCE. Sibling-of-ingest resolution (`new URL(relative, base)`); unset ingest -> null.
function deriveFromIngest(env, relativePath) {
  const ingest = getIngestEndpoint(env);
  if (!ingest) return null;
  const base = ingest.replace(/\/+$/, '');
  try {
    return new URL(relativePath, base).href;
  } catch {
    return null;
  }
}

function deriveEmailVerificationUrl(env, segment) {
  return deriveFromIngest(env, `email-verification/${segment}`);
}

// Agent-evaluation endpoint (footprint agent cards — RESTORED).
function getAgentEvaluationEndpoint(env = process.env) {
  const explicit = readEnv(env, 'AGENT_EVAL_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, 'agent-evaluation');
}

// Login endpoint — better-auth email sign-in (owner decision, supersedes ADR-031 for the email path): `POST {hubBase}/auth/sign-in/email` with `{email,password}`.
function getLoginEndpoint(env = process.env) {
  const explicit = readEnv(env, 'LOGIN_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'auth/sign-in/email');
}

// better-auth JWT endpoint: `GET {hubBase}/auth/token` with the session cookie → `{token}` (ES256/JWKS, ~15-min TTL).
function getAuthTokenEndpoint(env = process.env) {
  const explicit = readEnv(env, 'AUTH_TOKEN_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'auth/token');
}

function getCompleteRegistrationEndpoint(env = process.env) {
  const explicit = readEnv(env, 'COMPLETE_REGISTRATION_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/auth/complete-registration');
}

// Google via device flow (RFC 8628): the Hub broker owns all Google config; the CLI holds no client_id.
function getDeviceAuthorizeEndpoint(env = process.env) {
  const explicit = readEnv(env, 'DEVICE_AUTHORIZE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  // better-auth device plugin, mounted at /auth.
  return deriveFromHub(env, 'auth/device/code');
}

function getDeviceTokenEndpoint(env = process.env) {
  const explicit = readEnv(env, 'DEVICE_TOKEN_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  // Same Nest prefix as complete-registration (the works auth controller).
  return deriveFromHub(env, 'works/auth/device/token');
}

// Dimension-certification endpoints. The LiveKit start/complete + `/interviews/:id/report`
// poll reuse `getOnboardingInterviewsEndpoint` (= `{certsBase}/interviews`).
function getMyCertificationsEndpoint(env = process.env) {
  const explicit = readEnv(env, 'MY_CERTIFICATIONS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/certifications/me');
}

// Role/cluster endpoints (hub, talent Bearer). available-roles = the catalog the
// talent can add; main-role = set the preferred main; assigned-clusters = the
// talent's own GROWTH/RECOMMENDED roles (GET add POST, remove DELETE).
function getAvailableRolesEndpoint(env = process.env) {
  const explicit = readEnv(env, 'AVAILABLE_ROLES_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/certifications/me/available-roles');
}

function getSetMainRoleEndpoint(env = process.env) {
  const explicit = readEnv(env, 'SET_MAIN_ROLE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/certifications/me/main-role');
}

function getAssignedClustersEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ASSIGNED_CLUSTERS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/talents/me/work-details/assigned-clusters');
}

function getTemplatesByDimensionEndpoint(env = process.env) {
  const explicit = readEnv(env, 'TEMPLATES_BY_DIMENSION_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  const base = getCertsBase(env);
  return base ? `${base}/templates/by-dimension` : null;
}

// Find Positions list (hub `works/positions/find`, talent Bearer). Serves the
// All/Recommended/Saved tabs via `criteria.savedByMe`; ordered by match desc.
function getFindPositionsEndpoint(env = process.env) {
  const explicit = readEnv(env, 'FIND_POSITIONS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/positions/find');
}

// Marketplace read/write (hub, talent Bearer). The id-taking getters return null
// on a non-scalar first arg so config.test.js's `fn(env)` sweep stays honest.
function getPositionDetailEndpoint(positionId, env = process.env) {
  const explicit = readEnv(env, 'POSITION_DETAIL_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  if (positionId == null || typeof positionId === 'object') return null;
  return deriveFromHub(env, `works/positions/${encodeURIComponent(positionId)}/detail`);
}

function getSavePositionEndpoint(env = process.env) {
  const explicit = readEnv(env, 'SAVE_POSITION_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/saved-positions');
}

function getUnsavePositionEndpoint(positionId, env = process.env) {
  const explicit = readEnv(env, 'UNSAVE_POSITION_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  if (positionId == null || typeof positionId === 'object') return null;
  return deriveFromHub(env, `works/saved-positions/${encodeURIComponent(positionId)}`);
}

function getReceivedInvitationsEndpoint(env = process.env) {
  const explicit = readEnv(env, 'RECEIVED_INVITATIONS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/positions/received-invitations');
}

function getMyCandidaturesEndpoint(env = process.env) {
  const explicit = readEnv(env, 'MY_CANDIDATURES_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/candidatures/me');
}

function getMeAvailabilityEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ME_AVAILABILITY_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/me/availability');
}

function getMeProfileEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ME_PROFILE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/me/profile');
}

function getTalentMeProfileEndpoint(env = process.env) {
  const explicit = readEnv(env, 'TALENT_ME_PROFILE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/talents/me/profile');
}

// Alma (the AI assistant) is a SEPARATE service — NOT derived from hubBase.
// Default to the local/dev container; override with SHAKERS_CLI_ALMA_BASE.
const DEFAULT_ALMA_BASE = 'http://127.0.0.1:5030';

function getAlmaBase(env = process.env) {
  const explicit = readEnv(env, 'ALMA_BASE');
  if (explicit && explicit.trim()) return explicit.trim().replace(/\/+$/, '');
  return DEFAULT_ALMA_BASE;
}

function getAlmaChatEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ALMA_CHAT_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  const base = getAlmaBase(env);
  return base ? `${base}/alma/chat` : null;
}

function getAlmaDecisionEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ALMA_DECISION_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  const base = getAlmaBase(env);
  return base ? `${base}/alma/decision` : null;
}

function getSkillsDeclareEndpoint(env = process.env) {
  const explicit = readEnv(env, 'SKILLS_DECLARE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/skills/declare');
}

function getSkillsResolveAddableEndpoint(env = process.env) {
  const explicit = readEnv(env, 'SKILLS_RESOLVE_ADDABLE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/skills/resolve-addable');
}

function getSkillsResolveMatchedEndpoint(env = process.env) {
  const explicit = readEnv(env, 'SKILLS_RESOLVE_MATCHED_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/skills/resolve-matched');
}

function getUsageDiscoveredInventoryEndpoint(env = process.env) {
  const explicit = readEnv(env, 'USAGE_DISCOVERED_INVENTORY_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, 'discovered-inventory');
}

function getUsageReportEndpoint(env = process.env) {
  const explicit = readEnv(env, 'USAGE_REPORT_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, 'report');
}

// Hub "My work with AI" read model (same endpoint the front paints).
function getAiProfileEndpoint(env = process.env) {
  const explicit = readEnv(env, 'AI_PROFILE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/me/ai-profile');
}

// Evidence emission endpoint for the `cli_scan` instrument (talents-ai-score Phase 2).
function getEvidenceCliScanEndpoint(env = process.env) {
  const explicit = readEnv(env, 'EVIDENCE_CLI_SCAN_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../evidence/cli-scan');
}

// Talent-portfolio endpoints (talents-ai-score, ADR-059 — `start`'s "Add project to portfolio" route, talent-only).
function getPortfoliosDeclareEndpoint(env = process.env) {
  const explicit = readEnv(env, 'PORTFOLIOS_DECLARE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/portfolios/declare');
}

function getPortfoliosListEndpoint(env = process.env) {
  const explicit = readEnv(env, 'PORTFOLIOS_LIST_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/portfolios');
}

function getPortfolioDraftDescriptionEndpoint(env = process.env) {
  const explicit = readEnv(env, 'PORTFOLIO_DRAFT_DESCRIPTION_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/portfolios/draft-description');
}

function getPortfolioUpdateEndpoint(env = process.env) {
  const explicit = readEnv(env, 'PORTFOLIO_UPDATE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/portfolios');
}

function getAgentsDeclareEndpoint(env = process.env) {
  const explicit = readEnv(env, 'AGENTS_DECLARE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/agents/declare');
}

function getAgentsListEndpoint(env = process.env) {
  const explicit = readEnv(env, 'AGENTS_LIST_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/agents');
}

function getAgentsDraftFieldsEndpoint(env = process.env) {
  const explicit = readEnv(env, 'AGENTS_DRAFT_FIELDS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromIngest(env, '../works/talents/me/agents/draft-fields');
}

// Agent<->experience relate endpoint (ADR-041, `start`'s "Add agent" relate step / MCP `add_agent.relatedPortfolios`).
function getAgentPortfoliosEndpoint(agentId, env = process.env) {
  // Null on missing/non-scalar id: no bogus URL, and keeps config.test.js's `fn(env)`
  // getter sweep honest when the env object lands in `agentId`.
  if (agentId == null || typeof agentId === 'object') return null;
  return deriveFromHub(env, `works/me/agents/${encodeURIComponent(agentId)}/portfolios`);
}

// Onboarding endpoints (evaluation-mcp, ADR-011..015/024 — the register flow).
function getHubBase(env = process.env) {
  const explicit = readEnv(env, 'HUB_BASE');
  if (explicit && explicit.trim()) return explicit.trim().replace(/\/+$/, '');
  const fromFile = loadConfigFile(env).hubBase;
  if (fromFile && String(fromFile).trim()) {
    const v = validateEndpoint(String(fromFile).trim());
    if (v.ok) return v.value.replace(/\/+$/, '');
  }
  const baked = getEnvProfile(env).hubBase;
  return baked ? baked.replace(/\/+$/, '') : null;
}

function deriveFromHub(env, relativePath) {
  const base = getHubBase(env);
  if (!base) return null;
  return `${base}/${relativePath}`;
}

function getSignUpEndpoint(env = process.env) {
  const explicit = readEnv(env, 'SIGNUP_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'auth/sign-up/email');
}

function getImportProfileEndpoint(env = process.env) {
  const explicit = readEnv(env, 'IMPORT_PROFILE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/me/import-profile');
}

// MCP sign-up (ticket 39540): public UNREGISTERED + claim code, its import status, and the one-time web login.
function getMcpSignupEndpoint(env = process.env) {
  return deriveFromHub(env, 'works-ai/talents/mcp-signup');
}

function getMyImportStatusEndpoint(env = process.env) {
  return deriveFromHub(env, 'works/me/import-profile/status');
}

function getOneTimeTokenEndpoint(env = process.env) {
  return deriveFromHub(env, 'auth/one-time-token/generate');
}

// The ONE place the web route that redeems a one-time token is spelled (the route itself is a later works-frontend ticket).
function getOneTimeLoginUrl(token, env = process.env) {
  if (typeof token !== 'string' || !token) return null;
  const profile = getTalentProfileUrl(env);
  if (!profile) return null;
  try {
    return `${new URL(profile).origin}/auth/one-time?token=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}

function getProfessionalDetailsEndpoint(env = process.env) {
  const explicit = readEnv(env, 'PROFESSIONAL_DETAILS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/me/professional-details');
}

function getPricingRateEndpoint(env = process.env) {
  const explicit = readEnv(env, 'PRICING_RATE_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/talents/me/work-details/pricing-rate');
}

function getSetAvailabilityEndpoint(env = process.env) {
  const explicit = readEnv(env, 'AVAILABILITY_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/talents/me/work-details/availability');
}

function getLanguagesEndpoint(env = process.env) {
  const explicit = readEnv(env, 'LANGUAGES_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/talents/me/work-details/languages');
}

function getLanguagesCatalogEndpoint(env = process.env) {
  const explicit = readEnv(env, 'LANGUAGES_CATALOG_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'static-data/languages');
}

// Talent social links (GET + PUT upsert of the whole object).
function getMeSocialEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ME_SOCIAL_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/me/social');
}

// Talent portfolio entries (GET; ?type=EXPERIENCE|PORTFOLIO — one entity, two subsets).
function getMePortfoliosEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ME_PORTFOLIOS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/me/portfolios');
}

// i18n translations (GET ?namespace=static-data): resolves static-data KEYS
// (e.g. staticDataSkillsSkill_N) to readable names per language. Bearer required.
function getTranslationsEndpoint(env = process.env) {
  const explicit = readEnv(env, 'TRANSLATIONS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'translations');
}

function getTalentMeEndpoint(env = process.env) {
  const explicit = readEnv(env, 'TALENT_ME_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/me');
}

function getOnboardingInterviewsEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ONBOARDING_INTERVIEWS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  const base = getCertsBase(env);
  return base ? `${base}/interviews` : null;
}

// Overwrite-repeat of the onboarding interview (certs, talent Bearer) — resets the
// taken interview in-place so it can be re-run.
function getOnboardingRestartEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ONBOARDING_RESTART_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  const base = getCertsBase(env);
  return base ? `${base}/interviews/onboarding/restart` : null;
}

function getCompleteOnboardingEndpoint(env = process.env) {
  const explicit = readEnv(env, 'COMPLETE_ONBOARDING_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  return deriveFromHub(env, 'works/talents/me/complete-onboarding');
}

function getOnboardingStatusEndpoint(env = process.env) {
  const explicit = readEnv(env, 'ONBOARDING_STATUS_ENDPOINT');
  if (explicit && explicit.trim()) return explicit.trim();
  const base = getCertsBase(env);
  return base ? `${base}/interviews/onboarding/status` : null;
}

// Talent profile web URL (evaluation-mcp, ADR-011 — the step-5 skip fallback).
function getTalentProfileUrl(env = process.env) {
  const explicit = readEnv(env, 'PROFILE_URL');
  if (explicit && explicit.trim()) return explicit.trim().replace(/\/+$/, '');
  const fromFile = loadConfigFile(env).profileUrl;
  if (fromFile && String(fromFile).trim()) return String(fromFile).trim().replace(/\/+$/, '');
  const baked = getEnvProfile(env).profileUrl;
  return baked ? baked.replace(/\/+$/, '') : null;
}

// The endpoint keys a flavor profile owns. config.json must hold only EXPLICIT
// user overrides of these, never the baked profile itself.
const PROFILE_ENDPOINT_KEYS = Object.keys(ENV_PROFILES[DEFAULT_ENV_PROFILE]);

// Boot migration (ADR-065 revised). The CLI used to SEED config.json with the
// baked bases on first run; the getters now fall back to getEnvProfile() directly,
// so seeding is unnecessary AND harmful: `npm uninstall` leaves the config dir, so
// a config.json seeded by a previous flavor (e.g. the private @shakers build → dev)
// survives into a new flavor (the public beta → staging) and pins the old endpoints
// forever, since config.json wins over the baked profile. This sweep removes any
// endpoint key whose value is byte-identical to that SAME field in a KNOWN profile
// OTHER than the baked one — i.e. a value that could only have gotten there by the
// old seeding of a different flavor. A value that matches no known profile is a
// genuine user override (set via `shakers config set`) and is left untouched. We
// never touch env, auth-session.json or consent.json, and never remove the dir.
function sanitizeStaleBakedEndpoints(env = process.env) {
  const bakedName = getEnvProfileName(env);
  const config = loadConfigFile(env);
  let changed = false;
  for (const key of PROFILE_ENDPOINT_KEYS) {
    const current = config[key];
    if (typeof current !== 'string' || !current.trim()) continue;
    const normalized = current.trim().replace(/\/+$/, '');
    const matchesForeignProfile = Object.entries(ENV_PROFILES).some(
      ([name, profile]) =>
        name !== bakedName && String(profile[key]).replace(/\/+$/, '') === normalized,
    );
    if (matchesForeignProfile) {
      delete config[key];
      changed = true;
    }
  }
  if (changed) {
    try { saveConfigFile(config, env); } catch { return false; }
  }
  return changed;
}

function getEmailVerificationRequestUrl(env = process.env) {
  return deriveEmailVerificationUrl(env, 'request');
}

function getEmailVerificationVerifyUrl(env = process.env) {
  return deriveEmailVerificationUrl(env, 'verify');
}

function getSuperadminSessionEndpoint(env = process.env) {
  return deriveFromIngest(env, 'superadmin/session');
}

// Superadmin READ-ONLY certification inspection endpoint (ADR-025, NON-PROD only) — a sibling of the ingest endpoint.
function getInspectCertificationsEndpoint(env = process.env) {
  return deriveFromIngest(env, 'superadmin/inspect-certifications');
}

// ADR-027 superadmin SESSION persistence.
function loadSuperadminSession(env = process.env) {
  const config = loadConfigFile(env);
  const s = config && typeof config === 'object' ? config.superadminSession : null;
  if (!s || typeof s !== 'object' || typeof s.token !== 'string' || !s.token) return null;
  if (s.expiresAt && Date.parse(s.expiresAt) <= Date.now()) return null; // expired
  return { email: s.email || null, token: s.token, expiresAt: s.expiresAt || null };
}

function saveSuperadminSession(session, env = process.env) {
  const config = loadConfigFile(env);
  config.superadminSession = {
    email: session.email || null,
    token: session.token,
    expiresAt: session.expiresAt || null,
  };
  saveConfigFile(config, env);
}

function clearSuperadminSession(env = process.env) {
  const config = loadConfigFile(env);
  if (config && typeof config === 'object' && 'superadminSession' in config) {
    delete config.superadminSession;
    saveConfigFile(config, env);
  }
}

module.exports = {
  getIngestEndpoint,
  getSynthesisEndpoint,
  getRoadmapEndpoint,
  getAgentEvaluationEndpoint,
  getLoginEndpoint,
  getAuthTokenEndpoint,
  getCompleteRegistrationEndpoint,
  getDeviceAuthorizeEndpoint,
  getDeviceTokenEndpoint,
  // Certification-by-dimension endpoints (`certify` = dimension LiveKit interview).
  getMyCertificationsEndpoint,
  // Role/cluster management (`add-role` / `change-role` / onboarding main-role step).
  getAvailableRolesEndpoint,
  getSetMainRoleEndpoint,
  getAssignedClustersEndpoint,
  getTemplatesByDimensionEndpoint,
  // Find Positions list (`find-projects` command / `find_projects` MCP tool).
  getFindPositionsEndpoint,
  // Marketplace (show-project / save-project / unsave-project / invitations).
  getPositionDetailEndpoint,
  getSavePositionEndpoint,
  getUnsavePositionEndpoint,
  getReceivedInvitationsEndpoint,
  getMyCandidaturesEndpoint,
  getMeAvailabilityEndpoint,
  getMeProfileEndpoint,
  getTalentMeProfileEndpoint,
  // Alma assistant (`ask` command / `ask` MCP tool) — separate service.
  getAlmaBase,
  getAlmaChatEndpoint,
  getAlmaDecisionEndpoint,
  getSkillsDeclareEndpoint,
  getSkillsResolveAddableEndpoint,
  getSkillsResolveMatchedEndpoint,
  getUsageDiscoveredInventoryEndpoint,
  getUsageReportEndpoint,
  getAiProfileEndpoint,
  // Evidence emission (talents-ai-score Phase 2, evidence-based evaluation).
  getEvidenceCliScanEndpoint,
  // Talent-portfolio endpoints (ADR-059).
  getPortfoliosDeclareEndpoint,
  getPortfoliosListEndpoint,
  getPortfolioDraftDescriptionEndpoint,
  getPortfolioUpdateEndpoint,
  // Talent-agent endpoints (talents-ai-score Phase 2 — "Add agent to profile").
  getAgentsDeclareEndpoint,
  getAgentsListEndpoint,
  getAgentsDraftFieldsEndpoint,
  getAgentPortfoliosEndpoint,
  // Onboarding / register flow (evaluation-mcp, ADR-011..015/024).
  getCertsBase,
  getHubBase,
  sanitizeStaleBakedEndpoints,
  getSignUpEndpoint,
  getImportProfileEndpoint,
  getMcpSignupEndpoint,
  getMyImportStatusEndpoint,
  getOneTimeTokenEndpoint,
  getOneTimeLoginUrl,
  getProfessionalDetailsEndpoint,
  getPricingRateEndpoint,
  getSetAvailabilityEndpoint,
  getLanguagesEndpoint,
  getLanguagesCatalogEndpoint,
  getMeSocialEndpoint,
  getMePortfoliosEndpoint,
  getTranslationsEndpoint,
  getTalentMeEndpoint,
  getOnboardingInterviewsEndpoint,
  getCompleteOnboardingEndpoint,
  getOnboardingRestartEndpoint,
  getOnboardingStatusEndpoint,
  getTalentProfileUrl,
  getEmailVerificationRequestUrl,
  getEmailVerificationVerifyUrl,
  getSuperadminSessionEndpoint,
  getInspectCertificationsEndpoint,
  // ADR-027 superadmin session persistence.
  loadSuperadminSession,
  saveSuperadminSession,
  clearSuperadminSession,
  // Persistent config file + endpoint safety (endpoint-config task).
  configFilePath,
  loadConfigFile,
  saveConfigFile,
  validateEndpoint,
  isAllowedShakersDomain,
  SHAKERS_CLI_DOMAINS,
  setIngestEndpoint,
  hasRetiredFallbackConfig,
  resolveIngestEndpoint,
  // Distribution profile (ADR-058 fase 1).
  VALID_PROFILES,
  getProfile,
  isTalentProfile,
  // UI language preference (env SHAKERS_CLI_LANG > config.json `lang`).
  VALID_UI_LANGS,
  getUiLang,
  // Baked backend target flavor (staging | dev | local).
  ENV_PROFILES,
  getEnvProfileName,
  getEnvProfile,
};
