'use strict';

const { postJsonWithTimeout } = require('./backend-request');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 20000;
const APPLICATION_SOURCE = 'NO_SOURCE';
const SELECTED_MESSAGE = 'manual';

const CANDIDATURE_CODE_TO_REASON = {
  'candidatures.already_exists': 'already-applied',
  'candidatures.position_not_available_for_application': 'position-unavailable',
  'candidatures.position_not_found': 'not-found',
  'candidatures.project_not_found': 'not-found',
  'candidatures.talent_not_found': 'talent-not-found',
  'candidatures.creation_failed': 'creation-failed',
};

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

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function normalizeQuestion(q) {
  if (!q || !text(q.text)) return null;
  if (q.type === 'MULTIPLE_CHOICE') {
    const options = Array.isArray(q.options) ? q.options.map(text).filter(Boolean) : [];
    return options.length ? { type: 'MULTIPLE_CHOICE', text: q.text.trim(), options } : null;
  }
  return { type: 'OPEN', text: q.text.trim() };
}

async function requestPositionApplication({ hubAccessToken } = {}, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
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
  const json = parseJson(res.raw);
  const data = json && json.status === 'OK' && json.data && typeof json.data === 'object' ? json.data : null;
  if (!data) return { ok: false, reason: 'bad-response' };
  if (data.redirectUrl || !data.position) return { ok: true, open: false };
  const p = data.position;
  const questions = p.questions && typeof p.questions === 'object' ? p.questions : {};
  return {
    ok: true,
    open: true,
    title: text(p.title),
    doubleCheck: text(p.doubleCheck),
    mainMotivationQuestion: text(questions.mainMotivationQuestion),
    questions: (Array.isArray(questions.extraQuestions) ? questions.extraQuestions : []).map(normalizeQuestion).filter(Boolean),
  };
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toHubMessage(message) {
  return escapeHtml(message.trim()).replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}

function buildCandidatureBody({ positionId, message, answers = [], mainMotivationQuestion }) {
  const chat = text(message) ? toHubMessage(message) : null;
  const extra = answers.filter((a) => a && text(a.question) && (Array.isArray(a.answer) ? a.answer.length > 0 : text(a.answer)));
  const questions = {};
  if (chat) questions.main_motivation = { question: mainMotivationQuestion, answer: chat };
  if (extra.length) questions.extra_questions = extra.map((a) => ({ question: a.question, answer: Array.isArray(a.answer) ? a.answer : a.answer.trim() }));
  const form = { selectedMessage: SELECTED_MESSAGE };
  if (Object.keys(questions).length) form.questions = questions;
  return {
    positionId,
    applicationSource: APPLICATION_SOURCE,
    ...(chat ? { sendPresentationChatMessage: chat } : {}),
    form,
  };
}

async function requestCreateCandidature({ hubAccessToken } = {}, { endpoint, body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  if (!hubAccessToken) return { ok: false, reason: 'no-hub-token' };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs, 'POST', null, bearerHeaders(hubAccessToken));
  } catch (e) {
    return { ok: false, reason: (e && e.kind) || 'network-error' };
  }
  const json = parseJson(res.raw);
  if (res.status < 200 || res.status >= 300) {
    const code = json && typeof json.code === 'string' ? json.code : null;
    const reason = (code && CANDIDATURE_CODE_TO_REASON[code]) || reasonForError(res.status, res.raw);
    const meta = json && json.meta && typeof json.meta === 'object' ? json.meta : {};
    return reason === 'already-applied'
      ? { ok: false, reason, applicationStatus: text(meta.applicationStatus) }
      : { ok: false, reason };
  }
  const data = json && json.status === 'OK' && json.data && typeof json.data === 'object' ? json.data : null;
  if (!data) return { ok: false, reason: 'bad-response' };
  return { ok: true, candidatureId: data.candidatureId || null, status: text(data.status), chatId: data.chatId || null };
}

async function loadApplication(deps = {}, { hubAccessToken, positionId, timeoutMs } = {}) {
  const {
    getPositionApplicationEndpoint = require('./config').getPositionApplicationEndpoint,
    fetchPositionDetail = (opts) => require('./show-project-client').fetchPositionDetail({}, opts),
    requestPositionApplication: request = requestPositionApplication,
  } = deps;
  const endpoint = getPositionApplicationEndpoint(positionId);
  if (!endpoint) return { ok: false, reason: positionId ? 'no-endpoint' : 'no-id' };
  const [application, detail] = await Promise.all([
    request({ hubAccessToken }, { endpoint, timeoutMs }),
    fetchPositionDetail({ hubAccessToken, positionId }).catch(() => null),
  ]);
  if (!application.ok || !application.open) return application;
  const company = detail && detail.ok && detail.position && detail.position.company ? text(detail.position.company.name) : null;
  return { ...application, company };
}

async function submitApplication(deps = {}, { hubAccessToken, positionId, message, answers, mainMotivationQuestion, timeoutMs } = {}) {
  const {
    getCandidaturesEndpoint = require('./config').getCandidaturesEndpoint,
    requestCreateCandidature: request = requestCreateCandidature,
  } = deps;
  const body = buildCandidatureBody({ positionId, message, answers, mainMotivationQuestion });
  return request({ hubAccessToken }, { endpoint: getCandidaturesEndpoint(), body, timeoutMs });
}

function applicationSummary(t, { title, company, doubleCheck }, { message, answers = [] }) {
  return [
    t.summaryTitle,
    t.titleLine(title || t.untitled),
    company ? t.companyLine(company) : null,
    t.messageLine(text(message) || t.empty),
    ...answers.map((a) => t.answerLine(a.question, Array.isArray(a.answer) ? a.answer.join(', ') : a.answer)),
    t.sendNotice(title || t.untitled),
    doubleCheck && doubleCheck !== 'NO' ? t.reviewNotice : null,
  ].filter(Boolean);
}

module.exports = {
  APPLICATION_SOURCE,
  requestPositionApplication,
  requestCreateCandidature,
  buildCandidatureBody,
  loadApplication,
  submitApplication,
  applicationSummary,
};
