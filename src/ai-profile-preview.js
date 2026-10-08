'use strict';

// Polls the hub ai-profile (downstream of the report ingest, lands ~3-8s later) and normalizes it for the report/MCP.

const { SETUP_CODE } = require('./ai-fluency-cell');

const DEFAULT_TIMEOUT_MS = 90000;
const POLL_INTERVAL_MS = 4000;
const PROFILE_POLL_WINDOW_MS = DEFAULT_TIMEOUT_MS;
const PROFILE_POLL_INTERVAL_MS = POLL_INTERVAL_MS;
const MAX_TOKEN_REFRESHES = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Tolerant normalization of the hub TalentAiProfileDto into the render shape.
function normalizeProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const setup = p.setup && typeof p.setup === 'object' ? p.setup : {};
  const usage = p.usage && typeof p.usage === 'object' ? p.usage : {};
  const setupLevel = strOrNull(setup.level);
  const usageLevel = strOrNull(usage.level);
  const t = p.traction && typeof p.traction === 'object' ? p.traction : null;
  const tools = t && Array.isArray(t.tools)
    ? t.tools.map((x) => ({
      id: strOrNull(x && (x.id ?? x.name)),
      name: strOrNull(x && (x.name ?? x.id)),
      detected: x ? x.detected === true : false,
    })).filter((x) => x.id || x.name)
    : null;
  const vision = p.vision && typeof p.vision === 'object' ? p.vision : null;
  const howIWork = p.howIWork && typeof p.howIWork === 'object' ? p.howIWork : null;

  return {
    matrix: {
      setupLevel,
      setupCode: setupLevel ? (SETUP_CODE[setupLevel] || null) : null,
      usageLevel,
      cell: strOrNull(p.cell),
      isAiNative: p.isAiNative === true,
    },
    setup: { tier: strOrNull(setup.tier), level: setupLevel, explanation: strOrNull(setup.explanation) },
    usage: { level: usageLevel, explanation: strOrNull(usage.explanation) },
    traction: t
      ? {
        sessions90d: numOrNull(t.sessions90d),
        activeDaysPerWeek: numOrNull(t.activeDaysPerWeek),
        agentsDetected: numOrNull(t.agentsDetected),
        agentsOnProfile: numOrNull(t.agentsOnProfile),
        tools,
      }
      : null,
    vision: vision ? strOrNull(vision.text) : null,
    howIWork: howIWork ? strOrNull(howIWork.body) : null,
  };
}

// The matrix band is populated once the CLI footprint tier has been projected.
function matrixPresent(preview) {
  const m = preview && preview.matrix;
  return !!(m && (m.setupLevel || m.usageLevel || m.cell));
}

// Anything renderable: the matrix band OR the vision (E) OR how-I-work (F). The
// three land on independent projections, so the render must not gate on the matrix.
function hasRenderableProfile(preview) {
  return !!preview && (matrixPresent(preview) || !!preview.vision || !!preview.howIWork);
}

// The full profile: matrix band AND both narratives. Once complete, stop polling.
function isProfileComplete(preview) {
  return matrixPresent(preview) && !!preview.vision && !!preview.howIWork;
}

// How many of the three parts (matrix, E, F) landed — to keep the most complete partial.
function profileCompleteness(preview) {
  if (!preview) return -1;
  return (matrixPresent(preview) ? 1 : 0) + (preview.vision ? 1 : 0) + (preview.howIWork ? 1 : 0);
}

// Back-compat alias (matrix-band meaning preserved for external callers).
const isProfileReady = matrixPresent;

// deps (injectable for tests): requestAiProfile, now, wait, pollIntervalMs.
async function resolveAiProfilePreview(args = {}, deps = {}) {
  const { session = null, endpoint = null, timeoutMs = DEFAULT_TIMEOUT_MS } = args;
  const {
    requestAiProfile = require('./ai-profile-client').requestAiProfile,
    refreshToken = null,
    now = () => Date.now(),
    wait = sleep,
    pollIntervalMs = POLL_INTERVAL_MS,
  } = deps;

  let accessToken = session && typeof session.accessToken === 'string' ? session.accessToken : null;
  let hubAccessToken = session && typeof session.hubAccessToken === 'string' ? session.hubAccessToken : null;
  if ((!accessToken && !hubAccessToken) || !endpoint) return { status: 'unavailable', preview: null };

  const deadline = now() + Math.max(0, timeoutMs);
  // The matrix band, the vision (E) and howIWork (F) land on INDEPENDENT projections and
  // in any order (the matrix can even lag to the hourly reconcile cron). Keep the most
  // complete partial seen and render it — never gate the whole preview on the matrix band.
  let best = null;
  let refreshes = 0;

  while (true) {
    const remaining = deadline - now();
    if (remaining <= 0) break;

    let res;
    try {
      res = await requestAiProfile({ accessToken, hubAccessToken }, { endpoint, timeoutMs: remaining });
    } catch {
      res = { ok: false, reason: 'network-error' };
    }

    if (res && res.ok) {
      const preview = normalizeProfile(res.profile);
      if (isProfileComplete(preview)) return { status: 'ready', preview };
      if (profileCompleteness(preview) > profileCompleteness(best)) best = preview;
    } else if (res && res.reason === 'http-401' && typeof refreshToken === 'function' && refreshes < MAX_TOKEN_REFRESHES) {
      refreshes += 1;
      let fresh = null;
      try { fresh = await refreshToken(); } catch { fresh = null; }
      if (fresh && (fresh.accessToken || fresh.hubAccessToken)) {
        accessToken = typeof fresh.accessToken === 'string' ? fresh.accessToken : accessToken;
        hubAccessToken = typeof fresh.hubAccessToken === 'string' ? fresh.hubAccessToken : hubAccessToken;
        continue;
      }
    }

    if (deadline - now() <= pollIntervalMs) break;
    await wait(pollIntervalMs);
  }

  // Anything renderable (matrix OR E OR F) is surfaced as `ready`; the renderers degrade
  // per-field. Only a genuinely empty profile stays `pending`.
  if (hasRenderableProfile(best)) return { status: 'ready', preview: best };
  return { status: 'pending', preview: null };
}

module.exports = {
  resolveAiProfilePreview,
  normalizeProfile,
  isProfileReady,
  matrixPresent,
  hasRenderableProfile,
  isProfileComplete,
  profileCompleteness,
  DEFAULT_TIMEOUT_MS,
  PROFILE_POLL_WINDOW_MS,
  PROFILE_POLL_INTERVAL_MS,
};
