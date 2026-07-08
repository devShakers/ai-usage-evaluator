# AI Footprint

> **Status: proof of concept (PoC) — distribution only.** This repository
> publishes only the CLI (PoC). The local report
> works 100%. The consent/disclosure flow and automatic sending are
> **inert**: there is no server deployed behind them. See the section
> ["Sharing the report with the platform" ↓](#sharing-the-report-with-the-platform--not-available-in-this-poc-yet)
> for details.

Command-line tool that generates, **locally**, a profile of a developer's AI
tool usage: which copilots and agents they have configured, how deep that
configuration goes, and what maturity level they're at (0–4).

Inspired by the mechanism in `claude-code-level-up` (scan local signals and
classify by level), but extended to cover the main AI tools on the market,
not just Claude.

## Installation

One line:

```bash
curl -fsSL https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/main/install.sh | bash
```

> Note (PoC): the one-liner points at the `main` branch, the only one
> published on the remote — check `install.sh` for the current version if
> this README is out of date.

The installer checks that you have Node 18+, places the tool in
`~/.ai-footprint/` and drops the `ai-footprint` command in `~/.local/bin`.
Zero dependencies: it doesn't run `npm install` or download third-party
packages.

Alternative by cloning the repo (same result, but you can review the code
before installing, which is recommended):

```bash
git clone https://github.com/devShakers/ai-usage-evaluator
cd ai-usage-evaluator
git checkout main
./install.sh
```

Uninstall: `./install.sh --uninstall`.

## Usage

```bash
ai-footprint                  # report in the terminal
ai-footprint --html           # also generates and opens the visual dashboard
ai-footprint --json           # report as JSON on stdout
ai-footprint --root ../other  # scans another directory
ai-footprint --no-save        # writes nothing to disk
```

Without installing, from a copy of the repo, this is equivalent to
`node bin/report.js [options]`.

The **first time** you run the tool (and only then, unless you revoke your
decision), it shows an explicit disclosure of what would be sent/never sent
and asks once whether you accept sending your report to the platform. See
below.

## Sharing the report with the platform — NOT AVAILABLE IN THIS POC YET

> **Inert in this PoC.** The consent/disclosure and sending mechanism exists
> in the code and is documented below because it describes the full design,
> but **there is no Shakers server deployed to production yet**. The
> ingestion endpoint is supplied via the `AI_FOOTPRINT_INGEST_ENDPOINT`
> environment variable (never hardcoded, see `src/config.js`); without it
> set, the tool sends nothing. **We don't promise working delivery at this
> stage**, only the local report (which does work 100%).

Design (talents-ai-score, ADR-007 — supersedes the earlier token/enrollment
model, see git history): the first time you run `ai-footprint` with no
consent decision persisted yet, it shows an explicit **disclosure** (what
gets sent, what never does, the purpose, and a notice that the data is
*indicative, not verified*) and asks once whether you accept. If you
accept, it asks for your **email** and sends `{email, payload}` to the
configured endpoint — no `Authorization` header, no token: the endpoint is
public and identity travels in the body. If you decline, it persists that
and never asks again (only local reports, forever, unless you change your
mind). Once you've decided, a normal run never interrupts you with the
disclosure again — accepted runs resend silently (max. once per hour).

Expected talent flow (once the server is deployed):

```bash
# 1) First run: you see the disclosure and answer once
ai-footprint
#   ...disclosure text...
#   ¿Aceptas enviar este informe? (s/n): s
#   Introduce tu correo: talent@example.com

# 2) From here on, every normal run sends the report automatically
#    (max. once per hour), with no preview or confirmation
ai-footprint

# 3) Manage your decision at any time, without re-running the disclosure
ai-footprint --consent-status         # see decision / email / last send
ai-footprint --consent-revoke         # revoke -> denied, no more sends
ai-footprint --consent-email you@new-address.com   # change the email on file
```

What would be sent: only derived data (level, score, tools detected
yes/no, per-tool counts) plus the email you typed in. Never file contents,
paths or credentials. Sending failures (network, rate limit, kill switch
off) never break the local report. The decision is stored at
`~/.config/ai-footprint/consent.json` (permissions 600): `{consent, email,
lastSentAt}`.

> **Legal notice (pending):** this repository intentionally does NOT ship
> GDPR-specific legal copy — the disclosure includes an explicit
> `[PENDING LEGAL REVIEW]` placeholder (see `src/i18n.js`, `consent`
> catalog) instead of invented legal text. A legal/labor expert must review
> and fill it in, and sign off, before this is activated against real
> talents (ADR-007).

## Reference server (NOT deployed in this PoC)

> Out of scope for this PoC (ADR-002, `active-work/talents-ai-score`): the
> `reference-server/` code lives in the repo as contract documentation and
> for review, but **it is not run nor deployed**. There is no instance
> running at Shakers that this CLI connects to. The real server for this
> contract is `shakers-hub-backend` (specs.md), not this stub.

`reference-server/server.js` is a **dependency-free stub** that illustrates
the CURRENT contract (ADR-007): a public ingestion endpoint, no
per-identity auth, rate-limited by email and by IP, gated by a kill switch
that defaults OFF. It's an in-memory example with no Talent database (every
report is stored as a "lead" keyed by email) — your team reimplements it on
real infrastructure (Postgres, email↔Talent match, Redis-backed rate
limiting, TLS at the gateway).

```bash
AI_FOOTPRINT_INGEST_ENABLED=true node reference-server/server.js
# starts with the kill switch ON so you can test end to end locally
```

