'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config-dir');

// Names and values mirror works-frontend onboarding-funnel-enums.ts.

const FLOW_VERSION = 'signup_new_works_v1';

const STEP_INDEX = Object.freeze({
  start: 1,
  account_creation: 2,
  import_sources: 3,
  work_situation: 4,
  availability: 5,
  rates: 6,
  languages: 7,
  location: 8,
  profile_summary: 9,
  pre_interview: 10,
  interview: 11,
  supercluster: 12,
});

const EVENT_TYPES = Object.freeze([
  'onboarding_step_viewed',
  'onboarding_step_completed',
  'onboarding_step_skipped',
  'onboarding_step_errored',
  'onboarding_step_exited',
  'source_import_started',
  'source_import_completed',
  'source_import_failed',
]);

const SURFACES = Object.freeze(['cli', 'mcp']);
const MCP_CLIENTS = Object.freeze(['claude', 'chatgpt', 'cursor', 'other']);
const SOURCE_TYPES = Object.freeze(['linkedin', 'cv', 'github', 'web_page']);
const ERROR_TYPES = Object.freeze(['validation', 'server', 'timeout', 'auth', 'import']);

const WORK_SITUATION_VALUES = Object.freeze({
  FREELANCE: 'freelance',
  EMPLOYED: 'employed',
  BETWEEN_JOBS: 'between-jobs',
  STUDYING: 'studying',
  OTHER: 'other',
});

const ONCE_PER_STEP = new Set(['onboarding_step_viewed', 'onboarding_step_completed']);
const MAX_EVENTS_PER_REQUEST = 50;
const SEND_TIMEOUT_MS = 3000;
const DEVICE_FILE_NAME = 'analytics-device.json';

function mcpClientFor(clientName) {
  const name = typeof clientName === 'string' ? clientName.toLowerCase() : '';
  if (name.includes('claude')) return 'claude';
  if (name.includes('chatgpt') || name.includes('openai')) return 'chatgpt';
  if (name.includes('cursor')) return 'cursor';
  return 'other';
}

function sourceTypeFor(source) {
  if (source === 'linkedin' || source === 'cv' || source === 'github') return source;
  return 'web_page';
}

function workSituationValue(code) {
  return WORK_SITUATION_VALUES[code] || null;
}

// Same ÷4 as the web; '> 160' has no number.
function weeklyHours(monthlyHours) {
  const n = Number(monthlyHours);
  return monthlyHours != null && monthlyHours !== '' && Number.isFinite(n) ? Math.round(n / 4) : null;
}

// As on the web: part-time project price is hourly, full-time is annual.
function rateTypes({ partTimeSelected, fullTimeSelected } = {}) {
  return [partTimeSelected === true && 'hourly', fullTimeSelected === true && 'annual'].filter(Boolean);
}

function errorTypeFor(reason) {
  const r = String(reason || '');
  if (r === 'no-session' || r === 'no-hub-token' || r === 'http-401' || r === 'http-403') return 'auth';
  if (r === 'timeout') return 'timeout';
  if (r === 'no-endpoint') return 'server';
  if (r.startsWith('bad-') || r.startsWith('no-') || r === 'duplicate-language' || r === 'unresolved-languages') return 'validation';
  return 'server';
}

function cleanProperties(properties) {
  const ok = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
    || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
  return Object.fromEntries(Object.entries(properties || {}).filter(([, v]) => ok(v)));
}

function deviceFilePath(env) {
  return path.join(getConfigDir(env), DEVICE_FILE_NAME);
}

function loadOrCreateDeviceId(env = process.env, { fs: fsImpl = fs } = {}) {
  const target = deviceFilePath(env);
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(target, 'utf8'));
    if (parsed && typeof parsed.deviceId === 'string' && parsed.deviceId) return parsed.deviceId;
  } catch { /* create one */ }
  const deviceId = crypto.randomUUID();
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${DEVICE_FILE_NAME}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let fd = null;
  try {
    fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fd = fsImpl.openSync(tmp, 'wx', 0o600);
    fsImpl.writeFileSync(fd, `${JSON.stringify({ deviceId }, null, 2)}\n`);
    try { fsImpl.fsyncSync(fd); } catch { /* e.g. EINVAL on some filesystems */ }
    fsImpl.closeSync(fd);
    fd = null;
    fsImpl.renameSync(tmp, target);
    return deviceId;
  } catch {
    if (fd !== null) { try { fsImpl.closeSync(fd); } catch { /* already closed */ } }
    try { fsImpl.unlinkSync(tmp); } catch { /* never existed */ }
    return null;
  }
}

async function defaultSend({ endpoint, events, hubAccessToken }) {
  const { postJsonWithTimeout } = require('./backend-request');
  const res = await postJsonWithTimeout(endpoint, { events }, SEND_TIMEOUT_MS, 'POST', null, { Authorization: `Bearer ${hubAccessToken}` });
  return { ok: res.status >= 200 && res.status < 300, status: res.status };
}

