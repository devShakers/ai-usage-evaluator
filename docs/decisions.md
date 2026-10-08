# Architecture decisions

Until now the CLI's ADRs lived inline (code docblocks, `AGENTS.md`, `README.md`)
with a shared `ADR-0XX` numbering but no single log. This file starts that log
for new decisions, continuing the existing numbering. Older ADRs stay where they
were referenced; they are not retrofitted here.

Append-only: to change a decision, add a new ADR that supersedes/reverts the old
one — never rewrite a landed entry.

---

## ADR-060 — The CLI dispatches by arguments; the REPL is retired (supersedes ADR-014)

**Status:** accepted (talents-ai-score rework).

**Context.** ADR-014 made the branded interactive shell (`shakers` REPL) the
single entry point: `bin/shakers.js` opened a prompt and dispatched commands
typed inside it. Product reframed the CLI as a plain npm package that talks to
the common API (`shakers <cmd> [flags]`), so an interactive shell is no longer
the surface we want, and one-shot invocation is what agents and scripts need.

**Decision.** `bin/shakers.js` now parses `argv`: `shakers <command> [flags]`
runs that command and exits; with no command (or `help`) it prints a usage
screen. No REPL is opened. Each command keeps the dual-TTY contract it already
had (interactive human vs. one-shot/`--json` agent mode) and owns its own stdin
reader when invoked standalone — the dispatcher no longer threads a shared
reader. Per-command exit codes propagate (the REPL used to force `exitCode = 0`).

**Consequences.** The REPL machinery (`src/repl-shell.js`, `src/repl-stdin.js`,
`src/command-completer.js`) and the command model it fed (`src/command-graph.js`)
lost their only caller. They are kept in the tree pending a decision to rewire or
delete them, and are allow-listed in `test/no-dead-modules.test.js`; note that
`install.sh` ships `src/*.js` by glob, so these remain shipped until removed — a
cleanup follow-up should delete them if they will not be reused. The REPL-only
tests (`repl-prompt-pty`, `command-completer`) were removed.

---

## ADR-061 — Session gating: `ai-usage` is the only anonymous command (reverts ADR-044's optional login)

**Status:** accepted (talents-ai-score rework).

**Context.** ADR-044 made login optional: an anonymous run got the full product,
and identity only changed what the report displayed. The public command was also
renamed to `ai-usage` (from the legacy `usage`/`bin/report.js`).

**Decision.** `ai-usage` is the only command a non-registered (session-less)
caller may run — the anonymous AI-usage evaluation, with its existing
consent → email → persistence flow unchanged. Every other product command
(`certify`, `map`, `report`, `share`) requires an active session. Exempt from the
session gate: `ai-usage` and `login` (the way to obtain a session); `logout`
without a session is a silent no-op. `superadmin` is also exempt — it is a
non-prod, self-gated provisioning escape hatch (ADR-021) used precisely when
there is no ordinary session, so gating it behind login would defeat it. A
session-less caller hitting a gated command gets a clear error; in non-TTY/agent
mode this is `exitCode ≠ 0` plus what is missing and how to log in.

**Consequences.** This reverts ADR-044's optional-login stance and the
deliberate "certify skills works from a cold start" affordance (command-graph
docblock) — both intentional. Gating is enforced centrally in `bin/shakers.js`
at dispatch, reading the auth session (`src/auth-session-store.js`); the former
profile/capability model in `src/command-graph.js` is no longer on the dispatch
path.

---

## ADR-062 — The parked `start` sub-flows become the `add-skill` / `add-agent` / `add-project` commands

**Status:** accepted (talents-ai-score rework).

**Context.** ADR-060 retired the REPL and ADR-061 parked the three `start`
sub-flows (`src/start-add-{skills,agents,portfolio}.js` and their client layer)
in `no-dead-modules`' `PRESERVED_ORPHANS`, pending a decision to rewire or delete.
They implement talent-facing profile writes (declare Skills, declare an agent, add
a portfolio project) and are worth keeping.

