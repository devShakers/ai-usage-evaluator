# Supported platforms & demo prerequisites

Demo-hardening reference for `shakers` (the `ai-usage-evaluator` CLI).

## Prerequisites (checked automatically)

- **Node.js ≥ 18** (`package.json` engines; zero runtime dependencies — pure Node stdlib).
  - `install.sh` checks Node presence + major version and aborts with a clear message if missing/too old.
  - The installed `shakers` launcher **re-checks at runtime** (a copied/relocated install, or Node later removed/downgraded, gets a clear "Node 18+ required / not found — install from https://nodejs.org" message, never a bare `command not found` or a modern-syntax `SyntaxError`).
  - `bin/shakers.js` also self-guards (ES5-safe) for a direct `node bin/shakers.js`.
- **`~/.local/bin` on PATH** — `install.sh` detects if it isn't and either appends the export to your shell rc or prints the exact line to add (otherwise `shakers` would be a "command not found" after a "successful" install).
- **`curl`** — only for the remote `curl | bash` install; not needed for a local `./install.sh`.

All install/runtime paths use `os.homedir()` + `path.join` (`~/.shakers`, `~/.config/shakers`, `~/.local/bin`, `~/.claude/…`) — no hardcoded `/`-separator assumptions.

## Opening the report in a browser

Portable + never crashes: `open` (macOS), `start` (Windows), `xdg-open` (Linux), spawned detached with stdio ignored. On a headless box or when no opener exists it degrades **silently** — the command still prints the clickable `file://` link, so a missing opener never breaks the run.

## Default endpoints (what must be up for a demo)

talents-ai-score / ADR-020/021: the CLI now talks to a CHAIN of TWO backends. A
fresh install writes BOTH into `~/.config/shakers/config.json` (never
overwriting an existing one):

```
ingestEndpoint          http://localhost:3004/api/v1/usage/reports            (PRIMARY — sh-web-works-certifications)
ingestEndpointFallback  http://localhost:3001/api/v1/works/usage/reports      (FALLBACK — shakers-hub-backend)
```

**These are pre-deployment placeholders** (`install.sh`'s own comment says so
explicitly) — loopback is only acceptable because nothing is deployed yet;
they must change to real URLs before this repo's `main` is what Talents
actually install.

Everything remote derives from these two ingest endpoints (siblings, one set
per hop): `usage` send, `certify`/resolve, and `map`'s `graph-inference`.
**For a demo, at minimum the PRIMARY must be reachable at `http://localhost:3004`**
(the sh-web-works-certifications container) — a request falls back to
`http://localhost:3001` (shakers-hub-backend) only on a transport-class
failure (no-endpoint, network error, timeout, 5xx, 404, or the certify
block's expected transitional 501 — see src/backend-chain.js), never on a
4xx business rejection. Override per-run with `SHAKERS_CLI_INGEST_ENDPOINT` /
`SHAKERS_CLI_INGEST_ENDPOINT_FALLBACK`, or persist with
`usage --set-endpoint <url>` / `--set-endpoint-fallback <url>`. There is
**no compiled-in production default in the CODE** (ADR-002/ADR-007) — only
`install.sh` bakes the loopback placeholders above into a fresh config file.

### Unreachable / mis-set endpoint behaviour (all actionable, no raw 500/stacktrace)

| Flow | Behaviour when the endpoint is down/unset |
|---|---|
| `map` (graph-inference) | Loud degrade: `⚠ AI analysis FAILED (endpoint unreachable / rate-limited / provider error)` on stderr + an in-report banner; renders the reduced deterministic agent subgraph. Retries once on a transient 5xx. |
| `certify` / resolve | Discriminated, localized message per cause: `no-endpoint`, `network-error`, `timeout`, `http-<status>` (e.g. backend-unavailable vs "too large"), never a raw error. Exits 1, sends nothing. |
| `usage` send | Silent no-op when unset (the local usage report still renders); never breaks the run. |

## OS support matrix

| OS | Install | Run | Status |
|---|---|---|---|
| **macOS** (zsh/bash) | `./install.sh` (bash) | `shakers` | **Verified live** on macOS (darwin, Node 22, Apple Silicon): fresh install, PATH wiring, `usage`/`map`/`report` happy path, and the Node-missing / Node-too-old / endpoint-down failure messages. Browser open uses `open`. |
| **Linux** (bash) | `./install.sh` (bash) | `shakers` | **Reasoned, not live-tested** (no Linux VM available on this macOS box). Expected to work: bash installer, `os.homedir()` paths, `xdg-open` browser open, same Node/PATH preflight. `~/.local/bin` PATH wiring handled. Residual: `xdg-open` absent on headless → report opens no window but prints the link (by design). |
| **WSL** (Ubuntu under Windows) | `./install.sh` (bash) | `shakers` | **Reasoned** — treated as Linux; expected to work. `xdg-open` may not reach the Windows browser without extra setup → the printed `file://` link is the fallback. |
| **Windows native** (cmd/PowerShell) | **Not supported** | — | `install.sh` is bash → needs **WSL or Git-Bash**, not native cmd/PowerShell. The Node code itself is portable (browser open has a `start` branch), but the installer is not. Documented as unsupported rather than pretending. |

## Residual demo risks

1. **The default PRIMARY is `localhost:3004`, FALLBACK is `localhost:3001`** — if NEITHER demo machine is running the corresponding backend container, all remote features fail (loudly/actionably, but they fail); if only one is up, the chain still works but every call pays the primary's timeout before falling back. Presenter must start at least the primary, or point `--set-endpoint`/`SHAKERS_CLI_INGEST_ENDPOINT` (and optionally the fallback pair) at a reachable one **before** the demo.
2. **`graph-inference` rate limit is 8/h per IP** — repeated `map` runs during rehearsal can 429 (shows the loud degrade); it resets hourly.
3. **Linux/WSL not live-tested** on this machine — logic is portable but unverified end-to-end; validate on the actual demo OS if it isn't macOS.
