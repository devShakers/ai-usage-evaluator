'use strict';

// Pricing-rate client (hub `works/talents/me/work-details/pricing-rate`, talent
// Bearer). READ-ONLY here: setting the rate is a financial PUT, left to register.

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function bearerHeaders(accessToken) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function money(m) {
  if (!m || typeof m !== 'object') return null;
  return { amount: typeof m.amount === 'number' ? m.amount : null, currency: typeof m.currency === 'string' ? m.currency : null };
}

async function requestPricingRate({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status === 404) return { ok: false, reason: 'not-found' };
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const env = parseJson(res.raw);
  const data = env && env.status === 'OK' ? env.data : env;
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };
  return {
    ok: true,
    pricing: {
      fullTimeSelected: data.fullTimeProjectSelected === true,
      fullTimePrice: money(data.fullTimeProjectPrice),
      partTimeSelected: data.partTimeProjectSelected === true,
      partTimePrice: money(data.partTimeProjectPrice),
    },
  };
}

async function fetchPricingRate(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getPricingRateEndpoint = require('./config').getPricingRateEndpoint,
    requestPricingRate: request = requestPricingRate,
  } = deps;
  const endpoint = getPricingRateEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, timeoutMs });
}

// PUT the pricing (upsert). Reuses the SAME endpoint + request the register
// pricing step uses, so `rate --set` and onboarding never diverge on the wire.
async function savePricingRate(deps = {}, { hubAccessToken, pricing, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getPricingRateEndpoint = require('./config').getPricingRateEndpoint,
    requestSetPricingRate = require('./onboarding-client').requestSetPricingRate,
  } = deps;
  const endpoint = getPricingRateEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return requestSetPricingRate({ pricing, hubAccessToken }, { endpoint, timeoutMs });
}

module.exports = {
  requestPricingRate,
  fetchPricingRate,
  savePricingRate,
};
