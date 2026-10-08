'use strict';

const { postJsonWithTimeout } = require('./backend-request');

// OAuth 2.0 Device Authorization Grant (RFC 8628) client against the Hub broker.

const DEFAULT_TIMEOUT_MS = 20000;

const CLIENT_ID = 'shakers-cli';
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function unwrap(json) {
  if (json && typeof json === 'object' && json.data && typeof json.data === 'object') return json.data;
  return json && typeof json === 'object' ? json : null;
}

function str(value) {
  return typeof value === 'string' && value ? value : null;
}

function posInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

async function requestDeviceAuthorization({ endpoint, clientId = CLIENT_ID, scope = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  const body = { client_id: clientId };
  if (scope) body.scope = scope;
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs);
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  const { status, raw } = res;
  if (status === 502 || status === 503) return { ok: false, reason: 'upstream', status };
  if (status < 200 || status >= 300) return { ok: false, reason: 'http-error', status };

  const data = unwrap(parseJson(raw));
  const deviceCode = data && str(data.device_code);
  const userCode = data && str(data.user_code);
  const verificationUri = data && str(data.verification_uri);
  if (!deviceCode || !userCode || !verificationUri) return { ok: false, reason: 'bad-response', status };

  return {
    ok: true,
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: (data && str(data.verification_uri_complete)) || verificationUri,
    expiresIn: (data && posInt(data.expires_in)) || 600,
    interval: (data && posInt(data.interval)) || 5,
  };
}

// One poll. Success carries the better-auth SESSION token (access_token), NOT the API JWT.
async function requestDeviceToken({ deviceCode, clientId = CLIENT_ID }, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { status: 'error', reason: 'no-endpoint' };
  if (!deviceCode) return { status: 'error', reason: 'no-device-code' };
  const body = { grant_type: DEVICE_GRANT_TYPE, device_code: deviceCode, client_id: clientId };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs);
  } catch (e) {
    return { status: 'error', reason: (e && e.kind) || 'network-error' };
  }
  const { status, raw } = res;
  const data = unwrap(parseJson(raw));

  if (status >= 200 && status < 300) {
    const accessToken = data && (str(data.access_token) || str(data.accessToken) || str(data.token));
    if (!accessToken) return { status: 'error', reason: 'bad-response', http: status };
    return {
      status: 'authorized',
      accessToken,
      tokenType: (data && str(data.token_type)) || 'Bearer',
      expiresIn: data && posInt(data.expires_in),
      isNewUser: !!(data && (data.isNewUser === true || data.is_new_user === true)),
      email: data && (str(data.email) || str(data.userEmail)),
    };
  }

  const code = data && (str(data.error) || str(data.code));
  if (code === 'authorization_pending') return { status: 'pending' };
  if (code === 'slow_down') return { status: 'slow_down' };
  if (code === 'access_denied') return { status: 'denied' };
  if (code === 'expired_token') return { status: 'expired' };
  if (status === 502 || status === 503) return { status: 'error', reason: 'upstream', http: status };
  return { status: 'error', reason: code || 'http-error', http: status };
}

async function requestApiToken({ accessToken }, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!accessToken) return { ok: false, reason: 'no-access-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, { Authorization: `Bearer ${accessToken}` });
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  const { status, raw } = res;
  if (status === 502 || status === 503) return { ok: false, reason: 'upstream', status };
  if (status < 200 || status >= 300) return { ok: false, reason: 'http-error', status };
  const data = unwrap(parseJson(raw));
  const token = data && str(data.token);
  if (!token) return { ok: false, reason: 'bad-response', status };
  return { ok: true, token };
}

module.exports = { requestDeviceAuthorization, requestDeviceToken, requestApiToken, CLIENT_ID, DEVICE_GRANT_TYPE, DEFAULT_TIMEOUT_MS };
