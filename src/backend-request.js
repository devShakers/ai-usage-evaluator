'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { getHubBase } = require('./config');

// ONE BACKEND: the certifications service.

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const CLIENT_IDENTITIES = ['cli', 'mcp'];
let clientIdentity = 'cli';

function setClientIdentity(identity) {
  if (!CLIENT_IDENTITIES.includes(identity)) throw new Error(`unknown client identity: ${identity}`);
  clientIdentity = identity;
}

// Hub profile writes declare which surface made them; reads, auth and the onboarding funnel are not profile updates.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HUB_PROFILE_PATH_RE = /^\/(works\/(talents?\/me|me|users\/me)|works\/talent\/(portfolios|certifications\/me))(\/|$)/;
const NOT_PROFILE_UPDATE_RE = /^\/works\/talent\/me\/onboarding-events(\/|$)/;

function profileUpdateSourceHeader(url, method) {
  if (!MUTATING_METHODS.has(String(method).toUpperCase())) return {};
  const hubBase = getHubBase();
  if (!hubBase || !url.href.startsWith(`${hubBase}/`)) return {};
  const path = url.href.slice(hubBase.length).split(/[?#]/)[0];
  if (!HUB_PROFILE_PATH_RE.test(path) || NOT_PROFILE_UPDATE_RE.test(path)) return {};
  return { 'X-Profile-Update-Source': clientIdentity };
}

// Extra request headers, sanitized (the agent certification interview needs `Authorization: Bearer <sessionToken>`).
const UNSAFE_HEADER_VALUE_RE = /[\r\n\0]/;

function sanitizeExtraHeaders(extraHeaders) {
  if (!extraHeaders || typeof extraHeaders !== 'object') return {};
  const out = {};
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (typeof name !== 'string' || !name || UNSAFE_HEADER_VALUE_RE.test(name)) continue;
    if (typeof value !== 'string' || !value || UNSAFE_HEADER_VALUE_RE.test(value)) continue;
    out[name] = value;
  }
  return out;
}

// Canonical, zero-dependency JSON request with a timeout — consolidates the ~8 near-identical copies that used to live one per client module.
function postJsonWithTimeout(url, body, timeoutMs, method = 'POST', idempotencyKey = null, extraHeaders = null) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(Object.assign(e, { kind: 'invalid-url' }));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const data = body === null || body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = lib.request(
      u,
      {
        method,
        headers: {
          Accept: 'application/json',
          // Tells CLI and MCP traffic apart from the browser.
          'X-Shakers-Client': clientIdentity,
          ...profileUpdateSourceHeader(u, method),
          // Only declared when there IS a body — see the bodyless note above.
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          ...sanitizeExtraHeaders(extraHeaders),
        },
        timeout: timeoutMs,
        agent: false,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > MAX_RESPONSE_BYTES) req.destroy();
        });
        res.on('end', () => resolve({ status: res.statusCode, raw }));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('request timed out'), { kind: 'timeout' })));
    req.on('error', (e) => reject(Object.assign(e, { kind: e.kind || 'network-error' })));
    if (data) req.write(data);
    req.end();
  });
}

function postMultipartWithTimeout(url, fields, timeoutMs, method = 'POST', extraHeaders = null) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(Object.assign(e, { kind: 'invalid-url' }));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const boundary = `----shakers${crypto.randomBytes(16).toString('hex')}`;
    const chunks = [];
    for (const [name, value] of Object.entries(fields || {})) {
      if (value === undefined || value === null) continue;
      // A file part: { filename, contentType, data: Buffer }.
      if (typeof value === 'object' && Buffer.isBuffer(value.data)) {
        const filename = String(value.filename || 'file').replace(/["\r\n\0]/g, '');
        const contentType = String(value.contentType || 'application/octet-stream').replace(UNSAFE_HEADER_VALUE_RE, '');
        chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`));
        chunks.push(value.data, Buffer.from('\r\n'));
        continue;
      }
      // The boundary delimits a part, so a value keeps its line breaks (a multi-line userQuery).
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const data = Buffer.concat(chunks);
    const req = lib.request(
      u,
      {
        method,
        headers: {
          Accept: 'application/json',
          // See postJsonWithTimeout's identical header for why.
          'X-Shakers-Client': clientIdentity,
          ...profileUpdateSourceHeader(u, method),
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': data.length,
          ...sanitizeExtraHeaders(extraHeaders),
        },
        timeout: timeoutMs,
        agent: false,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > MAX_RESPONSE_BYTES) req.destroy();
        });
        res.on('end', () => resolve({ status: res.statusCode, raw }));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('request timed out'), { kind: 'timeout' })));
    req.on('error', (e) => reject(Object.assign(e, { kind: e.kind || 'network-error' })));
    req.write(data);
    req.end();
  });
}

// One request to the one backend.
async function requestBackend({
  endpoint,
  body,
  timeoutMs,
  method = 'POST',
  idempotencyKey = null,
  extraHeaders = null,
  trace = null,
} = {}) {
  if (!endpoint) {
    throw Object.assign(new Error('no endpoint configured'), { kind: 'no-endpoint' });
  }

  // Optional trace.
  const note = (entry) => {
    if (Array.isArray(trace)) trace.push(entry);
  };

  try {
    const res = await postJsonWithTimeout(endpoint, body, timeoutMs, method, idempotencyKey, extraHeaders);
    note({ backend: 'primary', status: res.status, kind: null });
    return { backend: 'primary', status: res.status, raw: res.raw };
  } catch (e) {
    note({ backend: 'primary', status: null, kind: (e && e.kind) || 'network-error' });
    throw e;
  }
}

module.exports = {
  MAX_RESPONSE_BYTES,
  postJsonWithTimeout,
  postMultipartWithTimeout,
  requestBackend,
  setClientIdentity,
};
