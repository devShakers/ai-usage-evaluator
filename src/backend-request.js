'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ONE BACKEND: the certifications service (talents-ai-score, ADR-042).

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// Extra request headers, sanitized (talents-ai-score, issue 038 — the agent certification interview needs `Authorization: Bearer <sessionToken>`).
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
          // Lets the backend (and Datadog) tell CLI/MCP traffic apart from the
          // browser without touching auth — same value regardless of which
          // bin/ entrypoint is running, since none of them plumb through here
          // separately today. Set unconditionally so no caller can drop it via
          // extraHeaders (sanitizeExtraHeaders runs after this, so it can only
          // add headers, not remove this one).
          'X-Shakers-Client': 'cli',
          // Only declared when there IS a body — see the bodyless note above.
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          ...sanitizeExtraHeaders(extraHeaders),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > MAX_RESPONSE_BYTES) req.destroy();
        });
        // `headers` is exposed so the better-auth email flow can read `Set-Cookie` (the session cookie it captures and replays); every other caller reads only `{status, raw}` and ignores it.
        res.on('end', () => resolve({ status: res.statusCode, raw, headers: res.headers }));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('request timed out'), { kind: 'timeout' })));
    req.on('error', (e) => reject(Object.assign(e, { kind: e.kind || 'network-error' })));
    if (data) req.write(data);
    req.end();
  });
}

// Pulls one `name=value` cookie pair out of a response's `Set-Cookie` header (Node exposes it as an array, or a single string).
// Accepts the base cookie name with or without the RFC6265 `__Secure-`/`__Host-`
// prefixes that better-auth applies over HTTPS, and returns the EXACT server-set
// name (prefix included) so it can be forwarded back verbatim in a `Cookie:` header.
function extractSetCookie(headers, name) {
  if (!headers) return null;
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
  const candidates = [name, `__Secure-${name}`, `__Host-${name}`];
  for (const candidate of candidates) {
    const prefix = `${candidate}=`;
    for (const entry of list) {
      if (typeof entry === 'string' && entry.startsWith(prefix)) {
        const value = entry.slice(prefix.length).split(';')[0];
        if (value) return `${candidate}=${value}`;
      }
    }
  }
  return null;
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
          'X-Shakers-Client': 'cli',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': data.length,
          ...sanitizeExtraHeaders(extraHeaders),
        },
        timeout: timeoutMs,
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

  // Optional trace (talents-ai-score, issue 109).
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
  extractSetCookie,
  requestBackend,
};
