# AI Footprint — Handoff document (context for another agent)

This document summarizes the project, the decisions made and its status, so
another agent can continue without the conversation history.

## 1. What it is and where it comes from

Command-line tool that generates **locally** a profile of a developer's AI
tool usage: which copilots/agents they have, how deep the configuration
goes, and what maturity level they're at (0 to 4).

Origin: inspired by the `darnoux/claude-code-level-up` repo (scan local
signals and classify by level). Building it as a Claude Code *skill* was
ruled out because it would tie the tool to Claude Code users, and the
explicit goal is to cover **any** AI tool, not just Claude. That's why it's
a standalone CLI.

Business context: driven by Shakers (freelance talent marketplace). The
idea is for "talents" (freelancers) to run it and, optionally, share their
profile with the platform to understand AI adoption across the pool.

## 2. Key design decisions (with their rationale)

1. **Local first, sending separate and opt-in per-run.** The original repo
   only self-diagnoses and sends nothing. Here the report is always
   generated and shown locally (that's the value hook for the talent).
   Sending to the platform is a separate step: the first run with no
   consent decision persisted shows an explicit **disclosure** (what's
   sent/never sent) and asks once. Accepting requires typing an **email**;
   declining persists `denied` and the CLI never asks again (ADR-007,
   `active-work/talents-ai-score/decisions.md` — **supersedes** ADR-005's
   "no opt-in, sent from real talents" and ADR-006's "default ON" token
   model). Consent is revocable/changeable at any time via
   `--consent-revoke` / `--consent-email`, without re-running the
   disclosure.

2. **Only derived signals are sent, never content.** Booleans (detected
   yes/no), counts (number of MCP servers, skills, rules) and level/score
   are shared, plus the self-affirmed email (outside the whitelisted
   payload, in the request body). Never file contents, absolute paths,
   environment variables or credentials. The only file that gets parsed
   (`.mcp.json`) is opened only to count keys. Reason: avoid unintentionally
   building a secrets exfiltrator.

3. **Zero dependencies.** Everything with native Node modules. A talent
   clones and runs without `npm install`. Reason: trust (don't ask them to
   install third-party packages in a tool that scans their machine).

4. **Persistence in the home directory, not in the project.** Reports go
   to `~/.config/ai-footprint/`, never into the scanned repo, so they don't
   slip into a commit (that would be a leak, since the report lists their
   setup). The consent decision lives in the same directory
   (`consent.json`).

5. **Public repo, but endpoint and secrets kept out of the code.** The tool
   is public and auditable (reinforces trust; the install one-liner via
   `raw.githubusercontent` requires a public repo). The endpoint URL is NOT
   in the code: it's supplied via the `AI_FOOTPRINT_INGEST_ENDPOINT`
   environment variable (`src/config.js`), never hardcoded and never a
   secret (the endpoint is now public with no per-identity auth, see #6).

6. **Access control moved from per-identity tokens to a server kill switch
   \+ client-side opt-in (ADR-007).** The previous design (ADR-005/006)
   controlled who could SEND with a token issued per talent. That model
   never shipped against real data and is **fully retired** — see §11. The
   current design has NO per-identity auth at all: the ingestion endpoint
   is public (the CLI itself is a public repo, so an embedded secret
   wouldn't be one). What gates sending now: (a) the talent's own explicit
   consent (client-side), (b) a server-side kill switch that defaults OFF,
   and (c) rate limiting by normalized email + by IP.

7. **Identity is a self-affirmed email, not a verified credential.** The
   talent types their email during the disclosure flow; it's sent as-is,
   normalized (trim+lowercase) on both ends, and matched against
   `users.email` at ingestion time (server-side, in `shakers-hub-backend`)
   to attribute the report to a Talent if one exists — otherwise it's
   stored as a "lead". `email_verified` is always `false` in this
   iteration: no magic-link/code verification yet (deferred, ADR-007's
   caveat: "indicativo, no verificado", same invariant the brief already
   required of the whole signal set).

8. **HTML dashboard with its own identity.** Self-contained (no network
   calls), "signal console" aesthetic, so it's presentable without looking
   generic.

## 3. Architecture and files

```
install.sh                    Installer (curl | bash, or local if the repo is cloned)
package.json
README.md
HANDOFF.md                    This document
bin/report.js                 CLI orchestrator (flags and flow)
src/detectors.js              Catalog of 12 tools and their signals
src/scanner.js                Scan engine -> report object (booleans/counts only)
src/maturity.js                Level (0-4) and score (0-100) calculation
src/render-terminal.js        Terminal output with ANSI colors
src/render-html.js            Self-contained HTML dashboard
src/store.js                  Persistence in ~/.config/ai-footprint/
src/share.js                  Consent state, email identity, and automatic sending
src/consent-flow.js           Interactive disclosure + consent + email prompt (stdin-injectable)
src/cli-args.js               CLI flag parsing (extracted for unit testing)
src/config.js                 Ingestion endpoint from env var, never hardcoded
src/locale.js                 OS locale detection for report localization
src/i18n.js                   Report + consent/disclosure text catalogs (es/en)
reference-server/server.js    Reference server (in-memory STUB), public ingestion contract
```

Note: `report.js` uses `require` paths relative to its location, so the
folder structure must be preserved (the installer respects it).

## 4. Detection and classification

Detected tools (12): Claude Code, Cursor, GitHub Copilot, Windsurf, Aider,
Continue, Cline, Gemini CLI, Codex CLI, Cody, Zed, Tabnine.

Signals: existence of project config files/directories, global config in
the home directory, binaries on PATH, and installed editor extensions.
Depth: per-tool counts (instructions, rules, MCP servers, skills, commands,
hooks).

Maturity levels: 0 No trace · 1 Exploring (tools exist without project
config) · 2 Integrated (project instructions/rules exist) · 3 Power user
(MCP, or own skills/commands/rules, or 3+ tools) · 4 Orchestrator (agentic
CLI + MCP + own customization).

## 5. Data flow and payload

The scanner produces an already-sanitized report object. For sending,
`share.js` applies a strict whitelist (`derivePayload`) and only sends:
`schemaVersion, generatedAt, anonId, platform, level, levelName, score,
totalDetected, categories, tools[{id, detected, depth{counts}}]`.
The `anonId` is a non-reversible hash of hostname+user (only for
deduplication; it plays no identity role anymore — see #7 above). The
email travels OUTSIDE this whitelisted payload, in the request body:
`{email, payload}`.

## 6. Lifecycle for the talent

Every run: the report is generated and shown locally, always.

First run only (no consent decision persisted yet): an explicit disclosure
is shown (what's sent / never sent / purpose / "indicative, not verified" /
revocable / a legal-review placeholder), then a single yes/no question.

- **Accept** → asks for an email (basic format validation), sends
  `{email, payload}` once immediately, persists `consent=granted` + the
  email. Every following run resends silently (max. once per hour,
  client-side throttle), no preview or confirmation.
- **Decline** → persists `consent=denied`. Local report only, forever —
  the disclosure never runs again unless the talent explicitly re-engages
  via a management command.

Management, any time, without re-running the disclosure and without
scanning:

- `ai-footprint --consent-status` — view decision / email / last send.
- `ai-footprint --consent-revoke` — revoke (→ `denied`), no more automatic
  sends. Does not erase the stored email.
- `ai-footprint --consent-email <correo>` — change the email on file
  without touching the consent decision; the next successful send uses it.

There is no enrollment step anymore (no code, no token, no TTL/expiry to
manage) — see §11 for what was retired.

## 7. Server contract (current, ADR-007)

- `POST /reports` — **public, no per-identity auth**. Body `{email,
  payload}`. Server: validates email format, re-applies the whitelist by
  naming each field, tries to match the email to a Talent (write-time
  only, no retroactive rematch), upserts. Responses: **201** ok, **400**
  invalid shape/email/unknown schema major, **429** rate-limited (per
  normalized email AND per IP), **503** kill switch OFF (default,
  everywhere including prod).
- `GET /health` — liveness + whether the kill switch is on.
- Admin/audit surface (`X-Admin-Key` in the reference stub): lists stored
  reports. No token issuance/revocation anymore — nothing per-identity to
  administer.

The real implementation of this contract is `shakers-hub-backend`
(specs.md, `active-work/talents-ai-score`), not `reference-server/`, which
remains a local, dependency-free illustration only (ADR-002).

## 8. Current status (tested)

All of the following has been verified end to end locally:
- Scan + classification (level 0 in an empty environment; level 4 in a
  fixture with Claude Code, Cursor, Copilot, Windsurf, Gemini, Codex).
- Installation by copy (cloned repo) and uninstallation
  (`install.sh --uninstall`).
- Self-contained HTML dashboard (verified: no network calls at all).
- Disclosure shown once on first run; accept → email → send → silent
  resend on later runs; decline → local only, never asked again; malformed
  email re-prompts without persisting; no network → decision still
  persists, send fails silently without breaking the local report.
- Consent management: `--consent-status`, `--consent-revoke` (cuts off
  sending), `--consent-email` (next send uses the new address).
- Server rejections (reference stub): 400 invalid email/payload, 429 rate
  limit (per email and per IP), 503 kill switch OFF (default).
- No `Authorization` header, no token, anywhere in the client or the stub.

## 9. It's a STUB: what's missing for production

The reference server is a minimal example. Before production (this now
lives in `shakers-hub-backend`, per specs.md, not in this repo):
- Replace the IN-MEMORY store with a database (upsert by `talent_id`/
  `email`, per specs.md's Data model).
- Real email↔Talent match against `users`/`users_works_talents`
  (`LOWER(users.email)`), write-time only.
- Rate limiting over Redis or equivalent (sliding window), not in memory.
- Put the `/admin` surface behind real internal auth, not a single
  `ADMIN_KEY`.
- TLS at the gateway/load balancer.
- Kill switch read **per-request** (not just at startup like this stub),
  so it can flip without a redeploy.

## 10. Configuration pending to be filled in

- `install.sh`: `OWNER`, `REPO`, `BRANCH` variables with the real repo
  (currently set to the real public repo already — recheck if this
  README is out of date).
- CLI: `AI_FOOTPRINT_INGEST_ENDPOINT` (no default — see §5/`src/config.js`).
- Server: `ADMIN_KEY`, `PUBLIC_URL`, `PORT`, `AI_FOOTPRINT_INGEST_ENABLED`
  per environment.

## 11. What was retired (ADR-007, supersedes ADR-005/006)

The earlier design controlled sending with a **token-based enrollment**
model: a Shakers panel issued a single-use code tied to a `talentId`, the
CLI exchanged it via `--enroll=CODE` for a hashed, TTL'd, revocable Bearer
token, and every send carried `Authorization: Bearer <token>`. That model
is **fully removed** from this repo: `--enroll`, `decodeEnrollString`,
`enroll()`, `--consent on|off`, the `Authorization` header, and the
`token`/`talentId`/`expiresAt`/`enrolledAt` fields no longer exist in the
code (`git log` has the history if you need to see it). It never shipped
against real data (local testing only), so there was nothing to migrate.
`credentials.json` became `consent.json` with a different shape
(`{consent, email, lastSentAt}`).

## 12. Legal notice (non-technical, important)

Sending data about how a person works is personal data processing (GDPR,
consent, transparency), and talents are usually located in the EU. ADR-007
moves to an explicit opt-in disclosure with a self-affirmed, unverified
email — a better privacy posture than ADR-005/006's "no opt-in, sent from
real talents by default", but it does **not** replace a proper legal basis
or GDPR information duties, and it **widens** scope by also storing emails
of non-talents ("leads") who never registered. The disclosure text ships
with an explicit `[PENDING LEGAL REVIEW]` placeholder (`src/i18n.js`,
`consent` catalog) instead of invented legal copy — **requires legal/labor
sign-off BEFORE deploying the backend with the kill switch ON and
distributing the CLI**, which is when the real data flow about real
talents (and leads) kicks off. The kill mechanism (server kill switch,
default OFF, plus client-side consent) remains intact so it can be
reverted without a redeploy.

## 13. Suggested next steps

- Legal/labor sign-off on the disclosure copy (fill the `[PENDING LEGAL
  REVIEW]` placeholder) before flipping the kill switch ON anywhere.
- Implement the real ingestion contract in `shakers-hub-backend` per
  specs.md (Data model, API contracts, email↔Talent match port).
- Define server-side aggregation metrics (distribution by level over
  matched Talents + a separate "leads" counter) to make use of the reports.
- Decide retention/purge policy for lead emails (no Talent-deletion hook
  reaches them today — open question in specs.md).
