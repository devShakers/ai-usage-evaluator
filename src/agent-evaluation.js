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

// Definition-quality scoring runs a real model with a raised token/thinking
// budget server-side, so it is INHERENTLY slow — ~15-16s for 8 agents on the
// live backend. The timeout must comfortably exceed that or the CLI aborts
// early → null → no scores render (this was the "scores never show" bug: the
// old 8s default fired before the ~15.7s response arrived). 60s leaves ample
// head-room. (agent-synthesis.js keeps its own short 8s default — it's fast.)
const DEFAULT_TIMEOUT_MS = 60000;
const PROMPT_VERSION = 'agent-eval-v1';

// Cap each agent definition to a prefix before sending. Full agent bodies can be
// 5-8k chars each; sending 8 of them overflows the model's output budget (502s
// the endpoint) and needlessly widens egress. Definition-QUALITY (clarity,
// boundaries, structure) is well-assessable from a substantial prefix — the
// frontmatter description + the start of the body. Cut on a character boundary
// (no ellipsis); truncation is fine. Applied AFTER scrub so a secret straddling
// the cut can't leak a half-redacted fragment.
const MAX_DEFINITION_CHARS = 2000;

/* ---------- request builder ---------- */

// Builds the frozen-contract body from the deterministic org chart (structure)
// + the per-agent definition text, scrubbing each definition. The list carries
// `.definition` (full frontmatter description + body — src/agent-org-chart.js#
// parseAgentDefinitions); `.description` is accepted as a fallback for callers/
// tests passing the frontmatter-only shape. An agent with no text yields an
// empty definition, which the backend OMITS (degrade-by-omission) → no score —
// so callers SHOULD pass the full definition (description + body), not just the
// one-line description, or the agent gets no score.
function buildAgentEvaluationRequest(structuralAgents, definitionsByName, locale = null) {
  const defMap = new Map(
    (definitionsByName || []).map((d) => [d.name, d.definition != null ? d.definition : d.description]),
  );
  return {
    agents: (structuralAgents || []).map((a) => ({
      name: a.name,
      // Scrub first, THEN cap to the prefix — so a secret straddling the cut is
      // already redacted and can't leak a half-matched fragment.
      definition: scrubSecrets(defMap.get(a.name) || '').slice(0, MAX_DEFINITION_CHARS),
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || null,
      parent: a.parent || null,
    })),
    promptVersion: PROMPT_VERSION,
    // ADR-026: detected report language for the rationale + description prose.
    ...(locale === 'es' || locale === 'en' ? { locale } : {}),
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
      return {
        name: e.name,
        score,
        rationale: typeof e.rationale === 'string' ? e.rationale : '',
        // ADR-026: target-language one-line description; null when the server
        // (older prompt) omitted it — the caller falls back to the verbatim phrase.
        description: typeof e.description === 'string' && e.description ? e.description : null,
      };
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
  const locale = requestBody && (requestBody.locale === 'es' || requestBody.locale === 'en')
    ? requestBody.locale
    : null;
  const safeBody = {
    promptVersion,
    agents: Array.isArray(requestBody && requestBody.agents)
      ? requestBody.agents.map((a) => ({ ...a, definition: scrubSecrets(a.definition) }))
      : [],
    ...(locale ? { locale } : {}),
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
  MAX_DEFINITION_CHARS,
  buildAgentEvaluationRequest,
  requestAgentEvaluation,
};
