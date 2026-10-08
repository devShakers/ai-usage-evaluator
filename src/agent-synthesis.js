'use strict';

const { requestBackend } = require('./backend-request');
const { reporterFor, REASON } = require('./model-call-record');

// Agent synthesis client (talents-ai-score, ADR-010 / ADR-011).

const DEFAULT_TIMEOUT_MS = 8000;

/* ---------- scrub (mandatory mitigation) ---------- */

const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER_RE = /\bBearer\s+\S{10,}/gi;
const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9]{16,}\b/g;
const AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/g;
const GENERIC_LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const WINDOWS_PATH_RE = /[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+/g;
const UNIX_PATH_RE = /(?:\/[A-Za-z0-9_.-]+){2,}/g;

const KEY_PREFIX_RE = /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|xox[baprs])[-_][A-Za-z0-9_-]{10,}\b/g; // OpenAI/Stripe/GitHub/Slack-style prefixed tokens
const GITHUB_PAT_RE = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
const GOOGLE_API_KEY_RE = /\bAIza[0-9A-Za-z_-]{35}\b/g;
const SENDGRID_KEY_RE = /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const BASE64_SECRET_RE = /\b[A-Za-z0-9+/]{40,}={0,2}\b/g; // base64-inclusive high-entropy blob (e.g. an AWS secret access key)
const JWT_LIKE_RE = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g; // dot-separated JWT-shaped triplet not starting with `eyJ`
const PEM_BLOCK_RE = /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g;
const CONN_STRING_RE = /\b([a-zA-Z][a-zA-Z0-9+.-]{1,15}:\/\/)[^\s'"/:@]+:[^\s'"@]+@/g; // scheme://user:pass@ -> scheme://[REDACTED]@
const GENERIC_KV_RE = /\b(?:password|secret|token|api[_-]?key|bearer)\s*[:=]\s*\S+/gi;

// Heuristic, best-effort redaction — an "invisible safety net" (ADR-011), not a substitute for the talent's own judgment about what they write in agent descriptions.
function scrubSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  out = out.replace(PEM_BLOCK_RE, '[REDACTED]');
  out = out.replace(CONN_STRING_RE, '$1[REDACTED]@');
  out = out.replace(JWT_RE, '[REDACTED]');
  out = out.replace(BEARER_RE, 'Bearer [REDACTED]');
  out = out.replace(OPENAI_KEY_RE, '[REDACTED]');
  out = out.replace(AWS_KEY_RE, '[REDACTED]');
  out = out.replace(KEY_PREFIX_RE, '[REDACTED]');
  out = out.replace(GITHUB_PAT_RE, '[REDACTED]');
  out = out.replace(GOOGLE_API_KEY_RE, '[REDACTED]');
  out = out.replace(SENDGRID_KEY_RE, '[REDACTED]');
  out = out.replace(JWT_LIKE_RE, '[REDACTED]');
  out = out.replace(GENERIC_LONG_TOKEN_RE, '[REDACTED]');
  out = out.replace(BASE64_SECRET_RE, '[REDACTED]');
  out = out.replace(GENERIC_KV_RE, '[REDACTED]');
  out = out.replace(EMAIL_RE, '[REDACTED]');
  out = out.replace(WINDOWS_PATH_RE, '[REDACTED]');
  out = out.replace(UNIX_PATH_RE, '[REDACTED]');
  return out;
}

/* ---------- request builder ---------- */

function buildSynthesisRequest(structuralAgents, descriptionsByName, consentGranted = false) {
  const descMap = new Map((descriptionsByName || []).map((d) => [d.name, d.description]));
  return {
    agents: (structuralAgents || []).map((a) => ({
      name: a.name,
      description: scrubSecrets(descMap.get(a.name) || ''),
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || null,
      parent: a.parent || null,
    })),
    ...(consentGranted === true ? { traceContentConsent: true } : {}),
  };
}

/* ---------- network (via the shared PRIMARY -> FALLBACK chain) ---------- */

// Validates the minimal expected shape: `{agents: [...], edges: [...]}` with `agents` an array (edges defaults to [] if absent/invalid — some diagrams may legitimately have none).
function isValidSynthesisResponse(parsed) {
  return !!parsed && typeof parsed === 'object' && Array.isArray(parsed.agents);
}

// Requests the agent-synthesis endpoint.
async function requestAgentSynthesis(requestBody, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS, onOutcome = null } = {}) {
  // Issue 109: the four `return null`s below are four DIFFERENT situations that used to be one.
  const outcome = reporterFor(onOutcome, { timeoutMs });
  if (!endpoint) {
    outcome.skip(REASON.NO_ENDPOINT);
    return null;
  }

  const safeBody = {
    ...requestBody,
    agents: Array.isArray(requestBody && requestBody.agents)
      ? requestBody.agents.map((a) => ({ ...a, description: scrubSecrets(a.description) }))
      : [],
  };
  if (safeBody.traceContentConsent !== true) delete safeBody.traceContentConsent;

  let res;
  try {
    res = await requestBackend({ endpoint, body: safeBody, timeoutMs, trace: outcome.hops });
  } catch (e) {
    outcome.failFromError(e);
    return null; // network error or timeout on every hop: never breaks the local report
  }

  if (res.status < 200 || res.status >= 300) {
    outcome.fail(REASON.HTTP, { status: res.status, backend: res.backend });
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.raw);
  } catch {
    outcome.fail(REASON.MALFORMED_JSON, { status: res.status, backend: res.backend });
    return null; // malformed (non-JSON) response body
  }

  if (!isValidSynthesisResponse(parsed)) {
    outcome.fail(REASON.UNEXPECTED_SHAPE, { status: res.status, backend: res.backend });
    return null;
  }

  outcome.succeed({ status: res.status, backend: res.backend });
  return {
    agents: parsed.agents,
    edges: Array.isArray(parsed.edges) ? parsed.edges : [],
  };
}

module.exports = {
  scrubSecrets,
  buildSynthesisRequest,
  requestAgentSynthesis,
};
