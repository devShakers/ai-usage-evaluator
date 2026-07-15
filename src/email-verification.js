'use strict';

const http = require('http');
const https = require('https');

/*
 * Email-verification client + wait-mode loop (skill-code-certification,
 * ADR-006). Proves the Talent OWNS the email before anything is PERSISTED
 * under it: the CLI asks the Hub to send a 6-digit code (HubSpot transactional
 * email, server-side), then the Talent pastes it back and we verify it.
 *
 * This gates PERSISTENCE ONLY (ADR-003/ADR-006): the report is always shown by
 * the caller BEFORE this runs. A failed/cancelled/expired verification means
 * "don't persist" — never "hide the report".
 *
 * RESILIENCE CONTRACT — the DISCRIMINATED-result shape (like
 * src/certify-client.js, NOT the silent-fallback shape of
 * src/agent-synthesis.js). There is no offline way to prove email ownership,
 * so every failure must INFORM (a legible message + a "not verified" outcome),
 * never hang and never silently pretend success:
 *   requestCode -> { ok:true } | { ok:false, reason }
 *   verifyCode  -> { ok:true, verified:true }
 *                | { ok:false, reason:'invalid-code' | 'expired'         (soft: retry)
 *                             | 'no-endpoint' | 'network-error' | 'timeout'
 *                             | 'http-<status>' | 'invalid-json' }        (technical)
 *
 * SECURITY: the pasted code is sent only in the verify request body. It is
 * never logged nor echoed back beyond the single verify call.
 */

const DEFAULT_TIMEOUT_MS = 15000;
// Bounded so a Talent who can never produce a matching code can't loop
// forever — after this many CODE-ENTRY attempts we give up (nothing
// persisted, asked again next run). Resends ('r') do NOT consume an attempt.
const MAX_CODE_ATTEMPTS = 5;