function defaultHubToken() {
  const { loadAuthSession, sessionStatus } = require('./auth-session-store');
  const session = loadAuthSession();
  return sessionStatus(session) === 'active' && session && session.hubAccessToken ? session.hubAccessToken : null;
}

function createFunnel({
  surface,
  hubToken = defaultHubToken,
  deviceId = () => loadOrCreateDeviceId(),
  endpoint = () => require('./config').getOnboardingEventsEndpoint(),
  send = defaultSend,
  now = () => Date.now(),
  uuid = () => crypto.randomUUID(),
} = {}) {
  if (!SURFACES.includes(surface)) throw new Error(`unknown funnel surface: ${surface}`);
  let pending = [];
  let lastTime = 0;
  let seq = 0;
  let ready = false;
  let account = null;
  let active = false;
  let mcpClient = null;
  let cachedDeviceId;
  const seen = new Set();
  const inflight = new Set();

  function track(eventType, stepName, properties = {}) {
    if (!active || !EVENT_TYPES.includes(eventType) || !STEP_INDEX[stepName]) return false;
    if (ONCE_PER_STEP.has(eventType)) {
      const key = `${eventType}:${stepName}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    const common = { step_name: stepName, step_index: STEP_INDEX[stepName], flow_version: FLOW_VERSION, surface };
    if (surface === 'mcp') common.mcp_client = mcpClient || 'other';
    pending.push({ eventType, insertId: uuid(), at: now(), seq: seq++, properties: { ...cleanProperties(properties), ...common } });
    return true;
  }

  // Funnel order, each time strictly after the previous one sent.
  function stamp(batch) {
    const ordered = [...batch].sort((a, b) => a.properties.step_index - b.properties.step_index || a.seq - b.seq);
    const id = cachedDeviceId === undefined ? (cachedDeviceId = safe(deviceId)) : cachedDeviceId;
    return ordered.map((e) => {
      lastTime = Math.max(e.at, lastTime + 1);
      return { event_type: e.eventType, insert_id: e.insertId, time: lastTime, ...(id ? { device_id: id } : {}), properties: e.properties };
    });
  }

  function flush() {
    if (!ready || !pending.length) return Promise.resolve();
    const token = safe(hubToken);
    const url = safe(endpoint);
    // Never send under another account signed in since.
    if (!token || !url || accountOf(token) !== account) return Promise.resolve();
    const events = stamp(pending);
    pending = [];
    const sends = [];
    for (let i = 0; i < events.length; i += MAX_EVENTS_PER_REQUEST) {
      sends.push(Promise.resolve().then(() => send({ endpoint: url, events: events.slice(i, i + MAX_EVENTS_PER_REQUEST), hubAccessToken: token })).catch(() => null));
    }
    const done = Promise.all(sends).then(() => undefined, () => undefined);
    inflight.add(done);
    done.then(() => inflight.delete(done));
    return done;
  }

  return {
    surface,
    begin() {
      seen.clear();
      active = true;
    },
    get active() { return active; },
    setMcpClient(clientName) { mcpClient = mcpClientFor(clientName); },
    track,
    viewed: (step, props) => track('onboarding_step_viewed', step, props),
    completed: (step, props) => track('onboarding_step_completed', step, props),
    skipped: (step, props) => track('onboarding_step_skipped', step, props),
    errored: (step, reason, props = {}) => track('onboarding_step_errored', step, { error_type: errorTypeFor(reason), ...props }),
    identified() {
      const token = safe(hubToken);
      if (!token) return Promise.resolve();
      account = accountOf(token);
      ready = true;
      return flush();
    },
    flush,
    idle: () => Promise.all([...inflight]).then(() => undefined),
  };
}

// A refreshed token keeps the same account.
function accountOf(token) {
  const payload = require('./auth-session-store').decodeJwtPayload(token);
  return (payload && (payload.sub || payload.email)) || token;
}

function safe(fn) {
  try { return fn(); } catch { return null; }
}

const NOOP_FUNNEL = Object.freeze({
  surface: null,
  begin() {},
  active: false,
  setMcpClient() {},
  track: () => false,
  viewed: () => false,
  completed: () => false,
  skipped: () => false,
  errored: () => false,
  identified: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  idle: () => Promise.resolve(),
});

module.exports = {
  FLOW_VERSION,
  STEP_INDEX,
  EVENT_TYPES,
  SURFACES,
  MCP_CLIENTS,
  SOURCE_TYPES,
  ERROR_TYPES,
  MAX_EVENTS_PER_REQUEST,
  DEVICE_FILE_NAME,
  NOOP_FUNNEL,
  createFunnel,
  mcpClientFor,
  sourceTypeFor,
  workSituationValue,
  weeklyHours,
  rateTypes,
  errorTypeFor,
  loadOrCreateDeviceId,
};
