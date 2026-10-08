'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getHubBase,
  getSignUpEndpoint,
  getCompleteRegistrationEndpoint,
  getAuthTokenEndpoint,
  getImportProfileEndpoint,
  getProfessionalDetailsEndpoint,
  getPricingRateEndpoint,
  getOnboardingInterviewsEndpoint,
  getCompleteOnboardingEndpoint,
  getTalentProfileUrl,
  getLoginEndpoint,
  getDeviceAuthorizeEndpoint,
  getDeviceTokenEndpoint,
  getAgentPortfoliosEndpoint,
  ENV_PROFILES,
} = require('../src/config');

const INGEST = 'https://certs.example.com/api/v1/usage/reports';
const HUB = 'https://hub.example.com/api/v1';
const NOCFG = '/nonexistent-config-dir-xyz';
// With no explicit hub base anywhere, the getters fall to the baked flavor
// (ADR-065 revised) — `dev` in this checkout — NOT to the certs ingest.
const DEV = ENV_PROFILES.dev;

test('hub-routed endpoints derive from SHAKERS_CLI_HUB_BASE, not from the certs ingest', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: INGEST, SHAKERS_CLI_HUB_BASE: HUB, AI_FOOTPRINT_CONFIG_DIR: NOCFG };
  assert.equal(getHubBase(env), HUB);
  // better-auth email register (owner decision, supersedes ADR-031 for email).
  assert.equal(getSignUpEndpoint(env), 'https://hub.example.com/api/v1/auth/sign-up/email');
  assert.equal(getCompleteRegistrationEndpoint(env), 'https://hub.example.com/api/v1/works/auth/complete-registration');
  assert.equal(getAuthTokenEndpoint(env), 'https://hub.example.com/api/v1/auth/token');
  assert.equal(getImportProfileEndpoint(env), 'https://hub.example.com/api/v1/works/me/import-profile');
  assert.equal(getProfessionalDetailsEndpoint(env), 'https://hub.example.com/api/v1/works/me/professional-details');
  assert.equal(getPricingRateEndpoint(env), 'https://hub.example.com/api/v1/works/talents/me/work-details/pricing-rate');
  assert.equal(getCompleteOnboardingEndpoint(env), 'https://hub.example.com/api/v1/works/talents/me/complete-onboarding');
});

test('getAgentPortfoliosEndpoint derives the DIRECT-to-hub relate route with the id in the path (ADR-041)', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: INGEST, SHAKERS_CLI_HUB_BASE: HUB, AI_FOOTPRINT_CONFIG_DIR: NOCFG };
  assert.equal(getAgentPortfoliosEndpoint(99, env), 'https://hub.example.com/api/v1/works/me/agents/99/portfolios');
  assert.equal(getAgentPortfoliosEndpoint('a b', env), 'https://hub.example.com/api/v1/works/me/agents/a%20b/portfolios');
  // No explicit hub base -> derives from the baked hub base (NOT the certs ingest).
  assert.equal(
    getAgentPortfoliosEndpoint(99, { AI_FOOTPRINT_INGEST_ENDPOINT: INGEST, AI_FOOTPRINT_CONFIG_DIR: NOCFG }),
    `${DEV.hubBase}/works/me/agents/99/portfolios`,
  );
});

test('the interviews base stays on certs (ingest sibling)', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: INGEST, SHAKERS_CLI_HUB_BASE: HUB, AI_FOOTPRINT_CONFIG_DIR: NOCFG };
  assert.equal(getOnboardingInterviewsEndpoint(env), 'https://certs.example.com/api/v1/interviews');
});

test('hub endpoints fall to the baked hub base (never the certs ingest) when no hub base is set', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: INGEST, AI_FOOTPRINT_CONFIG_DIR: '/nonexistent-config-dir-xyz' };
  assert.equal(getHubBase(env), DEV.hubBase);
  assert.equal(getImportProfileEndpoint(env), `${DEV.hubBase}/works/me/import-profile`);
  assert.equal(getCompleteOnboardingEndpoint(env), `${DEV.hubBase}/works/talents/me/complete-onboarding`);
  // The interviews base still rides the explicit certs ingest, not the hub.
  assert.equal(getOnboardingInterviewsEndpoint(env), 'https://certs.example.com/api/v1/interviews');
});

