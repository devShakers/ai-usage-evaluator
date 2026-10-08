'use strict';

const { postJsonWithTimeout } = require('./backend-request');

// Talent-skills client (talents-ai-score, ADR-054/055 — `start`'s "Añadir skills" route, src/start-add-skills.js).

const DEFAULT_TIMEOUT_MS = 20000;

// `works.*` business codes (WorksExceptionFilter's `codeMap`) -> this client's own reason vocabulary.
const WORKS_CODE_TO_REASON = {
  'certification.dimension_on_cooldown': 'dimension-on-cooldown',
  'interview.non_conversational_blocks_in_text': 'needs-web',
  'works.hub_token_missing': 'no-hub-token',
  'works.hub_session_expired': 'hub-session-expired',
  'works.hub_upstream_error': 'hub-upstream-error',
  'works.hub_unavailable': 'hub-unavailable',
  'works.ai_consent_required': 'ai-consent-required',
  'interview.already_started': 'interview-already-started',
  'interview.onboarding_not_found': 'onboarding-not-found',
  'assigned-clusters.already_assigned': 'already-assigned',
  'assigned-clusters.cap_reached': 'role-cap-reached',
  'assigned-clusters.invalid_cluster': 'invalid-cluster',
  'assigned-clusters.not_assigned': 'not-assigned',
};

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The certs session Bearer (standard `AuthGuard`, required on ALL THREE talent-skills routes — none of them is `@Public()`) plus, only when present, the Talent's own Hub token.
function authHeaders({ accessToken, hubAccessToken } = {}) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (typeof hubAccessToken === 'string' && hubAccessToken) headers['X-Hub-Token'] = hubAccessToken;
  return headers;
}

function reasonForError(status, raw) {
  const body = parseJson(raw);
  const code = body && typeof body.code === 'string' ? body.code : null;
  return (code && WORKS_CODE_TO_REASON[code]) || `http-${status}`;
}

// `POST .../skills/resolve-addable`.
async function requestResolveAddableSkills({ technologies, accessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };

  const body = { technologies: Array.isArray(technologies) ? technologies.filter((t) => typeof t === 'string' && t) : [] };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'POST', null, authHeaders({ accessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: reasonForError(res.status, res.raw) };
  }

  const json = parseJson(res.raw);
  const data = json && typeof json === 'object' && Array.isArray(json.data) ? json.data : null;
  if (!data) return { ok: false, reason: 'bad-response' };

  const addable = data
    .map((entry) => ({
      skillId: entry && typeof entry.skillId === 'number' ? entry.skillId : null,
      skillName: entry && typeof entry.skillName === 'string' ? entry.skillName : null,
      technology: entry && typeof entry.technology === 'string' ? entry.technology : null,
    }))
    .filter((s) => s.skillId !== null);
  return { ok: true, addable };
}

// `POST .../skills/declare`.
async function requestDeclareSkill({ skillId, accessToken, hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, { skillId }, timeoutMs, 'POST', null, authHeaders({ accessToken, hubAccessToken }));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }

  if (res.status < 200 || res.status >= 300) {
    if (res.status === 409) return { ok: false, reason: 'skill-exists' };
    return { ok: false, reason: reasonForError(res.status, res.raw) };
  }

  const json = parseJson(res.raw);
  if (!json || json.status !== 'OK' || !Array.isArray(json.data)) {
    return { ok: false, reason: 'bad-response' };
  }
  return { ok: true };
}

module.exports = { requestResolveAddableSkills, requestDeclareSkill, reasonForError, WORKS_CODE_TO_REASON };
