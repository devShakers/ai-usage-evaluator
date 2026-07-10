'use strict';

const http = require('http');
const https = require('https');

/*
 * Agent synthesis client (talents-ai-score, ADR-010 / ADR-011).
 *
 * "Mostrar siempre en local" for the LLM diagram means the CLI sends agent
 * DESCRIPTION content (free text the talent wrote in `.claude/agents/*.md`
 * and equivalents) to a Shakers hub endpoint on EVERY run — a deliberate,
 * gated reversal of the "never send content" invariant (ADR-003/ADR-009),
 * accepted with a MAXIMUM legal caveat (ADR-010) and legal sign-off reported
 * (ADR-011, 2026-07-10). This call is EPHEMERAL by design: the server
 * synthesizes a symbolic name + "what it does" per agent and returns it;
 * nothing about this call is gated by consent (consent only gates whether
 * the SEPARATE persistence payload — src/share.js — gets saved, and that
 * payload never carries this raw description text, only the structured
 * synthesis result).
 *
 * Mandatory mitigations (ADR-010):
 *   1. `scrubSecrets` — heuristic redaction of obvious secrets/PII BEFORE
 *      anything leaves the machine (API keys, bearer/JWT tokens, emails,
 *      absolute paths). An invisible safety net, not a flag or a disclosure.
 *   2. Resilience — network error, timeout, non-2xx, or an invalid/
 *      unexpected JSON shape all resolve to `null`. The caller (bin/report.js
 *      / src/render-html.js) is expected to fall back to the deterministic
 *      org chart (ADR-009) whenever this returns `null`: the local report
 *      must never hang or break because Shakers' synthesis endpoint is
 *      slow, down, or misbehaving.
 */

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

// Heuristic, best-effort redaction — an "invisible safety net" (ADR-011),
// not a substitute for the talent's own judgment about what they write in
// agent descriptions. Never throws; non-string input degrades to ''.
function scrubSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  out = out.replace(JWT_RE, '[REDACTED]');
  out = out.replace(BEARER_RE, 'Bearer [REDACTED]');
  out = out.replace(OPENAI_KEY_RE, '[REDACTED]');
  out = out.replace(AWS_KEY_RE, '[REDACTED]');
  out = out.replace(GENERIC_LONG_TOKEN_RE, '[REDACTED]');
  out = out.replace(EMAIL_RE, '[REDACTED]');
  out = out.replace(WINDOWS_PATH_RE, '[REDACTED]');
  out = out.replace(UNIX_PATH_RE, '[REDACTED]');
  return out;
}

/* ---------- request builder ---------- */

// Builds the `{ agents: [{name, description, tools, model, parent}] }`
// request body from the deterministic org chart (structure) + the
// descriptions (ADR-010's gated function) — scrubbing every description
// before it's ever assembled into the request.
function buildSynthesisRequest(structuralAgents, descriptionsByName) {
  const descMap = new Map((descriptionsByName || []).map((d) => [d.name, d.description]));
  return {
    agents: (structuralAgents || []).map((a) => ({
      name: a.name,
      description: scrubSecrets(descMap.get(a.name) || ''),
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || null,
      parent: a.parent || null,
    })),
  };
}

/* ---------- network (self-contained, test-friendly timeout) ---------- */

function postJsonWithTimeout(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(e);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(body));
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, raw }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('agent-synthesis: timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Validates the minimal expected shape: `{agents: [...], edges: [...]}`
// with `agents` an array (edges defaults to [] if absent/invalid — some
// diagrams may legitimately have none). Anything else is treated as an
// invalid response (ADR-011's fallback trigger).
function isValidSynthesisResponse(parsed) {
  return !!parsed && typeof parsed === 'object' && Array.isArray(parsed.agents);
}

// Requests the agent-synthesis endpoint. Returns `{agents, edges}` on
// success, or `null` on ANY failure (no endpoint configured, network error,
// timeout, non-2xx, invalid JSON, or an unexpected shape) — the caller
// always has a safe, non-throwing fallback signal.
//
// Defense in depth: `description` fields are re-scrubbed HERE, at the actual
// network boundary, regardless of whether the caller already scrubbed via
// `buildSynthesisRequest`. The "invisible safety net" (ADR-010) must hold
// even if a future caller forgets to build the request through that helper.
async function requestAgentSynthesis(requestBody, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return null;

  const safeBody = {
    ...requestBody,
    agents: Array.isArray(requestBody && requestBody.agents)
      ? requestBody.agents.map((a) => ({ ...a, description: scrubSecrets(a.description) }))
      : [],
  };

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, safeBody, timeoutMs);
  } catch {
    return null; // network error or timeout: never breaks the local report
  }

  if (res.status < 200 || res.status >= 300) return null;

  let parsed;
  try {
    parsed = JSON.parse(res.raw);
  } catch {
    return null; // malformed (non-JSON) response body
  }

  if (!isValidSynthesisResponse(parsed)) return null;

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
