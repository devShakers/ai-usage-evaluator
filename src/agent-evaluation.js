'use strict';

const http = require('http');
const https = require('https');
const { scrubSecrets } = require('./agent-synthesis');

/*
 * Agent definition-quality evaluation client (ADR-016, agent evaluation).
 *
 * This is the CLIENT half of an ephemeral, server-side LLM feature — the SAME
 * shape as src/agent-synthesis.js. The CLI never calls a model directly (it is
 * a zero-dependency, key-less public tool); it POSTs the agent DEFINITIONS to a
 * Shakers Hub endpoint that runs the model server-side and returns a score +
 * rationale per agent. Observability (tokens / cost / latency / trace) lives on
 * the server; the client contributes a versioned prompt id so the server can
 * attribute the trace.
 *
 * MODEL (design deliverable, implemented server-side): gemini-2.5-flash, ONE
 * batched call for all agents. Definition-quality scoring is a bounded,
 * rubric-based judgment over short text — flash is fast (~1-2s) and sub-cent
 * per run, and this runs on every footprint (latency-sensitive, like synthesis).
 * gemini-2.5-pro was reserved (ADR-005) for the harder task of judging CODE.
 *
 * FROZEN CONTRACT (must match the parallel hub-backend implementation exactly):
 *   POST <ingest-sibling>/agent-evaluation
 *   req:  { agents: [{ name, definition, tools, model, parent }],
 *           promptVersion: "agent-eval-v1" }
 *   resp: { evaluations: [{ name, score:0-100 int, rationale:string }] }
 *
 * Mandatory mitigations (mirroring agent-synthesis.js):
 *   1. scrubSecrets — every `definition` is scrubbed BEFORE it leaves the
 *      machine (reused from agent-synthesis.js, the same "invisible safety
 *      net"), and re-scrubbed at the network boundary (defense in depth).
 *   2. Resilience — no endpoint, network error, timeout, non-2xx, invalid JSON
 *      or an unexpected shape all resolve to `null`; the caller (bin/report.js)
 *      simply shows no scores. The local report must never hang or break
 *      because the evaluation endpoint is slow, down, or misbehaving.
 */

const DEFAULT_TIMEOUT_MS = 8000;
const PROMPT_VERSION = 'agent-eval-v1';

/* ---------- request builder ---------- */

// Builds the frozen-contract body from the deterministic org chart (structure)
// + the raw descriptions (ADR-010's gated parse), scrubbing each definition.
function buildAgentEvaluationRequest(structuralAgents, descriptionsByName) {
  const descMap = new Map((descriptionsByName || []).map((d) => [d.name, d.description]));
  return {
    agents: (structuralAgents || []).map((a) => ({
      name: a.name,
      definition: scrubSecrets(descMap.get(a.name) || ''),
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || null,
      parent: a.parent || null,
    })),
    promptVersion: PROMPT_VERSION,
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
    req.on('timeout', () => req.destroy(new Error('agent-evaluation: timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function isValidEvaluationResponse(parsed) {
  return !!parsed && typeof parsed === 'object' && Array.isArray(parsed.evaluations);
}

// Server scores are never trusted verbatim: coerce to an integer, clamp to
// [0,100], drop anything without a usable numeric score. rationale defaults to
// '' rather than trusting a non-string.
function normalizeEvaluations(list) {
  return (Array.isArray(list) ? list : [])
    .filter((e) => e && typeof e.name === 'string')
    .map((e) => {
      const n = Number(e.score);
      const score = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
      return { name: e.name, score, rationale: typeof e.rationale === 'string' ? e.rationale : '' };
    })
    .filter((e) => e.score !== null);
}

// Requests the agent-evaluation endpoint. Returns
// `{ evaluations:[{name,score,rationale}], promptVersion }` on success, or
// `null` on ANY failure — the caller always has a safe, non-throwing signal.
// Definitions are re-scrubbed HERE, at the network boundary, even if the caller
// already scrubbed via buildAgentEvaluationRequest (defense in depth).
async function requestAgentEvaluation(requestBody, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return null;

  const promptVersion = (requestBody && requestBody.promptVersion) || PROMPT_VERSION;
  const safeBody = {
    promptVersion,
    agents: Array.isArray(requestBody && requestBody.agents)
      ? requestBody.agents.map((a) => ({ ...a, definition: scrubSecrets(a.definition) }))
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
    return null; // malformed (non-JSON) body
  }

  if (!isValidEvaluationResponse(parsed)) return null;

  return { evaluations: normalizeEvaluations(parsed.evaluations), promptVersion };
}

module.exports = {
  PROMPT_VERSION,
  buildAgentEvaluationRequest,
  requestAgentEvaluation,
};