**Decision.** Each becomes a first-level argv command, one bin file each:
`add-skill` → `runAddSkills`, `add-agent` → `runAddAgents`, `add-project` →
`runAddPortfolio` (portfolio = projects). All three require an active session
(they are NOT session-exempt, so ADR-061's central gate applies; each bin also
self-gates for standalone `node bin/<cmd>.js`). Persistence stays talent-facing:
the `../works/talents/me/…` endpoints authenticated by the certs session Bearer
plus the talent's own `X-Hub-Token` — never an admin/service token.

Agent mode reuses the CLI's existing dual-TTY contract rather than a per-question
flag surface (which would rewrite the interactive step logic): TTY = interactive
pickers; non-TTY = numbered fallbacks over piped stdin (EOF-safe). A new
`preAccepted` parameter is threaded into each module's `confirmDisclaimerAcceptance`
call so `--accept-disclaimer` clears the egress consent gate non-interactively;
each bin parses `--help`/`--root`/`--lang`/`--accept-disclaimer` and, in non-TTY
without `--accept-disclaimer`, exits with a non-zero code naming the missing flag.

**Consequences.** `PRESERVED_ORPHANS` is now empty — every shipped module is again
reachable from the entry point, restoring the guard's full strength. A richer
per-question flag surface (`--name`/`--title`/`--type`/`--skill`…) with
per-command required-field exit codes is deliberately deferred; it would rewrite
the interactive flows and can be added later if agent use demands it.

## ADR-063 — Config resolution: two configurable bases (hub + certs), local defaults seeded to config.json, secrets env-only

**Status:** accepted (evaluation-mcp / talents-ai-score).

**Context.** The onboarding endpoints live in TWO services (hub + certs), and the
old resolution derived everything as a sibling of the certs ingest URL, which both
pointed hub routes at certs and forced the user to `export SHAKERS_CLI_INGEST_ENDPOINT`
(and, once hub was split out, `SHAKERS_CLI_HUB_BASE`) for anything to work locally.

**Decision.**
- **Two configurable bases.** `certsBase` (default `http://localhost:3004/api/v1`)
  anchors ingest + interviews + every existing `usage/*`/`auth/*`/`works/talents/me/*`
  relay route; `hubBase` (default `http://localhost:3001/api/v1`) anchors the
  hub-direct onboarding routes (import-profile, professional-details, pricing-rate,
  complete-onboarding). If a single prod gateway ever replaces the two hosts, set
  both bases to the same value.
- **Precedence per key: env > config.json > default.** Setting `SHAKERS_CLI_INGEST_ENDPOINT`
  still works and back-derives `certsBase` (strip `/usage/reports`) so interviews follow it.
- **The getters keep NO baked endpoint** (the public-repo invariant holds): they return
  `null` when nothing is configured. The localhost dev defaults are written to the
  talent's own `config.json` by a first-run bootstrap (`ensureLocalConfigDefaults`,
  talent profile only, missing keys only, never a production URL, never a secret),
  so LOCAL needs ZERO exports and a config reset re-seeds on next run. `shakers config
  set/get/list` reads/writes the same non-sensitive keys.
- **Secrets are never baked, never persisted in a committed file, never in the runbook.**
  No secret is read from an env var today; auth tokens come from `shakers login`
  (stored 0600 in `auth-session.json`) and, in MCP deploy, the talent JWT is passed
  per-call (Authorization), injected by the MCP client's `env` block or a secret store —
  never hardcoded. `shakers config` refuses any key outside the non-sensitive allowlist.

**Consequences.** Local: `register`/`onboarding`/`ai_usage`/`login` resolve to
localhost:3001/3004 with no exports. Deploy: inject `SHAKERS_CLI_HUB_BASE` /
`SHAKERS_CLI_CERTS_BASE` (or `SHAKERS_CLI_INGEST_ENDPOINT`) via the environment or the
MCP server `env` block; secrets stay env/secret-store only. Existing config tests are
unchanged because the getters keep the `null`-when-unset contract (the defaults live in
the seeded config.json, not in the getters).

## ADR-064 — `register` step 1 creates the account (sign-up), it does not log in an existing one

