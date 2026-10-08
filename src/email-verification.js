'use strict';

const { requestBackend } = require('./backend-request');

// Email-verification client + wait-mode loop (skill-code-certification, ADR-006).

const DEFAULT_TIMEOUT_MS = 15000;
// Bounded so a Talent who can never produce a matching code can't loop forever — after this many CODE-ENTRY attempts we give up (nothing persisted, asked again next run).
const MAX_CODE_ATTEMPTS = 5;

// POST {email} to the request endpoint.
async function requestCode({ email }, { url, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url) return { ok: false, reason: 'no-endpoint' };

  let res;
  try {
    res = await requestBackend({ endpoint: url, body: { email }, timeoutMs });
  } catch (e) {
    if (e && e.kind === 'timeout') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network-error', detail: e && e.message };
  }

  if (res.status < 200 || res.status >= 300) {
    return { ok: false, reason: `http-${res.status}` };
  }
  return { ok: true, backend: res.backend };
}

// Maps a server "not verified" outcome to a soft reason the loop can retry on.
function mapNotVerifiedReason(bodyReason) {
  return bodyReason === 'expired' ? 'expired' : 'invalid-code';
}

// POST {email, code} to the verify endpoint.
async function verifyCode({ email, code }, { url, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url) return { ok: false, reason: 'no-endpoint' };

  let res;
  try {
    res = await requestBackend({ endpoint: url, body: { email, code }, timeoutMs });
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
    if (parsed && parsed.verified === true) return { ok: true, verified: true, backend: res.backend };
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

// Categorizes a verifyCode reason for the wait-mode loop: 'soft' -> invalid/expired code: show a message, keep waiting (retry).
function classifyVerifyReason(reason) {
  if (reason === 'invalid-code' || reason === 'expired') return 'soft';
  return 'technical';
}

// The interactive "modo espera": send a code, then loop reading the pasted code until it verifies, the Talent cancels, or attempts run out.
// talents-ai-score, ADR-042: `requestUrl`/`verifyUrl` address the ONE backend (the certifications service).
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
    // The OTP is a secret too (issue 102): same reader, same echo, and the fix is the same call.
    const readCode = typeof ask.secret === 'function' ? ask.secret.bind(ask) : ask;
    const raw = String(await readCode(v.codePrompt)).trim();

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
      return { verified: true, backend: result.backend };
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