test('hub base trailing slash is stripped; legacy AI_FOOTPRINT_HUB_BASE honoured', () => {
  assert.equal(getHubBase({ SHAKERS_CLI_HUB_BASE: 'https://hub/api/v1/' }), 'https://hub/api/v1');
  assert.equal(getHubBase({ AI_FOOTPRINT_HUB_BASE: 'https://legacy/api/v1' }), 'https://legacy/api/v1');
});

test('explicit per-endpoint override still wins over the hub base', () => {
  const env = { SHAKERS_CLI_HUB_BASE: HUB, SHAKERS_CLI_IMPORT_PROFILE_ENDPOINT: '  https://x/import  ' };
  assert.equal(getImportProfileEndpoint(env), 'https://x/import');
});

// Email login derives the better-auth sign-in from the hub base; Google now uses the device-flow broker endpoints (RFC 8628), also hub-derived.
test('email sign-in and the device-flow endpoints derive from the hub base', () => {
  const env = { AI_FOOTPRINT_INGEST_ENDPOINT: INGEST, SHAKERS_CLI_HUB_BASE: HUB, AI_FOOTPRINT_CONFIG_DIR: NOCFG };
  assert.equal(getLoginEndpoint(env), 'https://hub.example.com/api/v1/auth/sign-in/email');
  assert.equal(getDeviceAuthorizeEndpoint(env), 'https://hub.example.com/api/v1/auth/device/code');
  assert.equal(getDeviceTokenEndpoint(env), 'https://hub.example.com/api/v1/works/auth/device/token');
});

test('login/device endpoints: explicit env override wins, trimmed; else the baked hub base (never the certs proxy)', () => {
  assert.equal(getLoginEndpoint({ SHAKERS_CLI_LOGIN_ENDPOINT: '  https://x/login  ', AI_FOOTPRINT_CONFIG_DIR: NOCFG }), 'https://x/login');
  assert.equal(getDeviceAuthorizeEndpoint({ SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT: '  https://x/dev/authorize  ', AI_FOOTPRINT_CONFIG_DIR: NOCFG }), 'https://x/dev/authorize');
  assert.equal(getDeviceTokenEndpoint({ SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT: '  https://x/dev/token  ', AI_FOOTPRINT_CONFIG_DIR: NOCFG }), 'https://x/dev/token');
  // certs ingest set but no hub base -> the baked hub base, NOT the certs proxy (login no longer rides certs).
  assert.equal(getLoginEndpoint({ AI_FOOTPRINT_INGEST_ENDPOINT: INGEST, AI_FOOTPRINT_CONFIG_DIR: NOCFG }), `${DEV.hubBase}/auth/sign-in/email`);
  assert.equal(getDeviceAuthorizeEndpoint({ AI_FOOTPRINT_CONFIG_DIR: NOCFG }), `${DEV.hubBase}/auth/device/code`);
  assert.equal(getDeviceTokenEndpoint({ AI_FOOTPRINT_CONFIG_DIR: NOCFG }), `${DEV.hubBase}/works/auth/device/token`);
});

test('getTalentProfileUrl: explicit override else the baked profile URL, trailing slash stripped', () => {
  // No explicit profile URL -> the baked flavor's profile URL (dev here).
  assert.equal(getTalentProfileUrl({ AI_FOOTPRINT_INGEST_ENDPOINT: INGEST, SHAKERS_CLI_HUB_BASE: HUB, AI_FOOTPRINT_CONFIG_DIR: NOCFG }), DEV.profileUrl);
  assert.equal(getTalentProfileUrl({ SHAKERS_CLI_PROFILE_URL: 'https://shakers.test/talent/' }), 'https://shakers.test/talent');
});
