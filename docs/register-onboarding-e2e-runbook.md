# register / onboarding — e2e runbook (local)

Two distinct flows (ADR-025), coherent in CLI and MCP:

- **`register`** — full registration: auth -> profile import -> individual/company + pricing -> AI-usage consent -> onboarding interview (last step skippable). Self-manages login.
- **`onboarding`** — the onboarding interview only. Requires an existing session. The server resolves the branch (with/without the AI-usage block) by prior usage evidence.

## 1. Configuration

**Local: export nothing.** On first run the talent CLI/MCP seeds `~/.config/shakers/config.json`
with localhost dev bases, so everything resolves against two local services:

- **certs** `http://localhost:3004/api/v1` — `login`, `ai_usage` (usage/reports) and the interviews.
- **hub** `http://localhost:3001/api/v1` — import-profile, professional-details, pricing-rate, complete-onboarding.
- profile URL (interview-skip link): `http://localhost:3000/talent/profile`.

Inspect / change what is resolved:

```bash
shakers config list
shakers config set hubBase   http://localhost:3001/api/v1
shakers config set certsBase http://localhost:3004/api/v1
shakers config set profileUrl http://localhost:3000/talent/profile
```

Deleting `~/.config/shakers/config.json` (a full reset) is safe: the next run re-seeds the defaults.

### MCP (Claude Desktop) — local

**No `env` block needed in the Claude Desktop config in local.** On startup the MCP server
(`bin/mcp.js`) seeds `~/.config/shakers/config.json` with the localhost dev bases unconditionally
(the MCP is a talent surface), so a FRESH install — no `config.json`, no `env` block — already
resolves `hubBase=http://localhost:3001/api/v1`, `certsBase=http://localhost:3004/api/v1`,
`profileUrl`, and ingest. A minimal client entry is enough:

```json
{ "mcpServers": { "shakers": { "command": "shakers", "args": ["mcp"] } } }
```

In **production** the default localhost bases change to the real hosts (a one-point change in
`src/config.js` when the domains exist, ADR-021) or are injected via the MCP server's `env` block
(`SHAKERS_CLI_HUB_BASE` / `SHAKERS_CLI_CERTS_BASE` / `SHAKERS_CLI_PROFILE_URL`), same precedence as below.

**Deployment: inject config via the environment** (or the MCP server's `env` block), never hardcoded.
Precedence is **env > config.json > local default**:

```bash
export SHAKERS_CLI_CERTS_BASE="https://certs.example.com/api/v1"   # or SHAKERS_CLI_INGEST_ENDPOINT
export SHAKERS_CLI_HUB_BASE="https://hub.example.com/api/v1"
export SHAKERS_CLI_PROFILE_URL="https://app.example.com/talent/profile"
```

If a single gateway replaces the two hosts, point both bases at it.

### Secrets (separate — never in config.json, never in this runbook, never baked)

No secret is read from an env var. The talent's auth tokens come from `shakers login` (stored 0600
in `~/.config/shakers/auth-session.json`); in an MCP deployment the talent JWT is passed per call
(Authorization), supplied by the MCP client's `env`/secret store. `shakers config` refuses any key
outside the non-sensitive base/URL allowlist, so a token can never be persisted there.

## 2. Install the CLI from this branch

```bash
SHAKERS_PROFILE=talent bash ./install.sh   # installs `shakers` into ~/.local/bin
shakers register --help
shakers onboarding --help
```

Install with `SHAKERS_PROFILE=talent` so the local bases (including `hubBase`) auto-seed for the
talent flows. The default profile (`external`) is usage-only and does not seed `hubBase`; if you
already installed that way, run `shakers config set profile talent` then any `shakers` command once,
or set the bases explicitly with `shakers config set`.

## 3. Run

```bash
shakers register           # CREATES the account (sign-up) + full onboarding
# for an EXISTING account:
shakers login              # e.g. talent-seed-1@shakers.test / TalentSeed123
shakers onboarding         # interview only (requires a session)
```

`register` **creates the account** (sign-up, email+password, no OTP): use a **NEW email** each run. An
existing email (e.g. `talent-seed-1`) returns `account-already-exists`, and the CLI falls back to
`login`. After a successful sign-up the CLI performs the certs `login/email` behind the scenes with the
same credentials, so the session carries BOTH the certs token (interviews/usage) and the hub token
(hub-direct onboarding steps). `login`/`onboarding` remain for an already-created account.

### What to expect in `register`

1. **Sign-up (creates the account)** — asks name, last name, email (NEW), password (≥8 chars and the hub
   policy), newsletter y/n, and `freelanceType` (FREELANCE/EMPLOYEE/AGENCY/POTENTIAL_FREELANCE; intent
   required for EMPLOYEE/POTENTIAL_FREELANCE). Creates the account (`registration_level=REGISTERED`,
   `onboarding_status=PENDING`) and establishes the session. An existing email falls back to `login`.
2. **Profile import** — asks LinkedIn (required) + optional CV path / GitHub / website, then kicks it off.
   TRAP: the async wrapper (issue 011, hub-backend) is not built yet, so the import is **synchronous (~2 min)** —
   the call blocks until the import returns.
3. **Pricing** — **per-project** price (full-time and/or part-time; amount is a whole price, currency
   USD/EUR/GBP). No hourly/annual rate. (Individual/company is captured at sign-up, step 1.)
4. **AI-usage consent** (skippable) — shows two disclaimers separately (info accessed / goal+duration),
   then runs `ai_usage`. Skipped automatically if prior usage evidence exists.
5. **Interview** (skippable) — two disclaimers, then the interview loop. Skipping shows the profile URL.
   At the end (either path) `register` calls `complete-onboarding`, moving `onboarding_status`->COMPLETED
   and `registration_level`->ONBOARDING_COMPLETED.

Non-interactive runs need `--accept-disclaimer` (disclaimers are a hard rule, ADR-011).

## 4. Auth note (to confirm)

Hub-direct endpoints are called with `Authorization: Bearer <hub JWT>` (the talent's `hubAccessToken`
from login), not the certs relay convention. If the local hub expects a different scheme for these
talent-facing routes, adjust `hubHeaders` in `src/onboarding-client.js`.