**Status:** accepted (evaluation-mcp / ADR-026 upstream).

**Context.** `register` began step 1 by calling `login`, which only works for an account that already
exists. The product requires `register` to onboard a NEW talent, i.e. to create the account.

**Decision.**
- Step 1 is a **sign-up**: `POST {hubBase}/auth/register/talent/email`, `@Public()`,
  **multipart/form-data**, no OTP (new `postMultipartWithTimeout` in backend-request.js;
  `src/signup-client.js`). Fields: name, lastName, email, password (>=8 + hub policy;
  `preferredLanguage` uppercased to the hub enum ES/EN/IT/PT/FR), newsletterConsent, freelanceType
  (+ freelanceIntent when EMPLOYEE/POTENTIAL_FREELANCE). Individual/company is captured HERE, so the old
  separate professional-details step is folded into sign-up; **pricing stays its own step**. New order:
  sign-up -> import -> pricing -> AI-usage consent -> interview -> complete-onboarding.
- **Existing email:** the endpoint answers **2xx with `data.kind === 'account-already-exists'`** (not 409).
  Detected by `kind`; the CLI falls back to interactive `login`, the MCP returns reason `account-exists`
  pointing to the login tool.
- **Session after sign-up (hub vs certs):** sign-up returns a hub `accessToken`, but the rest of the flow
  needs the canonical dual-token session (certs Bearer for interviews/usage + hub JWT for hub-direct
  steps). After a successful sign-up the flow runs the certs `login/email` behind the scenes with the same
  credentials (`establishSessionFromCredentials`) and persists BOTH tokens — verified live: sign-up on
  hub:3001 returns 2xx+token and the subsequent certs login returns certs+hub tokens.
- **Google/LinkedIn** sign-up stays out of the CLI (OAuth/browser); CLI is email+password.

**Consequences.** `register` no longer requires a prior session (it creates one); `login`/`onboarding`
still require an existing account. E2E must use a NEW email per run.

## ADR-065 — Defaults baked to the new-works feat-env (hub) + certs develop, for phase-1 internal testing (supersedes ADR-063's "no baked endpoint")

**Status:** accepted (owner decision, 2026-09-09).

**Context.** ADR-063 kept the getters baked-endpoint-free on purpose: `DEFAULT_HUB_BASE`/
`DEFAULT_CERTS_BASE` pointed at loopback (`localhost:3001`/`3004`) and only ever reached a
Talent's `config.json` via the first-run seed (`ensureLocalConfigDefaults`), never compiled
into a response the getters return directly. That was right for a PoC with nothing deployed.
Phase 1 (meta-repo ADR-035: private `@shakers` registry, internal team testing) now has real
non-prod hosts to point at, and testers should not have to `export`/`shakers config set`
anything to get a working install.

**Decision.** `DEFAULT_HUB_BASE` and `DEFAULT_CERTS_BASE` in `src/config.js` change from
loopback to the new-works feat-env (hub) and certs develop non-prod hosts:
- `DEFAULT_HUB_BASE` → `https://api.hub.new-works.dev.shakersworks.com/api/v1`
- `DEFAULT_CERTS_BASE` → `https://api.dev.certifications.shakersworks.com/api/v1`

Nothing else about ADR-063's resolution model changes: precedence is still
env > config.json > default, the values still only reach a Talent's machine through the
same first-run seed path (`ensureLocalConfigDefaults`, talent profile only, missing keys
only), and no secret is baked anywhere.

**Consequences.** A phase-1 internal tester gets a working `register`/`onboarding`/`ai_usage`/
`login` against real (non-prod) backends with zero configuration. `SHAKERS_CLI_HUB_BASE` /
`SHAKERS_CLI_CERTS_BASE` (env or `config.json`) still override, unchanged. **Phase 2 /
production must swap these two defaults to the production URLs before public distribution**
— the feat-env/develop hosts are non-prod and ephemeral (they can be torn down or rotated
without notice), so shipping them as the public default past phase 1 would point every
fresh install at infrastructure with no uptime guarantee.
