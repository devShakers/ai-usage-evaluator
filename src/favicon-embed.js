'use strict';

/*
 * favicon-embed.js — resolve favicons for node domains and return them as
 * base64 `data:` URIs, so the LOCAL report can show real brand marks while
 * staying ZERO-network at VIEW time (the fetch happens once, here, at report
 * GENERATION time on the developer's machine).
 *
 * Design:
 *   - Best-effort: any failure (offline, timeout, 404, oversize, bad type)
 *     simply omits that domain — the renderer falls back to a colored monogram.
 *     Generating a report must NEVER fail because a favicon didn't load.
 *   - Cached on disk (config dir) keyed by domain, with a negative cache so we
 *     don't re-hammer dead domains on every run. TTL keeps it fresh-ish.
 *   - Zero runtime deps: Node 18+ global fetch + AbortController. `fetchImpl`
 *     and `now` are injectable for tests (no real network in the test suite).
 *   - Privacy: only the bare registrable domain is ever sent to the favicon
 *     provider; never a URL, path, token, or anything project-specific.
 *
 * NOTE: fetching favicons contacts a third-party favicon service at generation
 * time. That is a deliberate, documented trade-off (real marks vs. a network
 * call during `map`); it is disabled with `enabled:false` (then everything
 * falls back to monograms, fully offline). See docs/graph-report.md.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_BYTES = 24 * 1024; // skip anything larger than 24KB (keep report lean)
const PER_FETCH_TIMEOUT_MS = 2500;
// Google's favicon service returns a PNG for a bare domain; sz=64 is crisp at
// the 20px render size. Provider is swappable via opts.providerUrl.
const PROVIDER = (d, sz) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=${sz}`;

function isBareDomain(d) {
  return typeof d === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) && !d.includes('/');
}

function readCache(cacheFile) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(cacheFile, cache) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  } catch {
    /* cache is best-effort; ignore write failures */
  }
}

/*
 * embedFavicons(domains, opts) -> Promise<{ [domain]: dataURI }>
 * Only successful, non-empty results are included. Injectables:
 *   fetchImpl  (default global fetch), now (default Date.now),
 *   cacheFile  (default <configDir>/favicon-cache.json),
 *   enabled    (default true; false => resolve to {} using only fresh cache),
 *   sz, ttlMs, timeoutMs, providerUrl.
 */
async function embedFavicons(domains, opts = {}) {
  const {
    fetchImpl = (typeof fetch === 'function' ? fetch : null),
    now = Date.now,
    cacheFile = path.join(defaultCacheDir(), 'favicon-cache.json'),
    enabled = true,
    sz = 64,
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = PER_FETCH_TIMEOUT_MS,
    providerUrl = PROVIDER,
    maxBytes = MAX_BYTES,
  } = opts;

  const uniq = Array.from(new Set((domains || []).filter(isBareDomain)));
  const cache = readCache(cacheFile);
  const out = {};
  const t = now();
  let cacheDirty = false;

  for (const d of uniq) {
    const hit = cache[d];
    if (hit && t - hit.at < ttlMs) {
      // fresh cache: positive => use it; negative => skip (monogram)
      if (hit.uri) out[d] = hit.uri;
      continue;
    }
    if (!enabled || !fetchImpl) continue; // offline mode: only fresh cache used

    const uri = await fetchOne(d, { fetchImpl, sz, timeoutMs, providerUrl, maxBytes });
    cache[d] = { at: t, uri: uri || null };
    cacheDirty = true;
    if (uri) out[d] = uri;
  }

  if (cacheDirty) writeCache(cacheFile, cache);
  return out;
}

async function fetchOne(domain, { fetchImpl, sz, timeoutMs, providerUrl, maxBytes }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(providerUrl(domain, sz), { signal: ac.signal, redirect: 'follow' });
    if (!res || !res.ok) return null;
    const type = (res.headers && res.headers.get && res.headers.get('content-type')) || 'image/png';
    if (!/^image\//i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > maxBytes) return null;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null; // timeout / network / abort => monogram fallback
  } finally {
    clearTimeout(timer);
  }
}

function defaultCacheDir() {
  // Same location the rest of the CLI uses; overridable via env in tests.
  return (
    process.env.AI_FOOTPRINT_CONFIG_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE || '.', '.config', 'ai-footprint')
  );
}

module.exports = { embedFavicons, isBareDomain, defaultCacheDir };
