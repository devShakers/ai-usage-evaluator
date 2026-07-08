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

1. **Local first, sending separate and automatic.** The original repo only
   self-diagnoses and sends nothing. Here the report is always generated
   and shown locally (that's the value hook for the talent). Sending to the
   platform is a separate step, automatic after enrolling (no preview or
   per-run confirmation), gated by a consent flag persisted in the local
   credential — **ON by default** (ADR-006,
   `active-work/talents-ai-score/decisions.md`; revises ADR-005's original
   OFF default), but can be turned off at any time with `--consent=off`
   without re-enrolling.

2. **Only derived signals are sent, never content.** Booleans (detected
   yes/no), counts (number of MCP servers, skills, rules) and level/score
   are shared. Never file contents, absolute paths, environment variables
   or credentials. The only file that gets parsed (`.mcp.json`) is opened
   only to count keys. Reason: avoid unintentionally building a secrets
   exfiltrator.

3. **Zero dependencies.** Everything with native Node modules. A talent
   clones and runs without `npm install`. Reason: trust (don't ask them to
   install third-party packages in a tool that scans their machine).

4. **Persistence in the home directory, not in the project.** Reports go
   to `~/.config/ai-footprint/`, never into the scanned repo, so they don't
   slip into a commit (that would be a leak, since the report lists their
   setup).

5. **Public repo, but endpoint and secrets kept out of the code.** The tool
   is public and auditable (reinforces trust; the install one-liner via
   `raw.githubusercontent` requires a public repo). The endpoint URL is NOT
   in the code: it arrives inside the credential obtained when enrolling.

6. **Access control at the endpoint, not in the repo.** Anyone being able
   to USE the tool is unavoidable and costs nothing. What's controlled is
   who can SEND. This is solved with token-based enrollment: without a
   valid credential, sending is rejected (401). This way no reports arrive
   from strangers.

7. **Token lifecycle controlled by the platform.** Issuance (single-use
   code tied to a `talentId`), expiry (TTL), revocation, and audit. Tokens
   are stored **hashed** (never in plaintext); the secret is handed out
   only once at enrollment time. The server attributes the report based on
   the token, not on what the client claims (nobody can send on someone
   else's behalf).

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
src/maturity.js               Level (0-4) and score (0-100) calculation
src/render-terminal.js        Terminal output with ANSI colors
src/render-html.js            Self-contained HTML dashboard
src/store.js                  Persistence in ~/.config/ai-footprint/
src/share.js                  Enrollment, consent flag (ON by default) and automatic sending
src/locale.js                 OS locale detection for report localization
src/i18n.js                   Report text catalogs (es/en)
reference-server/server.js    Reference server (in-memory STUB) with an admin layer
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
deduplication).

## 6. Lifecycle for the talent

One time only: (1) they receive their `ai-footprint --enroll=...` command
from their Shakers panel, (2) they install via the one-liner or by cloning,
(3) they run `--enroll` once, which exchanges the code for a token stored
in `~/.config/ai-footprint/`.

Whenever they want: they run `ai-footprint` (or `--html`) from their
project's folder and see their report locally. Without enrolling, this
sends nothing.

Sending: if enrolled and consent is ON (default, ADR-006), every normal run
sends the report automatically at the end, with no preview or confirmation,
with a 1h client-side throttle (doesn't resend if the last send was less
than an hour ago). Can be turned off at any time with
`ai-footprint --consent=off` (and back on with `--consent=on`), without
re-enrolling.

Re-enrollment: only if the token expires (TTL) or is revoked. The next
automatic-sending attempt fails silently except for a non-blocking
"re-enroll" (401) notice; the local report keeps working the same. No need
to install again.

The scanner looks at the current folder (project config) and the home
directory (global config), which is why it's run from inside the project.

## 7. Server contract

Talent routes:
- `GET /health`
- `POST /enroll {code}` -> `{token, endpoint, talentId, expiresAt}`
- `POST /reports` (with `Authorization: Bearer`) -> 201 / 401 / 429 / 400

Admin routes (`X-Admin-Key` header):
- `POST /admin/enroll-codes {talentId, ttlHours?}` -> returns `code`,
  `enrollString` and the `command` ready to show on the panel
- `GET /admin/tokens` -> lists `{id, talentId, issuedAt, lastUsedAt,
  expiresAt, revoked}` (never the token)
- `POST /admin/revoke {id}` -> revokes by public id

## 8. Current status (tested)

All of the following has been verified end to end locally:
- Scan + classification (level 0 in an empty environment; level 4 in a
  fixture with Claude Code, Cursor, Copilot, Windsurf, Gemini, Codex).
- Installation by copy (cloned repo) and uninstallation
  (`install.sh --uninstall`).
- Self-contained HTML dashboard (verified: no network calls at all).
- Enrollment, automatic sending gated by the persisted consent flag, and
  attribution.
- Server rejections: 401 invalid/revoked/expired token, 404 unknown code,
  409 code already used, 429 rate limit (5/hour).
- Control cycle: admin issues code -> talent enrolls and sends -> admin
  audits token (sees last use) -> admin revokes -> next send returns 401.
  Admin without a key: 401.
- Tokens stored hashed (the listing never exposes the secret).

## 9. It's a STUB: what's missing for production

The reference server is a minimal example. Before production:
- Replace IN-MEMORY stores with a database (codes, tokens, reports).
- Store hashed tokens in the DB (the stub already hashes, but in memory).
- Rate limiting over Redis or equivalent (sliding window), not in memory.
- Put the `/admin` surface behind real internal auth, not a single
  `ADMIN_KEY`.
- TLS at the gateway/load balancer.
- The Shakers panel must generate enrollment codes per talent (`--enroll`
  string format: base64url of `{enrollUrl, code}`).

## 10. Configuration pending to be filled in

- `install.sh`: `OWNER`, `REPO`, `BRANCH` variables with the real repo
  (currently `TU-ORG`).
- Server: `ADMIN_KEY`, `PUBLIC_URL`, `PORT` per environment.
- Create the public repo on GitHub and upload these files.

## 11. Legal notice (non-technical, important)

Sending data about how a person works is personal data processing (GDPR,
consent, transparency), and talents are usually located in the EU. Since
ADR-006, sending is automatic and the CLI's consent flag comes **ON by
default** (same as the server kill switch) — an explicit user decision, with
the reinforced caveat that it **requires legal/labor sign-off BEFORE
deploying the backend and distributing the CLI**, which is when the real
data flow about real talents kicks off. The kill mechanism (flag + kill
switch) remains intact so it can be reverted without a redeploy.

## 12. Suggested next steps

- Connect enrollment code issuance to the Shakers panel (close the
  talent's first step).
- Define server-side aggregation metrics to make use of the reports.
- Harden the reference server toward production (section 9).
