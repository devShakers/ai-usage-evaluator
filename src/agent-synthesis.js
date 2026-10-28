'use strict';

const { requestBackend } = require('./backend-request');
const { reporterFor, REASON } = require('./model-call-record');

// Agent synthesis client.

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
const SECRET_KV_RE = /\b((?:[A-Za-z0-9_-]*?(?:password|passwd|passphrase|secrets?|token|api[_-]?key|private[_-]?key|credentials?|authorization|contrase(?:ñ|n)a)|(?:[A-Za-z0-9]+[_-])*(?:pass|pwd|auth))(?:[_-][A-Za-z0-9_-]*)?["']?[ \t]*[:=][ \t]*)(?:(?:basic|bearer|digest)[ \t]+)?(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/gi;
const PASSWORD_FLAG_RE = /(--pass(?:word)?[ \t]+)(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/gi;
const MYSQL_PASSWORD_RE = /(\b(?:mysql|mariadb|mysqldump|mysqladmin|mysqlimport|mysqlshow)\b[^\n|;&]*?[ \t]-p)[^\s]+/g;
const USER_PASS_FLAG_RE = /((?:^|\s)(?:-u[ \t]*|--user[= \t][ \t]*)["']?[^\s:'"]+:)(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/g;
const SPOKEN_PASSWORD_RE = /(\b(?:password|passwd|pwd|contrase(?:ñ|n)a)[ \t]+(?:is|was|es|era)[ \t]*:?[ \t]+)(?!(?:required|missing|wrong|invalid|incorrect|correct|not|empty|set|stored|hashed|too|the|a|an|valid|expired|obligatoria|incorrecta|correcta|necesaria|requerida|inválida|válida|la|el|un|una|no|muy)(?![\wáéíóúñ]))(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)/gi;

const WORD_START = String.raw`(?<![\p{L}\p{N}_])`;
const WORD_END = String.raw`(?![\p{L}\p{N}_])`;
const PASSWORD_LABEL = String.raw`(?:passwords?|passwd|pwd|contrase[ñn]as?|contrasenyas?|claves?|senhas?|mots?[ \t]+de[ \t]+passe|passw[oö]rt|parola[ \t]+d['’]ordine|wachtwoord|has[łl]o)`;
const QUOTED_VALUE = String.raw`"[^"\n]*"|'[^'\n]*'`;
const LABELLED_PASSWORD_RE = new RegExp(String.raw`(${WORD_START}${PASSWORD_LABEL}${WORD_END}["']?[ \t]*[:=][ \t]*)(?:${QUOTED_VALUE}|[^\s"']+)`, 'giu');
const SPOKEN_LABELLED_PASSWORD_RE = new RegExp(String.raw`(${WORD_START}${PASSWORD_LABEL}${WORD_END}[ \t]+(?:is|es|és|é|est|ist|è)[ \t]*:?[ \t]+)(?:${QUOTED_VALUE}|(?=[^\s"']*\d)[^\s"']+)`, 'giu');
const PASSWORD_MENTION_RE = new RegExp(String.raw`${WORD_START}${PASSWORD_LABEL}${WORD_END}[ \t]*(?:["']?[ \t]*[:=]|[ \t](?:is|es|és|é|est|ist|è)${WORD_END})`, 'iu');
const USER_LABEL = String.raw`(?:usuarios?|users?|username|user[_-]name|login|e-?mail|correo)`;
const USER_KV_RE = new RegExp(String.raw`(${WORD_START}${USER_LABEL}${WORD_END}["']?[ \t]*[:=][ \t]*)(?:${QUOTED_VALUE}|[^\s"',]+)`, 'giu');
const URL_RE = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s"'<>()]+/gi;
const CREDENTIAL_HINT_RE = new RegExp(String.raw`${WORD_START}(?:${PASSWORD_LABEL}|secrets?|api[ _-]?keys?|apikey|tokens?|credentials?|credenciales?|private[ _-]?key|access[ _-]?key|bearer)${WORD_END}["']?[ \t]*(?:[:=]|(?:is|es|és|é|est|ist|è)${WORD_END})`, 'iu');
const ENTROPY_SYMBOL_RE = /[!#$%&*+?@^~|]/;
const CODE_SHAPE_RE = /[/\\()[\]{}<>;,"'`]|==|=>|&&|\|\||[+\-*]=/;
const PACKAGE_VERSION_RE = /^@?[a-z0-9._-]+(?:\/[a-z0-9._-]+)?@[\^~]?\d+(?:\.\d+)*/;
const ENV_REFERENCE_RE = /^\$[A-Z_][A-Z0-9_]*$/;

function scrubCredentialPairs(text) {
  return text
    .split(/(\n[ \t]*\n)/)
    .map((block) => {
      if (!PASSWORD_MENTION_RE.test(block)) return block;
      const userless = block.replace(USER_KV_RE, '$1[REDACTED]');
      return userless === block ? block : userless.replace(URL_RE, '[REDACTED]');
    })
    .join('');
}

function isHighEntropyToken(core) {
  return (
    core.length >= 12 &&
    /[A-Za-z]/.test(core) &&
    /\d/.test(core) &&
    ENTROPY_SYMBOL_RE.test(core) &&
    !CODE_SHAPE_RE.test(core) &&
    !PACKAGE_VERSION_RE.test(core) &&
    !ENV_REFERENCE_RE.test(core) &&
    !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(core)
  );
}

function tokenCore(token) {
  return token.replace(/^["'`([{<]+/, '').replace(/[)"'`\]}>.,;:]+$/, '');
}

function hasHighEntropyToken(text) {
  return (text.match(/\S{12,}/g) || []).some((token) => isHighEntropyToken(tokenCore(token)));
}

function looksLikeCredential(text) {
  return typeof text === 'string' && (CREDENTIAL_HINT_RE.test(text) || hasHighEntropyToken(text));
}

function scrubHighEntropyTokens(text) {
  return text.replace(/\S{12,}/g, (token) => {
    const core = tokenCore(token);
    return isHighEntropyToken(core) ? token.replace(core, '[REDACTED]') : token;
  });
}

// Heuristic, best-effort redaction — an "invisible safety net", not a substitute for the talent's own judgment about what they write in agent descriptions.
function scrubSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = scrubCredentialPairs(text);
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
  out = out.replace(MYSQL_PASSWORD_RE, '$1[REDACTED]');
  out = out.replace(USER_PASS_FLAG_RE, '$1[REDACTED]');
  out = out.replace(PASSWORD_FLAG_RE, '$1[REDACTED]');
  out = out.replace(SPOKEN_PASSWORD_RE, '$1[REDACTED]');
  out = out.replace(SECRET_KV_RE, '$1[REDACTED]');
  out = out.replace(SPOKEN_LABELLED_PASSWORD_RE, '$1[REDACTED]');
  out = out.replace(LABELLED_PASSWORD_RE, '$1[REDACTED]');
  out = out.replace(EMAIL_RE, '[REDACTED]');
  out = out.replace(WINDOWS_PATH_RE, '[REDACTED]');
  out = out.replace(UNIX_PATH_RE, '[REDACTED]');
  return scrubHighEntropyTokens(out);
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
  // The four `return null`s below are four DIFFERENT situations that used to be one.
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
  looksLikeCredential,
  buildSynthesisRequest,
  requestAgentSynthesis,
};
