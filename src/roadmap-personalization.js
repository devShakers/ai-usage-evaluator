'use strict';

const http = require('http');
const https = require('https');

/*
 * Roadmap personalization client (talents-ai-score, ADR-015).
 *
 * The curated tier roadmap (src/roadmap-content.js) is generic, authored
 * product content — the same prose for every talent at a given tier. When
 * a personalization endpoint is configured, the CLI asks the hub for a
 * PROJECT-ADAPTED rewrite of exactly the 4 prose gaps in the CURRENT
 * jump's entry: `whatUnlocks` / `steps[]` / `tips[]` / `mistakes[]`.
 *
 * Everything else about the roadmap is NEVER touched by this call and
 * ALWAYS comes from the curated content, reinserted client-side
 * (mergeRoadmapPersonalization below): tier, band, the "upgrade when"
 * criterion, and the copyable snippet. The LLM never sees or rewrites
 * those — they're not part of the request body at all.
 *
 * This call is EPHEMERAL, same invariant as src/agent-synthesis.js: it
 * never touches the persistence payload (src/share.js) and nothing about
 * it is gated by consent. Only DERIVED signals are sent (frameworks,
 * tool/MCP categories, agent NAMES + counts, automations) — never raw
 * file content, never agent descriptions/prompts (buildRoadmapSignals
 * below reads the same already-whitelisted report fields every other
 * section of this report already shows).
 *
 * Resilience (mirrors agent-synthesis.js): no endpoint configured,
 * network error, timeout, non-2xx, invalid JSON, or a
 * steps/tips/mistakes count mismatch against the curated block all
 * resolve to `null` — the caller falls back to the curated content
 * VERBATIM, ALL OR NOTHING (never a partial mix of curated + personalized
 * fields), so the render layer never has to reason about a half-broken
 * response.
 */

const DEFAULT_TIMEOUT_MS = 8000;

/* ---------- signals (derived only, never raw content) ---------- */

// Builds the `signals` block from data this report ALREADY computes
// elsewhere (nothing new is read from disk here). `tierSignals` is
// tier-engine.js's own `aggregateTierSignals(report)` output — `hooks`
// comes from there specifically because it's the exact signal the T6->T7
// criterion (and src/tier-analysis.js's own printed value) is based on,
// not a second, potentially-diverging hook count.
function buildRoadmapSignals(report, tierSignals) {
  const r = report || {};
  const ts = tierSignals || {};
  return {
    frameworks: Array.isArray(r.technologies) ? r.technologies : [],
    toolCategories: r.summary && Array.isArray(r.summary.categories) ? r.summary.categories : [],
    mcpCategories: (r.mcp && r.mcp.countsByCategory) || { data: 0, comms: 0, dev: 0, browser: 0, other: 0 },
    // Agent NAMES only — never descriptions/prompts (same whitelist
    // src/agent-org-chart.js's parseAgentOrgChart already enforces).
    agents: Array.isArray(r.agents) ? r.agents.map((a) => a.name) : [],
    agentCounts: r.agentCounts || { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    hooks: typeof ts.hooks === 'number' ? ts.hooks : 0,
    automations: r.automations || null,
  };
}

// Builds the exact wire request: `{tier, tierKey, curated, signals}`.
// `curated` maps the roadmap entry's own field names to the contract's
// names (unlocks -> whatUnlocks, commonMistakes -> mistakes) and includes
// ONLY the 4 personalizable fields — title/upgradeWhen/snippet/tierKey are
// deliberately excluded from the request body: the LLM never sees them,
// so it can never rewrite them either.
function buildRoadmapPersonalizationRequest(curatedEntry, tierResult, report, locale = null) {
  return {
    tier: tierResult.tier,
    tierKey: tierResult.tierKey,
    curated: {
      whatUnlocks: curatedEntry.unlocks,
      steps: curatedEntry.steps,
      tips: curatedEntry.tips,
      mistakes: curatedEntry.commonMistakes,
    },
    signals: buildRoadmapSignals(report, tierResult.signals),
    // ADR-026: detected report language for the personalized prose.
    ...(locale === 'es' || locale === 'en' ? { locale } : {}),
  };
}

/* ---------- validation: all-or-nothing against the curated counts ---------- */

// The ONLY acceptance rule for steps/tips/mistakes is that the response's
// array LENGTH matches the curated block's — this is deliberately a count
// check, not a deep content/shape audit beyond "each item still has the
// text a render needs" (ADR-015: "el nº de steps/tips/mistakes de la
// respuesta NO coincide con el del curado" is the explicit fallback
// trigger). Any mismatch invalidates the ENTIRE response — never a
// partial merge of curated + personalized fields.
function isValidPersonalizedRoadmap(parsed, curated) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (typeof parsed.whatUnlocks !== 'string' || !parsed.whatUnlocks.trim()) return false;

  if (!Array.isArray(parsed.steps) || parsed.steps.length !== curated.steps.length) return false;
  if (!parsed.steps.every((s) => s && typeof s.text === 'string' && s.text.trim())) return false;

  if (!Array.isArray(parsed.tips) || parsed.tips.length !== curated.tips.length) return false;
  if (!parsed.tips.every((tip) => typeof tip === 'string' && tip.trim())) return false;

  if (!Array.isArray(parsed.mistakes) || parsed.mistakes.length !== curated.mistakes.length) return false;
  if (!parsed.mistakes.every((m) => typeof m === 'string' && m.trim())) return false;

  return true;
}

