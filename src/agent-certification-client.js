'use strict';

const http = require('http');
const https = require('https');
const { scrubSecrets } = require('./agent-synthesis');

/*
 * Client for the interactive `certify agents` flow (skill-code-certification).
 * TWO server-side gemini-2.5-flash steps, each STATELESS — this client passes
 * the accumulated context every call (same shape as certify-client.js). The CLI
 * has no model key; the Hub runs the model. Observability lives server-side; the
 * client contributes the versioned prompt id. (The old `/categories` step was
 * removed — the category is derived deterministically server-side at verdict.)
 *
 * FROZEN CONTRACT (must match the hub-backend agent-certification controller):
 *   POST <ingest-sibling>/agent-certification/followups
 *     req  { agent, qualification:{achieve,decisions}, promptVersion, locale? }
 *     resp { questions:[string] }                                     (2-3)
 *   POST <ingest-sibling>/agent-certification/verdict   (GATED + PERSISTED)
 *     req  { email, agent, qualification, followups:[{question,answer}],
 *            promptVersion, locale?, superadminToken? }
 *     resp { agentName, category, role, level, areas:[{area,tag,evidence}],
 *            verifiedEvidence:[], unverifiedEvidence:[], rationale }
 *   (category/role in the verdict are derived server-side from the catalog
 *    matcher — the client no longer sends a chosenCategoryId.)
 *
 * Resilience: like certify-client (inform-don't-hide) — every failure resolves
 * to a DISCRIMINATED result `{ok:false, reason}` so the interactive flow can
 * tell the user exactly what happened (no silent fallback: there is no
 * deterministic substitute for a model verdict).
 *
 * Egress: the agent `definition` AND the talent's free-text answers leave the
 * machine. `scrubSecrets` strips accidental secrets/keys but NOT the prose (the
 * answers ARE the evidence). The server suppresses the request body from its
 * Datadog span (the Q&A may cite a client/NDA).
 */

const PROMPT_VERSION = 'agent-cert-v1';
const DEFAULT_TIMEOUT_MS = 60000;

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
    req.on('timeout', () => req.destroy(Object.assign(new Error('agent-cert: timed out'), { kind: 'timeout' })));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Shared request+classify. Returns { ok:true, data } or { ok:false, reason }.
async function requestStep(url, body, timeoutMs) {
  if (!url) return { ok: false, reason: 'no-endpoint' };
  let res;
  try {
    res = await postJsonWithTimeout(url, body, timeoutMs);
  } catch (e) {
    if (e && e.kind === 'timeout') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network-error', detail: e && e.message };
  }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: `http-${res.status}` };
  let parsed;
  try {
    parsed = JSON.parse(res.raw);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'invalid-shape' };
  return { ok: true, data: parsed };
}

function scrubAgent(agent) {
  return {
    name: agent.name,
    definition: scrubSecrets(agent.definition || ''),
    tools: Array.isArray(agent.tools) ? agent.tools : [],
    model: agent.model || null,
    parent: agent.parent || null,
  };
}

function scrubQualification(q) {
  return { achieve: scrubSecrets(q.achieve || ''), decisions: scrubSecrets(q.decisions || '') };
}

function withLocale(body, locale) {
  return locale === 'es' || locale === 'en' ? { ...body, locale } : body;
}

async function requestFollowups(agent, qualification, { endpoint, locale = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const body = withLocale(
    { agent: scrubAgent(agent), qualification: scrubQualification(qualification), promptVersion: PROMPT_VERSION },
    locale,
  );
  const r = await requestStep(endpoint, body, timeoutMs);
  if (!r.ok) return r;
  const questions = (Array.isArray(r.data.questions) ? r.data.questions : [])
    .filter((q) => typeof q === 'string' && q.trim())
    .map((q) => q.trim())
    .slice(0, 3);
  return { ok: true, questions };
}

async function requestVerdict(
  { email, agent, qualification, followups, superadminToken },
  { endpoint, locale = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  const body = withLocale(
    {
      email,
      agent: scrubAgent(agent),
      qualification: scrubQualification(qualification),
      followups: (Array.isArray(followups) ? followups : []).map((f) => ({
        question: String(f.question || ''),
        answer: scrubSecrets(String(f.answer || '')),
      })),
      promptVersion: PROMPT_VERSION,
      ...(superadminToken ? { superadminToken } : {}),
    },
    locale,
  );
  const r = await requestStep(endpoint, body, timeoutMs);
  if (!r.ok) return r;
  const d = r.data;
  return {
    ok: true,
    verdict: {
      agentName: typeof d.agentName === 'string' ? d.agentName : agent.name,
      category: typeof d.category === 'string' ? d.category : null,
      role: typeof d.role === 'string' ? d.role : null,
      level: typeof d.level === 'string' ? d.level : 'none',
      areas: Array.isArray(d.areas) ? d.areas.filter((a) => a && typeof a.area === 'string') : [],
      verifiedEvidence: Array.isArray(d.verifiedEvidence) ? d.verifiedEvidence.filter((s) => typeof s === 'string') : [],
      unverifiedEvidence: Array.isArray(d.unverifiedEvidence) ? d.unverifiedEvidence.filter((s) => typeof s === 'string') : [],
      rationale: typeof d.rationale === 'string' ? d.rationale : '',
    },
  };
}

module.exports = {
  PROMPT_VERSION,
  requestFollowups,
  requestVerdict,
};
