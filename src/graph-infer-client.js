'use strict';

/*
 * graph-infer-client.js — CLI client for the graph-inference (LLM enrichment)
 * pass behind the LOCAL report (`map`). Sibling of agent-evaluation.js; same
 * resilience posture: ANY problem (no endpoint, network error, timeout, non-2xx,
 * invalid JSON, wrong shape) resolves to `null` — the caller (graph-generator's
 * injected `llm` port) then yields the deterministic graph. Enrichment NEVER
 * blocks or breaks `map`.
 *
 * FROZEN request contract with the backend `WorksGraphInferenceReqDto` /
 * `InferGraphInputDto` (docs/graph-report.md):
 *   POST <endpoint>  { summary, promptVersion, locale? }
 * Response: { nodes, edges } (the enrichment delta; may be empty).
 *
 * The `summary` is ALREADY content-free + scrubbed by graph-generator's
 * buildScrubbedSummary before it reaches here; this client adds a defensive
 * re-scrub of string leaves at the network boundary (defense in depth, same
 * pattern as agent-evaluation's re-scrub).
 */

const http = require('http');
const https = require('https');
const { scrubString } = require('./graph-generator');

const GRAPH_INFER_PROMPT_VERSION = 'graph-infer-v1';
const DEFAULT_TIMEOUT_MS = 60_000;

function postJsonWithTimeout(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = lib.request(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': payload.length },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          data += c;
          if (data.length > 2 * 1024 * 1024) req.destroy(); // 2MB guard
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

// Deep re-scrub of string leaves (defense in depth at the network boundary).
function scrubDeep(v) {
  if (typeof v === 'string') return scrubString(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = scrubDeep(v[k]);
    return o;
  }
  return v;
}

/*
 * requestGraphInference(summary, { endpoint, timeoutMs, locale }) ->
 *   Promise<{ nodes, edges } | null>
 * Resolves to null on ANY failure (the graph-generator treats null as "no
 * enrichment" and returns the deterministic graph).
 */
async function requestGraphInference(summary, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS, locale } = {}) {
  if (!endpoint || !summary) return null;
  const body = {
    summary: scrubDeep(summary),
    promptVersion: GRAPH_INFER_PROMPT_VERSION,
    ...(locale ? { locale } : {}),
  };
  let res;
  try {
    res = await postJsonWithTimeout(endpoint, body, timeoutMs);
  } catch {
    return null; // network / timeout / bad URL
  }
  if (!res || res.status < 200 || res.status >= 300) return null; // rate-limited, 4xx, 5xx
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  return { nodes, edges };
}

/*
 * Build the injected `llm` port graph-generator.generateGraph expects:
 *   { model, inferGraph(summary) -> Promise<{nodes,edges}> }
 * `inferGraph` returns {} (empty enrichment) on failure so generation always
 * completes; the metric fields (__model etc.) let generateGraph emit onTrace.
 */
function makeGraphInferLlm({ endpoint, timeoutMs, locale } = {}) {
  return {
    model: 'gemini-2.5-flash',
    async inferGraph(summary) {
      const res = await requestGraphInference(summary, { endpoint, timeoutMs, locale });
      if (!res) return { nodes: [], edges: [] };
      return { ...res, __model: 'gemini-2.5-flash' };
    },
  };
}

module.exports = { requestGraphInference, makeGraphInferLlm, GRAPH_INFER_PROMPT_VERSION };
