'use strict';

// Alma client: POST `/alma/chat` (turn) and `/alma/decision` (approve/deny a
// pending action) with the talent's hub Bearer (Alma verifies it against the hub
// JWKS, ES256). Response is an NDJSON stream — one JSON event per line:
// {type:'turn_started'|'text_delta'|'confirmation_required'|'link'|...}. Parsed
// incrementally so the CLI can print tokens live. Zero-dep (http/https only).

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { reasonForError } = require('./onboarding-client');

const DEFAULT_TIMEOUT_MS = 120000;

// Streams one NDJSON turn to `endpoint` with `body`. `onEvent(evt)` fires per line;
// resolves with the aggregated assistant text (the concatenated text_delta chunks).
function streamNdjson(endpoint, body, { hubAccessToken, onEvent, timeoutMs = DEFAULT_TIMEOUT_MS, requestImpl } = {}) {
  return new Promise((resolve) => {
    if (!endpoint) return resolve({ ok: false, reason: 'no-endpoint' });
    if (!hubAccessToken) return resolve({ ok: false, reason: 'no-hub-token' });

    let url;
    try {
      url = new URL(endpoint);
    } catch {
      return resolve({ ok: false, reason: 'bad-endpoint' });
    }
    const lib = requestImpl || (url.protocol === 'https:' ? https : http);
    const payload = JSON.stringify(body);
    const deltas = [];
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          accept: 'application/x-ndjson',
          authorization: `Bearer ${hubAccessToken}`,
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let err = '';
          res.on('data', (c) => { err += c; });
          res.on('end', () => done({ ok: false, reason: reasonForError(res.statusCode, err) }));
          return;
        }
        res.setEncoding('utf8');
        let buffer = '';
        const handleLine = (line) => {
          const s = line.trim();
          if (!s) return;
          let evt;
          try { evt = JSON.parse(s); } catch { return; }
          if (evt && evt.type === 'text_delta' && typeof evt.text === 'string') deltas.push(evt.text);
          if (typeof onEvent === 'function') onEvent(evt);
        };
        res.on('data', (chunk) => {
          buffer += chunk;
          let idx;
          while ((idx = buffer.indexOf('\n')) >= 0) {
            handleLine(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 1);
          }
        });
        // A stream error AFTER the headers (mid-stream reset) has no other
        // handler — without this the promise would never settle (hang).
        res.on('error', (e) => done({ ok: false, reason: (e && e.code) || 'stream-error' }));
        res.on('end', () => { handleLine(buffer); done({ ok: true, text: deltas.join('') }); });
      },
    );
    req.on('error', (e) => done({ ok: false, reason: (e && e.code) || 'network-error' }));
    req.on('timeout', () => { req.destroy(); done({ ok: false, reason: 'timeout' }); });
    req.write(payload);
    req.end();
  });
}

function streamAlmaChat({ hubAccessToken, message } = {}, opts = {}) {
  if (typeof message !== 'string' || !message.trim()) return Promise.resolve({ ok: false, reason: 'no-message' });
  return streamNdjson(opts.endpoint, { message, source: 'shakers-cli' }, { hubAccessToken, ...opts });
}

function streamAlmaDecision({ hubAccessToken, approved } = {}, opts = {}) {
  if (typeof approved !== 'boolean') return Promise.resolve({ ok: false, reason: 'no-decision' });
  return streamNdjson(opts.endpoint, { approved }, { hubAccessToken, ...opts });
}

// CLI+MCP entry: resolve the endpoint from config, then stream one turn.
async function askAlma(deps = {}, { hubAccessToken, message, onEvent, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getAlmaChatEndpoint = require('./config').getAlmaChatEndpoint,
    streamAlmaChat: stream = streamAlmaChat,
  } = deps;
  const endpoint = getAlmaChatEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return stream({ hubAccessToken, message }, { endpoint, onEvent, timeoutMs });
}

async function decideAlma(deps = {}, { hubAccessToken, approved, onEvent, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const {
    getAlmaDecisionEndpoint = require('./config').getAlmaDecisionEndpoint,
    streamAlmaDecision: stream = streamAlmaDecision,
  } = deps;
  const endpoint = getAlmaDecisionEndpoint();
  if (!endpoint) return { ok: false, reason: 'no-endpoint' };
  return stream({ hubAccessToken, approved }, { endpoint, onEvent, timeoutMs });
}

module.exports = {
  streamAlmaChat,
  streamAlmaDecision,
  askAlma,
  decideAlma,
};