/* ---------- network (self-contained, same pattern as agent-synthesis.js) ---------- */

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
    req.on('timeout', () => req.destroy(new Error('roadmap-personalization: timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Requests the roadmap personalization endpoint. Returns the validated
// `{whatUnlocks, steps, tips, mistakes}` on success, or `null` on ANY
// failure (no endpoint, network error, timeout, non-2xx, invalid JSON, or
// a count mismatch against `requestBody.curated`) — the caller always has
// a safe, non-throwing fallback signal, mirroring
// src/agent-synthesis.js's requestAgentSynthesis exactly.
async function requestRoadmapPersonalization(requestBody, { endpoint, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!endpoint) return null;

  let res;
  try {
    res = await postJsonWithTimeout(endpoint, requestBody, timeoutMs);
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

  if (!isValidPersonalizedRoadmap(parsed, requestBody.curated)) return null;

  return {
    whatUnlocks: parsed.whatUnlocks,
    steps: parsed.steps,
    tips: parsed.tips,
    mistakes: parsed.mistakes,
  };
}

/* ---------- merge: only the 4 prose gaps ever change ---------- */

// Merges a validated personalization result into the curated entry,
// producing an object with the EXACT SAME SHAPE render-html.js's/
// render-terminal.js's existing roadmap renderers already expect — so
// neither renderer needs a second code path. Only `unlocks`/`steps`/
// `tips`/`commonMistakes` are ever overridden; `title`/`upgradeWhen`/
// `snippet`/`tierKey`/`maxTier`/`pendingTranslation` always come from the
// curated entry, untouched, no matter what.
//
// A `maxTier` (T7 terminal) entry has none of those 4 fields at all (its
// own distinct shape: intro/whatRemains/consolidationSteps/honestyNote) —
// defensively never personalized here even if a stray personalization
// object were passed in by mistake (bin/report.js never attempts the call
// for T7 in the first place, but this keeps the guarantee at the render
// boundary too).
//
// Defense in depth: re-validates against the SAME `isValidPersonalizedRoadmap`
// check the network client already applies before this is ever set on
// `report.roadmapPersonalization` — redundant in the real bin/report.js
// flow, but this function is also called directly by the render layer
// with whatever `report` it's given (including in tests), so it must
// never throw or half-render on a malformed object either.
function mergeRoadmapPersonalization(curatedEntry, personalized) {
  if (curatedEntry.maxTier || !personalized) return curatedEntry;
  const curatedForValidation = { steps: curatedEntry.steps, tips: curatedEntry.tips, mistakes: curatedEntry.commonMistakes };
  if (!isValidPersonalizedRoadmap(personalized, curatedForValidation)) return curatedEntry;
  return {
    ...curatedEntry,
    unlocks: personalized.whatUnlocks,
    steps: personalized.steps,
    tips: personalized.tips,
    commonMistakes: personalized.mistakes,
  };
}

module.exports = {
  buildRoadmapSignals,
  buildRoadmapPersonalizationRequest,
  isValidPersonalizedRoadmap,
  requestRoadmapPersonalization,
  mergeRoadmapPersonalization,
};
