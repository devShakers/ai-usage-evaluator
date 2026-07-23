'use strict';

/*
 * graph-infer-client.js — CLI client for the CODEBASE ANALYSIS pass behind the
 * LOCAL report (`map`). Posts a content-free structural repo context to the
 * backend `graph-inference` route and gets back the WHOLE foglamp graph
 * ({nodes,edges}). Resilience: ANY problem (no endpoint, network, timeout,
 * non-2xx, invalid JSON, wrong shape) resolves to `null` — `map` then renders
 * its deterministic agent fallback. Analysis NEVER blocks or breaks `map`.
 *
 * FROZEN request contract with the backend `InferGraphInputDto`
 * (docs/graph-report.md):  POST <endpoint>  { context, promptVersion, locale? }
 * Response: { nodes, edges }.
 *
 * The context is scrubbed by repo-context.js; this client re-scrubs string
 * leaves at the network boundary (defense in depth).
 */

const http = require('http');
const https = require('https');
const { scrubString } = require('./graph-generator');

const ANALYZE_PROMPT_VERSION = 'codebase-analyze-v1';
// Pro-tier analysis on a substantial repo runs long; give it real headroom.
const DEFAULT_TIMEOUT_MS = 120_000;

function postJsonWithTimeout(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { reject(e); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = lib.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': payload.length }, timeout: timeoutMs },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; if (data.length > 4 * 1024 * 1024) req.destroy(); });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

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
 * analyzeCodebase(context, { endpoint, timeoutMs, locale }) ->
 *   Promise<{ nodes, edges } | null>
 */
const RETRY_DELAY_MS = 1500;
const MAX_ATTEMPTS = 2; // 1 retry — the analyze is a long Pro call, don't loop.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function analyzeCodebase(context, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS, locale } = {}) {
  if (!endpoint || !context) return null;
  const body = {
    context: scrubDeep(context),
    promptVersion: ANALYZE_PROMPT_VERSION,
    ...(locale ? { locale } : {}),
  };
  // Retry ONCE on a TRANSIENT failure (network error, or a 5xx — the backend
  // maps an overloaded/unavailable Gemini to 502/503). Do NOT retry a 4xx
  // (400 = bad contract, 429 = rate limit) — those won't recover on a retry.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await postJsonWithTimeout(endpoint, body, timeoutMs);
    } catch {
      if (attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; } // network error → transient
      return null;
    }
    if (res && res.status >= 200 && res.status < 300) {
      let parsed;
      try { parsed = JSON.parse(res.body); } catch { return null; }
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      };
    }
    // Non-2xx: retry only transient 5xx; give up immediately on 4xx.
    const transient = res && res.status >= 500;
    if (transient && attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
    return null;
  }
  return null;
}

/*
 * makeCodebaseAnalyzer({endpoint,timeoutMs,locale}) -> { model, analyze(context) }
 * `analyze` returns {nodes,edges,latencyMs} on success or null on failure.
 */
function makeCodebaseAnalyzer({ endpoint, timeoutMs, locale } = {}) {
  return {
    model: 'gemini-2.5-pro',
    async analyze(context) {
      const t0 = Date.now();
      const res = await analyzeCodebase(context, { endpoint, timeoutMs, locale });
      if (!res) return null;
      return { ...res, latencyMs: Date.now() - t0 };
    },
  };
}

module.exports = { analyzeCodebase, makeCodebaseAnalyzer, ANALYZE_PROMPT_VERSION };
