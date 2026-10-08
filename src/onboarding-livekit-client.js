'use strict';

// Thin certs adapter: exchange a created onboarding interview for LiveKit room credentials so the CLI can join over text (lk.chat).

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');
const { toUpperLang } = require('./lang-codes');

const DEFAULT_TIMEOUT_MS = 20000;
// Sub-path appended to `{base}/{interviewId}/` — the real post-merge certs
// route (sibling of `text-session`). Change this ONE constant if it moves.
const LIVEKIT_SESSION_PATH = 'livekit-text-session';
// Completion route: `PATCH {base}/{interviewId}/complete`.
const COMPLETE_SESSION_PATH = 'complete';

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function envelopeData(raw) {
  const json = parseJson(raw);
  if (!json || typeof json !== 'object' || json.status !== 'OK') return undefined;
  return json.data;
}

function bearerHeaders(accessToken) {
  const headers = {};
  if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function pickString(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

async function requestStartOnboardingLivekitSession(
  { interviewId, language, accessToken } = {},
  { base, path = LIVEKIT_SESSION_PATH, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!base) return { ok: false, reason: 'no-endpoint' };
  if (!interviewId) return { ok: false, reason: 'no-interview' };

  const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(interviewId)}/${path}`;
  const body = { language: toUpperLang(language) };
  let res;
  try {
    res = await postJsonWithTimeout(url, body, timeoutMs, 'POST', null, bearerHeaders(accessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };

  const data = envelopeData(res.raw);
  if (data === undefined || !data || typeof data !== 'object') return { ok: false, reason: 'bad-response' };

  const livekitUrl = pickString(data, ['livekitUrl', 'url', 'wsUrl', 'serverUrl']);
  const token = pickString(data, ['token', 'accessToken', 'participantToken']);
  const roomName = pickString(data, ['roomName', 'room', 'room_name']);
  const closingMessage = pickString(data, ['closingMessage', 'closing']);
  const resolvedId = pickString(data, ['interviewId', 'id']) || interviewId;

  if (!livekitUrl || !token) return { ok: false, reason: 'bad-response' };
  return { ok: true, livekitUrl, token, roomName: roomName || null, interviewId: resolvedId, closingMessage: closingMessage || null };
}

// Persist the onboarding interview's transcript on session end (the LiveKit text flow is the one path that was not sending it; certs already stores + serves it).
async function requestCompleteOnboardingLivekitSession(
  { interviewId, durationSeconds, transcripts, accessToken } = {},
  { base, path = COMPLETE_SESSION_PATH, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!base) return { ok: false, reason: 'no-endpoint' };
  if (!interviewId) return { ok: false, reason: 'no-interview' };
  if (!Array.isArray(transcripts) || transcripts.length === 0) return { ok: false, reason: 'no-transcript' };

  const url = `${base.replace(/\/+$/, '')}/${encodeURIComponent(interviewId)}/${path}`;
  const body = { transcripts };
  if (Number.isInteger(durationSeconds) && durationSeconds >= 0) body.durationSeconds = durationSeconds;

  let res;
  try {
    res = await postJsonWithTimeout(url, body, timeoutMs, 'PATCH', null, bearerHeaders(accessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: reasonForError(res.status, res.raw) };
  return { ok: true };
}

module.exports = {
  requestStartOnboardingLivekitSession,
  requestCompleteOnboardingLivekitSession,
  LIVEKIT_SESSION_PATH,
  COMPLETE_SESSION_PATH,
};
