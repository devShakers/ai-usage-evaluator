'use strict';

// Received-invitations client (hub `works/positions/received-invitations`,
// talent Bearer). Returns the talent's UNREAD position invitations.

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

function normalizeInvitation(raw) {
  const it = raw && typeof raw === 'object' ? raw : {};
  return {
    projectId: typeof it.projectId === 'string' ? it.projectId : null,
    name: typeof it.name === 'string' ? it.name : null,
    invitationChatId: typeof it.invitationChatId === 'string' ? it.invitationChatId : null,
  };
}

async function requestReceivedInvitations({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, null, timeoutMs, 'GET', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const env = parseJson(res.raw);
  const data = env && env.status === 'OK' ? env.data : env;
  const rows = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : null);
  if (!rows) return { ok: false, reason: 'bad-response' };
  return { ok: true, items: rows.map(normalizeInvitation) };
}

async function fetchInvitations(deps = {}, { hubAccessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getReceivedInvitationsEndpoint = require('./config').getReceivedInvitationsEndpoint,
    requestReceivedInvitations: request = requestReceivedInvitations,
  } = deps;
  const endpoint = getReceivedInvitationsEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return request({ hubAccessToken }, { endpoint, timeoutMs });
}

module.exports = {
  normalizeInvitation,
  requestReceivedInvitations,
  fetchInvitations,
};
