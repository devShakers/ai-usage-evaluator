'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfigDir } = require('./config-dir');

// Names and values mirror the web onboarding funnel enums.

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

const PRE_ACCOUNT_EVENTS = Object.freeze({
  start: { onboarding_step_viewed: [], onboarding_step_completed: ['time_on_step_ms'] },
  account_creation: {
    onboarding_step_viewed: ['auth_methods_offered'],
    onboarding_step_errored: ['error_type'],
    onboarding_step_exited: ['time_on_step_ms', 'exited_to_step_name', 'exited_to_step_index'],
  },
});
const AUTH_METHODS = Object.freeze(['google', 'linkedin', 'email']);
const PRE_ACCOUNT_VALUES = Object.freeze({
  time_on_step_ms: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  auth_methods_offered: (v) => Array.isArray(v) && v.every((m) => AUTH_METHODS.includes(m)),
  error_type: (v) => ERROR_TYPES.includes(v),
  exited_to_step_name: (v) => v === 'start',
  exited_to_step_index: (v) => v === STEP_INDEX.start,
});
const COMMON_PROPERTIES = new Set(['step_name', 'step_index', 'flow_version', 'surface', 'mcp_client']);
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const ONCE_PER_STEP = new Set(['onboarding_step_viewed', 'onboarding_step_completed']);
const MAX_EVENTS_PER_REQUEST = 50;
const SEND_TIMEOUT_MS = 3000;
const EXIT_FLUSH_CAP_MS = 1500;
const DEVICE_FILE_NAME = 'analytics-device.json';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (r === 'no-session' || r === 'no-hub-token' || r === 'http-401' || r === 'http-403' || r === 'login-failed' || r.startsWith('google-')) return 'auth';
  if (r === 'missing-fields' || r === 'weak-password') return 'validation';
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

async function postEvents(endpoint, body, headers) {
  const { postJsonWithTimeout } = require('./backend-request');
  const res = await postJsonWithTimeout(endpoint, body, SEND_TIMEOUT_MS, 'POST', null, headers);
  return { ok: res.status >= 200 && res.status < 300, status: res.status };
}

function defaultSend({ endpoint, events, hubAccessToken }) {
  return postEvents(endpoint, { events }, { Authorization: `Bearer ${hubAccessToken}` });
}

function defaultSendToAmplitude({ endpoint, apiKey, events }) {
  return postEvents(endpoint, { api_key: apiKey, events }, null);
}

function isPreAccount(item) {
  const step = PRE_ACCOUNT_EVENTS[item.properties.step_name];
  const allowed = step && step[item.eventType];
  return !!allowed && Object.entries(item.properties)
    .every(([key, value]) => COMMON_PROPERTIES.has(key) || (allowed.includes(key) && PRE_ACCOUNT_VALUES[key](value)));
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
  amplitude = () => require('./config').getAmplitudeIngestion(),
  send = defaultSend,
  sendToAmplitude = defaultSendToAmplitude,
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

  function currentDeviceId() {
    if (cachedDeviceId === undefined) cachedDeviceId = safe(deviceId);
    return cachedDeviceId;
  }

  // Funnel order, each time strictly after the previous one sent.
  function stamp(batch) {
    const ordered = [...batch].sort((a, b) => a.properties.step_index - b.properties.step_index || a.seq - b.seq);
    return ordered.map((item) => {
      if (item.time === undefined) {
        lastTime = Math.max(item.at, lastTime + 1);
        item.time = lastTime;
      }
      return { item, time: item.time };
    });
  }

  function post(stamped, toWire, deliver) {
    const sends = [];
    for (let i = 0; i < stamped.length; i += MAX_EVENTS_PER_REQUEST) {
      const chunk = stamped.slice(i, i + MAX_EVENTS_PER_REQUEST);
      sends.push(Promise.resolve()
        .then(() => deliver(chunk.map(toWire)))
        .then((res) => !!(res && res.ok), () => false)
        .then((ok) => (ok ? [] : chunk.map((e) => e.item))));
    }
    return Promise.all(sends).then((failed) => failed.flat());
  }

  function flushAsTalent() {
    const token = safe(hubToken);
    const url = safe(endpoint);
    // Never send under another account signed in since.
    if (!token || !url || accountOf(token) !== account) return Promise.resolve();
    const batch = pending;
    pending = [];
    const id = currentDeviceId();
    const toWire = ({ item, time }) => ({ event_type: item.eventType, insert_id: item.insertId, time, ...(id ? { device_id: id } : {}), properties: item.properties });
    return post(stamp(batch), toWire, (events) => send({ endpoint: url, events, hubAccessToken: token })).then(() => undefined);
  }

  function flushToAmplitude() {
    const id = currentDeviceId();
    const target = safe(amplitude);
    if (!id || !UUID_RE.test(id) || !target) return Promise.resolve();
    const batch = pending.filter((e) => !e.directFailed && isPreAccount(e));
    if (!batch.length) return Promise.resolve();
    pending = pending.filter((e) => !batch.includes(e));
    const at = now();
    const stamped = stamp(batch);
    const inWindow = ({ time }) => time >= at - MAX_EVENT_AGE_MS && time <= at + MAX_CLOCK_SKEW_MS;
    const outOfWindow = stamped.filter((e) => !inWindow(e)).map((e) => e.item);
    const toWire = ({ item, time }) => ({ event_type: item.eventType, device_id: id, insert_id: item.insertId, time, event_properties: item.properties });
    return post(stamped.filter(inWindow), toWire, (events) => sendToAmplitude({ endpoint: target.endpoint, apiKey: target.apiKey, events })).then((failed) => {
      const waiting = [...outOfWindow, ...failed];
      if (!waiting.length) return undefined;
      for (const e of waiting) e.directFailed = true;
      pending.push(...waiting);
      return ready ? flush() : undefined;
    });
  }

  function flush() {
    if (!pending.length) return Promise.resolve();
    const done = (ready ? flushAsTalent() : flushToAmplitude()).then(() => undefined, () => undefined);
    inflight.add(done);
    done.then(() => inflight.delete(done));
    return done;
  }

  const idle = () => Promise.all([...inflight]).then(() => undefined);

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
    idle,
    settle(capMs = EXIT_FLUSH_CAP_MS) {
      flush();
      let timer;
      const cap = new Promise((resolve) => { timer = setTimeout(resolve, capMs); });
      return Promise.race([idle(), cap]).then(() => clearTimeout(timer));
    },
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
  settle: () => Promise.resolve(),
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
  EXIT_FLUSH_CAP_MS,
  PRE_ACCOUNT_EVENTS,
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
