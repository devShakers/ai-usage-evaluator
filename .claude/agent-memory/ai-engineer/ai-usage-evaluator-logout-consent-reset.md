---
name: ai-usage-evaluator-logout-consent-reset
description: logout must clear consent.json too, not just auth-session.json — identity desync bug; clearConsentState() added; persistAndReport guards cross-email stale consent
metadata:
  type: project
---

Logout was clearing only the auth session, never `consent.json` — so account A's identity (`email`/`emailVerified`/`consent`/`lastSentAt`) survived into account B's next login (token = B, consent = A). Dangerous identity desync (hit live: token `quepasachaval`, consent `holaquetal`).

**Fix (branch `feat/cli-account-gate-command-cleanup`):**
- `src/share-consent-state.js`: new `clearConsentState()` = `fs.rmSync(consentPath(), { force: true })` wrapped in try/catch → no-op if absent, never throws. Exported there AND re-exported through `src/share.js` (the barrel `bin/login.js` already imports `isValidEmail`/`normalizeEmail` from).
- `bin/login.js#runLogout`: call `clearConsentState()` right after `clearAuthSession()`. Logout stays local-only (no network).
- `bin/login.js#persistAndReport`: defensive guard — before writing the new session, if `loadConsentState().email` differs (normalized) from the email now logging in, `clearConsentState()`. Same-email returning Talent keeps its just-granted consent (no wipe). Null email (some Google flows) skips the guard.

**Why:** covers the desync at BOTH exits — explicit `logout`, and login replacing an EXPIRED session of a different account without an intervening logout.

**Second half of the same bug — `bin/shakers.js` early-return:** `if (command === 'logout' && !hasSession()) return;` returned BEFORE dispatching `runLogout` whenever the stored session wasn't `active` (expired/invalid). So an expired session + stale consent.json = `shakers logout` silently no-op'd and the consent fix above never ran. Fix: deleted the early-return; `logout` is SESSION_EXEMPT so it always reaches `runLogout` (idempotent, local-only, uses the `had` flag for "sesión cerrada" vs "ninguna sesión"). Bonus: `shakers logout` with no session now prints a message instead of exiting silently, matching `bin/login.js logout` directly. Test: `test/bin-shakers-logout.test.js` spawns the REAL `bin/shakers.js logout` with an EXPIRED session + consent.json and asserts both are gone (first child-proc test of the shakers entry point — none existed).

**Gotchas / how to apply:**
- consent file path = `configDir()/consent.json`; tests point config via env `AI_FOOTPRINT_CONFIG_DIR` (also `CONFIG_DIR` override per ADR-045, dir name `shakers`). Assert removal with `fs.existsSync(path.join(dir,'consent.json'))===false`.
- This repo has NO biome/eslint/prettier — no lint tooling, no config, `test` script is just `node --test test/*.test.js`. Verify changes with `node -c <file>` + a require smoke test, not biome. The delegation brief assumed biome; it does not exist here.
- Tests need `unset SHAKERS_CLI_INGEST_ENDPOINT` (and `AI_FOOTPRINT_INGEST_ENDPOINT`) or they break.
- Test added: `bin-login-cli.test.js` "logout also wipes consent.json …" — seeds session + consent, runs real `logout` child proc, asserts both gone.