function postJsonWithTimeout(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(Object.assign(e, { kind: 'invalid-url' }));
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
    req.on('timeout', () => req.destroy(Object.assign(new Error('email-verification timed out'), { kind: 'timeout' })));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// POST {email} to the request endpoint. Any 2xx -> ok (the Hub always answers
// 200 regardless of whether the email is a registered Talent — anti-enumeration,
// ADR-006). Never throws: failures come back as a discriminated reason.
async function requestCode({ email }, { url, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url) return { ok: false, reason: 'no-endpoint' };

  let res;
  try {
    res = await postJsonWithTimeout(url, { email }, timeoutMs);
  } catch (e) {
    if (e && e.kind === 'timeout') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network-error', detail: e && e.message };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: `http-${res.status}` };
  }
  return { ok: true };
}

// Maps a server "not verified" outcome to a soft reason the loop can retry on.
function mapNotVerifiedReason(bodyReason) {
  return bodyReason === 'expired' ? 'expired' : 'invalid-code';
}

// POST {email, code} to the verify endpoint. `verified:true` in a 2xx body is
// the ONLY success. A 2xx body with `verified:false` (or a 4xx the server uses
// for a bad/expired code) is a SOFT failure the loop retries. Anything else
// (5xx, network, timeout, unparseable) is technical. Never throws.
async function verifyCode({ email, code }, { url, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url) return { ok: false, reason: 'no-endpoint' };

  let res;
  try {
    res = await postJsonWithTimeout(url, { email, code }, timeoutMs);
  } catch (e) {
    if (e && e.kind === 'timeout') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network-error', detail: e && e.message };
  }

  let parsed = null;
  try {
    parsed = res.raw ? JSON.parse(res.raw) : null;
  } catch {
    // fall through: unparseable body handled per status below
  }

  if (res.status >= 200 && res.status < 300) {
    if (parsed && parsed.verified === true) return { ok: true, verified: true };
    if (parsed && typeof parsed === 'object') return { ok: false, reason: mapNotVerifiedReason(parsed.reason) };
    return { ok: false, reason: 'invalid-json' };
  }

  // Non-2xx: a bad/expired code the server rejects at the HTTP layer is still
  // a SOFT failure (retryable). 5xx and anything else is technical.
  if (res.status === 400 || res.status === 401 || res.status === 410 || res.status === 422) {
    return { ok: false, reason: mapNotVerifiedReason(parsed && parsed.reason) };
  }
  return { ok: false, reason: `http-${res.status}` };
}

// Categorizes a verifyCode reason for the wait-mode loop:
//   'soft'      -> invalid/expired code: show a message, keep waiting (retry).
//   'technical' -> network/timeout/5xx/unparseable/no-endpoint: bail out with a
//                  legible error (the Hub couldn't be reached / misbehaved).
function classifyVerifyReason(reason) {
  if (reason === 'invalid-code' || reason === 'expired') return 'soft';
  return 'technical';
}

/*
 * The interactive "modo espera": send a code, then loop reading the pasted
 * code until it verifies, the Talent cancels, or attempts run out. `ask` is
 * the same injectable stdin reader consent-flow.js already uses (piped/EOF
 * resolves to '' -> treated as cancel, never hangs). `deps` lets tests inject
 * requestCode/verifyCode without a network.
 *
 * Returns:
 *   { verified: true }
 *   { verified: false, reason: 'unavailable'   // no endpoint derived
 *                            | 'request-failed' // couldn't send the code
 *                            | 'cancelled'      // empty line / EOF / Ctrl-C
 *                            | 'expired'-N/A (folded into the loop as soft)
 *                            | 'technical'      // Hub unreachable/misbehaving
 *                            | 'exhausted' }    // too many wrong codes
 */
async function runEmailVerification({
  email,
  ask,
  catalog,
  requestUrl,
  verifyUrl,
  deps = {},
}) {
  const v = catalog.verify;
  const doRequest = deps.requestCode || requestCode;
  const doVerify = deps.verifyCode || verifyCode;
  const write = deps.write || ((s) => process.stdout.write(s));

  // No endpoint could be derived (ingest unset): nothing to verify against,
  // and nowhere to persist either. Quiet, non-error outcome.
  if (!requestUrl || !verifyUrl) {
    write(`  ${v.unavailable}\n`);
    return { verified: false, reason: 'unavailable' };
  }

  const sent = await doRequest({ email }, { url: requestUrl });
  if (!sent.ok) {
    write(`  ${v.requestFailed}\n`);
    return { verified: false, reason: 'request-failed' };
  }

  // Entered wait mode.
  write(`\n  ${v.sent(email)}\n`);
  write(`  ${v.waitHint}\n`);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; ) {
    const raw = String(await ask(v.codePrompt)).trim();

    // Empty line / EOF (piped, closed stdin) / Ctrl-C-then-Enter -> cancel.
    if (raw === '') {
      write(`  ${v.cancelled}\n`);
      return { verified: false, reason: 'cancelled' };
    }

    // Resend, without consuming an attempt.
    if (/^r$/i.test(raw)) {
      const resent = await doRequest({ email }, { url: requestUrl });
      write(resent.ok ? `  ${v.resent(email)}\n` : `  ${v.resendFailed}\n`);
      continue;
    }

    attempt++;
    const result = await doVerify({ email, code: raw }, { url: verifyUrl });
    if (result.ok && result.verified) {
      write(`  ${v.verified}\n`);
      return { verified: true };
    }

    if (classifyVerifyReason(result.reason) === 'soft') {
      write(result.reason === 'expired' ? `  ${v.expired}\n` : `  ${v.invalidCode}\n`);
      continue;
    }

    // Technical: the Hub couldn't be reached or answered unexpectedly. Legible
    // error, bail out (nothing persisted); the report was already shown.
    write(`  ${v.technicalError}\n`);
    return { verified: false, reason: 'technical' };
  }

  write(`  ${v.tooManyAttempts}\n`);
  return { verified: false, reason: 'exhausted' };
}

module.exports = {
  requestCode,
  verifyCode,
  classifyVerifyReason,
  runEmailVerification,
  DEFAULT_TIMEOUT_MS,
  MAX_CODE_ATTEMPTS,
};
