# Supported platforms & demo prerequisites

Demo-hardening reference for `sh-eval` (the `ai-usage-evaluator` CLI).

## Prerequisites (checked automatically)

- **Node.js ≥ 18** (`package.json` engines; zero runtime dependencies — pure Node stdlib).
  - `install.sh` checks Node presence + major version and aborts with a clear message if missing/too old.
  - The installed `sh-eval` launcher **re-checks at runtime** (a copied/relocated install, or Node later removed/downgraded, gets a clear "Node 18+ required / not found — install from https://nodejs.org" message, never a bare `command not found` or a modern-syntax `SyntaxError`).
  - `bin/sh-eval.js` also self-guards (ES5-safe) for a direct `node bin/sh-eval.js`.
- **`~/.local/bin` on PATH** — `install.sh` detects if it isn't and either appends the export to your shell rc or prints the exact line to add (otherwise `sh-eval` would be a "command not found" after a "successful" install).
- **`curl`** — only for the remote `curl | bash` install; not needed for a local `./install.sh`.

All install/runtime paths use `os.homedir()` + `path.join` (`~/.ai-footprint`, `~/.config/ai-footprint`, `~/.local/bin`, `~/.claude/…`) — no hardcoded `/`-separator assumptions.

## Opening the report in a browser

Portable + never crashes: `open` (macOS), `start` (Windows), `xdg-open` (Linux), spawned detached with stdio ignored. On a headless box or when no opener exists it degrades **silently** — the command still prints the clickable `file://` link, so a missing opener never breaks the run.

## Default endpoint (what must be up for a demo)

A fresh install writes this into `~/.config/ai-footprint/config.json` (never overwriting an existing one):

```
http://localhost:3001/api/v1/works/ai-footprint/reports
```

Everything remote derives from that single ingest endpoint (siblings): `footprint` send, `certify`/resolve, and `map`'s `graph-inference`. **For a demo the backend must be reachable at `http://localhost:3001`** (the shakers-hub-backend container). Override per-run with `AI_FOOTPRINT_INGEST_ENDPOINT`, or persist with `footprint --set-endpoint <url>`. There is **no compiled-in production default** (ADR-002/ADR-007) — the value lives only in config/env.

### Unreachable / mis-set endpoint behaviour (all actionable, no raw 500/stacktrace)

| Flow | Behaviour when the endpoint is down/unset |
|---|---|
| `map` (graph-inference) | Loud degrade: `⚠ AI analysis FAILED (endpoint unreachable / rate-limited / provider error)` on stderr + an in-report banner; renders the reduced deterministic agent subgraph. Retries once on a transient 5xx. |
| `certify` / resolve | Discriminated, localized message per cause: `no-endpoint`, `network-error`, `timeout`, `http-<status>` (e.g. backend-unavailable vs "too large"), never a raw error. Exits 1, sends nothing. |
| `footprint` send | Silent no-op when unset (the local footprint report still renders); never breaks the run. |

## OS support matrix

| OS | Install | Run | Status |
|---|---|---|---|
| **macOS** (zsh/bash) | `./install.sh` (bash) | `sh-eval` | **Verified live** on macOS (darwin, Node 22, Apple Silicon): fresh install, PATH wiring, `footprint`/`map`/`report` happy path, and the Node-missing / Node-too-old / endpoint-down failure messages. Browser open uses `open`. |
| **Linux** (bash) | `./install.sh` (bash) | `sh-eval` | **Reasoned, not live-tested** (no Linux VM available on this macOS box). Expected to work: bash installer, `os.homedir()` paths, `xdg-open` browser open, same Node/PATH preflight. `~/.local/bin` PATH wiring handled. Residual: `xdg-open` absent on headless → report opens no window but prints the link (by design). |
| **WSL** (Ubuntu under Windows) | `./install.sh` (bash) | `sh-eval` | **Reasoned** — treated as Linux; expected to work. `xdg-open` may not reach the Windows browser without extra setup → the printed `file://` link is the fallback. |
| **Windows native** (cmd/PowerShell) | **Not supported** | — | `install.sh` is bash → needs **WSL or Git-Bash**, not native cmd/PowerShell. The Node code itself is portable (browser open has a `start` branch), but the installer is not. Documented as unsupported rather than pretending. |

## Residual demo risks

1. **The default endpoint is `localhost:3001`** — if the demo machine isn't running the backend container, all remote features fail (loudly/actionably, but they fail). Presenter must start the backend or `--set-endpoint`/`AI_FOOTPRINT_INGEST_ENDPOINT` to a reachable one **before** the demo.
2. **`graph-inference` rate limit is 8/h per IP** — repeated `map` runs during rehearsal can 429 (shows the loud degrade); it resets hourly.
3. **Linux/WSL not live-tested** on this machine — logic is portable but unverified end-to-end; validate on the actual demo OS if it isn't macOS.
