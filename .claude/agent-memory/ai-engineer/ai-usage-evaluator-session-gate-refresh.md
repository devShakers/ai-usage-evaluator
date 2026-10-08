---
name: ai-usage-evaluator-session-gate-refresh
description: command session gate is now refresh-aware (src/session-gate.js) — mints JWT from durable cookie before rejecting; expiresAt tracks the COOKIE window not the JWT
metadata:
  type: project
---

Non-exempt commands (`add-agent`, `certify`, `me`, …) were gated by `sessionStatus(loadAuthSession()) === 'active'`, which reads `session.expiresAt`. User hit "add-agent me pidió login estando logueado".

**Confirmed mechanism (read the code, don't trust the ticket's guess):**
- `auth-session.json` stores TWO expiries: `expiresAt` and `accessTokenExpiresAt`.
- On email/cookie login, `expiresAt` = the DURABLE COOKIE window (~7d), NOT the JWT (~15min). `src/auth-client.js#requestLogin` returns both `expiresAt`(JWT) and `cookieExpiresAt`(cookie); `bin/login.js#persistAndReport` + `src/onboarding-flow.js` pass `cookieExpiresAt`, and `saveAuthSession`'s cookie branch prefers `cookieExpiresAt` for `expiresAt`, storing the JWT window only in `accessTokenExpiresAt`. So the "medio bug" (expiresAt=JWT) the ticket hypothesized does NOT exist on the current login path — did NOT touch saveAuthSession.
- `sessionStatus` therefore already tracks the COOKIE for email sessions → an email session stays `active` 7d and `bin/shakers.js` line ~226 `ensureFreshSession` mints a fresh JWT from the cookie once per command. Email gate was already correct.
- The genuinely broken cases the fix now recovers: (1) **Google/auth-works** device-flow sessions have NO cookie → `expiresAt` = JWT 15min, no refresh possible (still rejected, correct — no cookie to mint from). (2) **legacy/mis-stored** cookie sessions whose `expiresAt` landed on a stale JWT window: `ensureFreshSession` mints a fresh JWT but re-derives `cookieExpiresAt: session.expiresAt` from the stale value, so `sessionStatus` stayed `expired` forever. The gate now proves cookie liveness by the mint itself, not the stored expiry.

**Reusable refresh path:** `src/session-refresh.js#ensureFreshSession(env, {now,marginMs,...deps})` → `src/auth-client.js#requestAuthToken({cookie})` (GET tokenEndpoint, `Cookie` header) → persists via `saveAuthSession`. Returns the reloaded session on success, the old (stale) session on failure. `src/ai-profile-preview.js` uses a caller-supplied `refreshToken()` on `http-401`; the durable-cookie mint vehicle is `ensureFreshSession`, reuse it.

**Fix:** new `src/session-gate.js#hasUsableSession(env, deps)` — returns true if `sessionStatus === 'active'`, else (only if a cookie exists) runs `ensureFreshSession` and returns whether a currently-valid JWT resulted (`accessTokenExpiresAt > now`). No cookie → reject without a network call. `bin/shakers.js` replaced the sync `hasSession()` with `await hasUsableSession(process.env)` (one call, reused for the gate AND the ai-usage reminder); removed the now-dead `hasSession` + its `loadAuthSession/sessionStatus` import. Did NOT touch `SESSION_EXEMPT`.

**How to apply / gotchas:**
- `hasUsableSession` is the injectable seam (`loadAuthSession`, `ensureFreshSession`, `now`) — unit-test it directly (`test/session-gate.test.js`); to faithfully "mock requestAuthToken" wrap the REAL `ensureFreshSession` with mocked `requestAuthToken`/`saveAuthSession`/`getAuthTokenEndpoint`.
- `no-dead-modules.test.js` requires every `src/`+`bin/` file be statically `require`-reachable from `bin/shakers.js`; a new module must be `require`d there (session-gate is, via the gate).
