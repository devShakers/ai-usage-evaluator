# AI Footprint

> **Status: proof of concept (PoC) — distribution only.** This repository
> publishes only the CLI (PoC). The local report
> works 100%. Enrollment (`--enroll`) and automatic sending are
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

## Sharing the report with the platform — NOT AVAILABLE IN THIS POC YET

> **Inert in this PoC.** The enrollment and sending mechanism exists in the
> code and is documented below because it describes the full design, but
> **there is no Shakers server deployed to production yet**. The enrollment
> code (`--enroll=...`) is issued from a Shakers panel that **is not
> running**, so there is no way to get a real one today. Without enrolling,
> the tool sends nothing — there is no endpoint to connect to. **We don't
> promise working delivery at this stage**, only the local report (which
> does work 100%).

Design (for when the server exists): sending is **automatic** after
enrolling, with no preview or per-run confirmation. It's controlled by a
consent flag persisted in the local credential itself, **ON by default** —
it can be turned off at any time without re-enrolling (see `--consent`
below). The public repo **contains no endpoint or secret**: the destination
URL arrives inside the credential obtained when enrolling.

Expected talent flow (once the server is deployed):

```bash
# 1) Enroll (the personal code would come from your Shakers panel)
ai-footprint --enroll=YOUR_PANEL_CODE

# 2) From here on, every normal run sends the report automatically
#    (max. once per hour), with no preview or confirmation
ai-footprint

# 3) To turn off automatic sending at any time (or turn it back on)
ai-footprint --consent=off
ai-footprint --consent=on
```

What would be sent: only derived data (level, score, tools detected
yes/no, and per-tool counts). Never file contents, paths or credentials.
Sending failures (network, rejected credential, submission limit) never
break the local report. The credential would be stored at
`~/.config/ai-footprint/credentials.json` (permissions 600), along with the
consent flag and the timestamp of the last submission.

## Reference server (NOT deployed in this PoC)

> Out of scope for this PoC (ADR-002, `active-work/talents-ai-score`): the
> `reference-server/` code lives in the repo as contract documentation and
> for review, but **it is not run nor deployed**. There is no instance
> running at Shakers that this CLI connects to.

`reference-server/server.js` is a **dependency-free stub** that illustrates
the contract: it exchanges a single-use enrollment code for a revocable
token, and ingests reports validating the token, attributing them to the
talent, and applying rate limiting. It's an in-memory example; your team
reimplements it on real infrastructure (DB, hashed tokens, TLS at the
gateway).

```bash
node reference-server/server.js
# prints a demo code and an --enroll string ready to test the client
```

Routes: `GET /health`, `POST /enroll {code}`, `POST /reports` (with
`Bearer`). Access control: a stranger who clones the repo gets a scanner
that shows them their local report but has no valid credential, so their
submission is rejected with 401. Only the talents you enroll can send
reports.

### Token control (administration)

Tokens are stored **hashed** (never in plaintext) and have a full
lifecycle. Admin routes require the `X-Admin-Key` header:

```bash
# Issue an enrollment code for a talent (returns the command to show on their panel)
curl -X POST http://localhost:8787/admin/enroll-codes \
  -H "X-Admin-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"talentId":"talent_123"}'

# Audit: lists all tokens with talent, issuance, last use, expiry and status
curl http://localhost:8787/admin/tokens -H "X-Admin-Key: YOUR_KEY"

# Revoke a token by its public id (cuts off access; the next submission gets 401)
curl -X POST http://localhost:8787/admin/revoke \
  -H "X-Admin-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"id":"tok_abc123..."}'
```

How you control each phase:

- **Issuance**: without a code issued by you (tied to a `talentId`) there is
  no token.
- **Expiry**: every token is born with an expiration (TTL); once it expires,
  the talent re-enrolls.
- **Revocation**: `/admin/revoke` cuts off access instantly.
- **Storage**: only the token hash is stored; the secret is handed out once
  at enrollment time and kept by the talent.
- **Audit**: `/admin/tokens` shows who owns each token, when it was last
  used, and whether it's still active.

In production, this admin surface lives behind your real internal auth and
on top of a database, not the stub's in-memory stores.

> Notice: sending data about how a person works involves processing personal
> data (GDPR, consent). Validate it with a legal/labor expert before
> enabling sending in production.

## Usage (quick reference)

```bash
ai-footprint                  # report in the terminal
ai-footprint --html           # also generates and opens the visual dashboard
ai-footprint --json           # report as JSON on stdout
ai-footprint --root ../other  # scans another directory
ai-footprint --no-save        # writes nothing to disk
ai-footprint --enroll=CODE    # enrolls this machine
ai-footprint --consent=on     # turns on automatic sending (already on by default)
ai-footprint --consent=off    # turns off automatic sending
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
- **There is no data sending in this PoC.** The sharing module
  (`src/share.js`) exists in the code — automatic sending after enrolling,
  with no preview or confirmation, with a consent flag persisted in the
  local credential (on by default, can be turned off with
  `--consent=off`) — but it's **inert** while no server is deployed: with
  no credential, there's no one to send to.

If you're going to deploy this among third parties (e.g. a platform's
talents), remember that collecting data about how a person works has GDPR
and consent implications: it's worth validating it with a legal/labor
expert before deploying the server and distributing the CLI with sending
turned on.

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
src/share.js             Enrollment, consent flag (ON by default) and automatic sending
src/locale.js            OS locale detection for report localization
src/i18n.js              Report text catalogs (es/en)
reference-server/server.js  Reference (stub) enrollment and ingestion server
install.sh               Installer (curl | bash or local)
```