Routes: `GET /health`, `POST /reports` (public, `{email, payload}`),
`GET /admin/reports` (audit, requires `X-Admin-Key`). Access control moved
from per-identity tokens to: (a) the kill switch (503 while OFF — the
default, everywhere including prod), and (b) rate limiting by normalized
email + by IP (429 past the ceiling). Anyone can call `/reports` once the
switch is ON (the CLI itself is a public repo, so an embedded secret
wouldn't be one) — what's controlled is volume and the local disclosure
gate on the client, not who's technically allowed to POST.

### Audit and kill switch

```bash
# Audit: lists reports received (no PII beyond the email itself)
curl http://localhost:8787/admin/reports -H "X-Admin-Key: YOUR_KEY"
```

- **Kill switch**: `AI_FOOTPRINT_INGEST_ENABLED` (read once at startup in
  this stub; specs.md's real backend reads it per-request so it can flip
  without a redeploy). Defaults OFF — `POST /reports` returns 503 until
  it's explicitly turned on.
- **Rate limit**: per normalized email AND per IP, 5/hour each (in-memory
  sliding window in this stub; per-replica ceiling in production until
  moved to Redis, see specs.md).
- **No token/enrollment lifecycle anymore** (ADR-007 retires it entirely):
  there's nothing to issue, expire, or revoke per-talent. Revocation of
  *sending* lives client-side (`ai-footprint --consent-revoke`).

In production, this admin surface lives behind your real internal auth and
on top of a database, not the stub's in-memory store.

> Notice: sending data about how a person works involves processing personal
> data (GDPR, consent). Validate it with a legal/labor expert before
> enabling sending in production — see the legal notice above.

## Usage (quick reference)

```bash
ai-footprint                       # report in the terminal (asks for consent once, first run)
ai-footprint --html                # also generates and opens the visual dashboard
ai-footprint --json                # report as JSON on stdout
ai-footprint --root ../other       # scans another directory
ai-footprint --no-save             # writes nothing to disk
ai-footprint --consent-status      # view consent decision / email / last send
ai-footprint --consent-revoke      # revoke consent (-> denied), no more sends
ai-footprint --consent-email E     # change the email on file
```

Results are saved in `~/.config/ai-footprint/` (`latest.json`,
`report.html`, and a dated history under `history/`). **Never** is anything
written to the scanned project, so the report can't end up in a commit by
mistake.

## Tools it detects

Claude Code, Cursor, GitHub Copilot, Windsurf, Aider, Continue, Cline,
Gemini CLI, Codex CLI, Cody, Zed and Tabnine.

Detection is based on the existence of config files/directories, binaries
on `PATH`, and installed editor extensions. "Depth" measures how much each
tool has been configured (project instructions, rules, MCP servers, skills,
commands, hooks).

## Maturity levels

| Level | Name | Criteria |
|------|--------|----------|
| 0 | No AI footprint | no tool detected |
| 1 | Exploring | tools exist, but no project configuration |
| 2 | Integrated | at least one project instructions/rules file exists |
| 3 | Power user | MCP, own skills/commands/rules, or 3+ tools |
| 4 | Orchestrator | agentic CLI + MCP + own customization (deep automation) |

(These are the English names; the report itself is localized to the
talent's OS locale — Spanish or English — see `src/i18n.js`.)

## Privacy design (important)

This tool is meant to be able to, in a second phase, share the profile with
the platform. That's why the design carefully separates what's seen
locally from what could be sent:

- **Only derived signals are recorded**: booleans (detected yes/no),
  counts (how many MCP servers, how many skills) and categories. **Never**
  is the *content* of your files, absolute paths, environment variables, or
  credentials read or stored.
- The only file that gets parsed (`.mcp.json`) is opened **only to count
  keys**; no name or value is stored.
- The `anonymous id` is a non-reversible hash of hostname + user, useful
  only for deduplication, not for identifying the person.
- **Explicit opt-in disclosure, once** (ADR-007): the CLI never sends
  anything without you having seen the disclosure and explicitly accepted
  it, once, with an email you typed in yourself. The email is
  self-affirmed and **not verified** in this iteration — treat any
  identity claim it enables as indicative, not proof.
- **There is no data sending in this PoC.** The sharing module
  (`src/share.js`) exists in the code — the disclosure/consent/email flow
  and the resulting automatic, silent resend — but it's **inert** while no
  endpoint is configured (`AI_FOOTPRINT_INGEST_ENDPOINT`): with nowhere to
  send to, `autoShare` always skips.

If you're going to deploy this among third parties (e.g. a platform's
talents), remember that collecting data about how a person works has GDPR
and consent implications: it's worth validating it with a legal/labor
expert before deploying the server and distributing the CLI with sending
turned on (see the legal notice above).

## How to add a new tool

Edit `src/detectors.js` and add an entry with its signals:

```js
{
  id: 'my-tool',
  name: 'My Tool',
  vendor: 'Vendor',
  category: CATEGORIES.AGENTIC_CLI,
  signals: [
    { type: 'projectPath', path: '.mytool' },
    { type: 'bin', name: 'mytool' },
  ],
}
```

If you want to measure depth, add a probe in `src/scanner.js` inside
`probes` that returns **only numbers**.

## Structure

```
bin/report.js            CLI orchestrator
src/detectors.js         Catalog of tools and signals
src/scanner.js           Scan engine (produces the report object)
src/maturity.js          Level and score calculation
src/render-terminal.js   Terminal output
src/render-html.js       Self-contained HTML dashboard
src/store.js             Persistence in the user's home
src/share.js             Consent state, email identity and automatic sending
src/consent-flow.js      Interactive disclosure + consent + email prompt
src/cli-args.js          CLI flag parsing
src/config.js            Ingestion endpoint configuration (env var, no hardcode)
src/locale.js            OS locale detection for report localization
src/i18n.js              Report + consent/disclosure text catalogs (es/en)
reference-server/server.js  Reference (stub) public ingestion server
install.sh               Installer (curl | bash or local)
```
