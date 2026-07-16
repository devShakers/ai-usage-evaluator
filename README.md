# Shakers `sh-eval`

A branded, **local-first** Shakers shell (`sh-eval`) — a small interactive
REPL that is the single entrypoint to two commands:

- **`footprint`** — builds, **locally**, a deterministic profile of your AI
  tool setup: which copilots/agents you have configured, how deep that
  configuration goes, and what "level-up" **tier** (T0-T7) you're at, plus a
  curated roadmap of what unlocks the next tier.
- **`certify`** — certifies Skills from your Shakers catalog by analyzing your
  local project's code.

You run `sh-eval` once; it opens the shell with a Shakers wordmark and a
`sh-eval ›` prompt, and you type `footprint`, `certify`, `help` or `exit`
inside it. The former standalone `ai-footprint`/`ai-certify` binaries are
retired — everything now lives in the one shell (ADR-014).

The footprint mechanism is inspired by `darnoux/claude-code-level-up` (scan
local signals and classify by level), extended to cover the main AI tools on
the market (not just Claude) and to a full 8-tier ladder with per-tier roadmap
content.

## What it does

1. **Scans** the current project (and relevant parts of your home
   directory) for known AI-tool configuration.
2. **Classifies** the setup into a tier, `T0` to `T7` ("empty bench" to
   "orchestrated workshop"), computed deterministically — no LLM involved
   in the level itself.
3. **Shows a "why this tier" analysis**: exactly which criteria you meet,
   with the signal behind each one, and the single next criterion blocking
   progression to the next tier.
4. **Shows a roadmap**: current tier → next tier, with what it unlocks,
   steps, a copyable code snippet, community tips and common mistakes —
   curated, authored content, not generated per run.
5. **Gives you a ready-to-paste implementation prompt** for your own AI
   tool of choice, assembled from the roadmap entry plus your own detected
   stack (frameworks, tools, tier) — this is the primary "how do I do this"
   path.

Everything above runs **always, locally, unconditionally** — nothing is
gated behind a decision. See [Privacy & consent](#privacy--consent-model)
for what happens if you choose to save your report to Shakers.

## Installation

One line:

```bash
curl -fsSL https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/main/install.sh | bash
```

The installer:
- Requires **Node 18+** (checks and fails clearly if missing/too old).
- Discovers the CLI's own `src/*.js` modules dynamically (via a local copy
  or the GitHub API) rather than hardcoding a file list.
- Places the tool in `~/.ai-footprint/` and drops the single `sh-eval`
  command in `~/.local/bin` (the standalone `ai-footprint`/`ai-certify`
  launchers are no longer created, and any legacy ones are removed on
  upgrade). **Zero dependencies** — no `npm install`, no third-party
  packages fetched.
- All installer output is in English, unconditionally (it runs before
  Node/the CLI's own i18n layer is available).

Alternative, cloning the repo first (same result, lets you review the code
before installing):

```bash
git clone https://github.com/devShakers/ai-usage-evaluator
cd ai-usage-evaluator
./install.sh
```

Uninstall: `./install.sh --uninstall`.

## Usage

Run the shell, then type commands at the `sh-eval ›` prompt:

```bash
sh-eval                 # open the Shakers shell (single entrypoint)
sh-eval --lang es|en    # force the shell chrome language instead of OS-locale detect
```

Inside the shell:

```
sh-eval › help          # list the commands
sh-eval › footprint     # scan this project + machine, print the report
sh-eval › certify       # certify Skills from this project's code
sh-eval › clear         # clear the screen
sh-eval › exit          # (or quit / Ctrl-D) leave the shell
```

Each command keeps all its flags, typed inside the shell:

```
sh-eval › footprint --json               # report as JSON on stdout
sh-eval › footprint --root ../other       # scan another directory instead of the current one
sh-eval › footprint --no-save             # write nothing to disk (report only, on screen)
sh-eval › footprint --build-next-level    # secondary path: write deterministic starter file(s) for the next tier
sh-eval › footprint --force               # with --build-next-level, overwrite an existing file
sh-eval › footprint --lang es|en          # force the report language instead of OS-locale detect
sh-eval › footprint --consent-status      # view your save decision / email / last send
sh-eval › footprint --consent-revoke      # revoke consent to save (-> denied), no more sends
sh-eval › footprint --consent-email E     # change the email on file, without touching the decision
```

Without installing, from a copy of the repo, `sh-eval` is equivalent to
`node bin/sh-eval.js`.

Results are saved in `~/.config/ai-footprint/` (a per-project cumulative HTML
report plus its `report-state.json`). **Nothing is ever written to the
scanned project** — the report can't slip into a commit by accident.

## Skill certification (`certify`)

The `certify` command (typed inside the `sh-eval` shell) certifies Skills from
your Shakers catalog by analyzing your local project. V1 ships **phase 1
(resolve)**: it detects your project technologies, asks the Shakers Hub which
map to a Skill you can certify, and shows certifiable vs non-certifiable — no
code leaves your machine in this phase.

```
sh-eval › certify                       # resolve certifiable Skills for the current project
sh-eval › certify --root ../other       # analyze another directory
sh-eval › certify --email you@shakers.com
sh-eval › certify --lang es|en
sh-eval › certify --accept-disclaimer   # accept the legal disclaimer non-interactively
```

Unlike `footprint` (which always produces a local report), `certify` is
inherently server-side: it requires `AI_FOOTPRINT_CERTIFY_ENDPOINT` to be set
(there is no local-only certification). Before **any** data is sent, a legal
disclaimer is shown that you must explicitly accept — it assumes the project is
your own and attributes responsibility to you, so **never run it on a third
party's code** (e.g. a client under NDA). For local end-to-end testing without
the real Hub, point it at the reference server's
`POST /works/ai-footprint/skill-certification` stub (see below). The real
implementation lives in `shakers-hub-backend`.

## The report

- **Terminal output** and a **self-contained HTML dashboard** (Shakers
  branding, responsive, zero network calls — no CDN, no external script, no
  fetch) show the same information.
- **Localized to your OS locale**: a locale starting with `es` shows
  Spanish; anything else shows English (`src/locale.js` / `src/i18n.js`).
  `--lang` overrides this for a single run, including the copyable
  implementation prompt.
- Sections: detected tools, environment, technologies (frameworks/libraries
  detected from dependency manifests), MCP servers (name + category), your
  agent org chart (cards + hierarchy), the tier analysis, and the
  current→next roadmap with its implementation prompt.
- **The HTML report is cumulative and scoped per project.** Each scanned
  project has its OWN report file (`report-<hash>.html` in
  `~/.config/ai-footprint/`), keyed by the project's absolute path, and is
  regenerated whole from `report-state.json` on every run. It fills in over
  time: the footprint section appears once you've run `footprint` in that
  project, and the certification section once you've run `certify` there;
  both appear together when both have run for the **same** project. This is
  intentional (skill-code-certification, reporting redesign) — the report is a
  persistent per-project artifact, not a per-invocation transcript. So running
  `certify` in a project where you previously ran `footprint` correctly
  still shows the footprint section: that footprint was produced for this
  project and is part of its cumulative record, not stale or leaked data.
  Different projects never mix into one document.
- **Score scope (ADR-009): the 0-100 score reflects THIS project's AI setup**
  (signals inside the project directory), so different projects get different
  scores and your global `~/.claude` setup no longer dominates. The **tier
  (T0-T7)** keeps the wider project ∪ home scope — it reflects you as a
  developer, not this one project — so a bare project can show a low score
  under a high tier. That is by design; the report labels the score
  accordingly.

## What it detects

All detection is **deterministic** (no LLM) and reads only known AI-tool
configuration — never your project's business logic or source code:

- **Tools**: Claude Code, Cursor, GitHub Copilot, Windsurf, Aider,
  Continue, Cline, Gemini CLI, Codex CLI, Amazon Q Developer, Cody, Zed,
  Tabnine — existence of config files/directories, binaries on `PATH`,
  installed editor extensions.
- **Depth per tool**: project instructions/rules, MCP servers configured,
  own skills/commands, hooks.
- **MCP servers**: names and a heuristic category (data/comms/dev/browser/
  other) from known config locations (`.mcp.json`, `.cursor/mcp.json`,
  Windsurf/Gemini config, etc.) — only the top-level server-name keys are
  read, never the values (which can carry commands, URLs or env vars).
- **Memory structure**: `@file` import count and nesting depth, section
  count and byte size of context files (`CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md`) — structure only, never the file's actual text is stored.
- **Automations**: npm/shell scripts that invoke a known AI CLI, JSON-piping
  patterns, and scheduled tasks (cron/launchd/pm2/systemd) — counts and
  booleans only.
- **Browser tools**: Playwright/Puppeteer as a project dependency, or a
  browser-category MCP server.
- **Agents**: your `.claude/agents/*.md` org chart (name, wired tools,
  model, hierarchy) — deterministic; an optional server-side LLM step can
  synthesize a short description per agent for nicer cards (see below).
- **Technologies**: frameworks/libraries actually used in the project
  (React, Next.js, Express, Django...), parsed from dependency manifests
  (`package.json`, `requirements.txt`, `go.mod`, etc.) and filtered through
  a curated name map — never a raw dependency dump.
- **Hooks**: hook-based automation configured for a tool.

**Never** read, stored or sent: file *contents* beyond what's needed to
compute a count, absolute paths, environment variables, or credentials.

## Tier ladder (T0-T7)

The tier is "the highest tier whose criteria you ALL meet, checked strictly
bottom-up". The 0-4 band used elsewhere (e.g. Shakers direction views) is
derived from the tier — the tier is the single source of truth.

| Tier | Name | Criterion |
|------|------|-----------|
| T0 | Empty bench | no tool detected |
| T1 | First tool | at least one tool detected |
| T2 | Bench with notes | T1 + project instructions/rules/config exist |
| T3 | Connected bench | T2 + at least one MCP server configured |
| T4 | Own tooling | T3 + own skills/commands/rules |
| T5 | Agentic operator | agentic CLI + MCP + own tooling together |
| T6 | Multi-agent | T5 + 2 or more agents defined |
| T7 | Orchestrated workshop | T6 + at least one hook configured |

File recency (`mtime`) is informative only — it is never a gating signal
for any tier.

## Optional server-side LLM layers

Two capabilities are ephemeral, optional, server-side LLM calls — both run
independently of the save/consent decision (they never touch the
persistence payload) and both degrade to a fully deterministic fallback if
no endpoint is configured or the call fails for any reason:

- **Agent-card synthesis** (`AI_FOOTPRINT_SYNTHESIS_ENDPOINT`): sends your
  agents' description text to synthesize a short symbolic name + "what it
  does" per agent, for nicer cards. Falls back to the deterministic org
  chart if unavailable — and, per agent, to your own raw `.claude/agents/`
  description (cleaned up and excerpted for card display) or a minimal
  name-derived line if that's missing too, so a card's description is
  never blank.
- **Roadmap personalization** (`AI_FOOTPRINT_ROADMAP_ENDPOINT`): asks the
  hub to rewrite the current tier jump's prose (what it unlocks, steps,
  tips, mistakes) adapted to your detected stack. The tier, the band, and
  the "when to upgrade" criterion are **never** touched by this call — only
  the curated roadmap's fallback prose can ever change. Only derived
  signals are sent (frameworks, tool/MCP categories, tier), never raw file
  content or agent descriptions.

Both send only derived signals — never raw file content — and a scrub pass
runs before anything leaves the machine.

## Privacy & consent model

- **The report is always generated and shown locally, unconditionally.**
  There is no gate, no wall, no preview step before you see your own data.
- **Saving (persisting) it to Shakers is opt-in, asked once.** The first
  time you run the tool, right **after** the report is already on screen,
  you're asked a short yes/no question: do you want this report saved in
  Shakers? Accepting asks for an email; declining persists that choice and
  you're never asked again. Manage the decision any time with
  `--consent-status` / `--consent-revoke` / `--consent-email`, without
  re-running the scan.
- **Only derived signals are ever sent for saving** — booleans, counts,
  categories, tier/band, the detected technology names, and (if it ran) the
  synthesized agent summaries. **Never** file contents, absolute paths,
  environment variables, or credentials. The email you typed travels
  outside this whitelisted payload, in the request body.
- **The two optional LLM layers above are a separate, ephemeral flow**:
  they run on every scan (independent of your save decision) so the diagram
  and the roadmap can "always show", and they only ever see derived
  signals or agent description text, never your save decision or your
  email.
- The consent decision lives in `~/.config/ai-footprint/consent.json`
  (permissions `600`).
- **Legal**: sending data about how a person works involves personal-data
  processing (GDPR). This model has legal/labor sign-off reported for the
  current design (see `active-work/talents-ai-score/decisions.md`,
  ADR-011/013). **Activating sending against real Shakers talents in
  production is a separate deployment decision that still requires its own
  legal/labor go-ahead** for that rollout — this repo doesn't ship a
  production endpoint by default (see below).
- **⚠️ Legal copy is NOT FINAL (pending validation).** The consent copy
  (`footprint`, ADR-003), the code-egress disclaimer (`certify`,
  ADR-001) and the installer notice all now state that **you are solely
  responsible for owning/being authorized to analyze the code you submit,
  that Shakers assumes no liability for it, and that misuse may lead to
  penalties on your Shakers account (up to suspension)**. This wording — and
  especially the account-penalty clause, whose enforceability depends on the
  Shakers Terms of Service — **must be reviewed and approved by a legal/labor
  expert before production**. Treat the current text as a placeholder, not a
  final legal position.

## Configuration (environment variables)

None of these have a compiled-in default — the public repo carries no
endpoint or secret. Unset means "nothing to call", and every code path that
depends on one degrades gracefully (no send / deterministic fallback), it
never breaks the local report.

| Variable | Purpose |
|---|---|
| `AI_FOOTPRINT_INGEST_ENDPOINT` | Where a saved report is sent, if consent is granted. |
| `AI_FOOTPRINT_SYNTHESIS_ENDPOINT` | Agent-card synthesis endpoint (optional). |
| `AI_FOOTPRINT_ROADMAP_ENDPOINT` | Roadmap personalization endpoint (optional). |
| `AI_FOOTPRINT_CERTIFY_ENDPOINT` | Skill-certification endpoint for the `certify` command. Unlike the others, this one does **not** degrade silently: `certify` has no local-only product (the Skill catalog and analysis live on the Hub), so an unset value is an actionable error, not a no-op. |
| `AI_FOOTPRINT_CONFIG_DIR` | Override `~/.config/ai-footprint/` (mainly for tests). |

## Reference server (not deployed)

`reference-server/server.js` is a dependency-free **stub** that illustrates
the current ingestion contract: a public endpoint, no per-identity auth,
rate-limited by email and by IP. It exists as contract documentation and
for local testing — **it is not run nor deployed anywhere**. The real
implementation of this contract lives in `shakers-hub-backend`.

```bash
node reference-server/server.js
```

Routes: `GET /health`, `POST /reports` (`{email, payload}`),
`POST /works/ai-footprint/agent-synthesis` (deterministic placeholder, not
a real LLM), `POST /works/ai-footprint/skill-certification` (deterministic
placeholder for the `certify` resolve/certify contract, not a real LLM),
`GET /admin/reports` (`X-Admin-Key`, audit).

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
bin/sh-eval.js                   Branded REPL — the single entrypoint (ADR-014)
src/repl-shell.js                REPL loop, banner, prompt, command dispatch
src/repl-stdin.js                Shared stdin reader (nested-stdin seam for the REPL)
bin/report.js                    `footprint` command logic (run(args,{ask}))
bin/certify.js                   `certify` command logic (run(args,{ask}))
src/detectors.js                 Catalog of tools and signals
src/scanner.js                   Scan engine -> report object
src/maturity.js                  0-4 band (derived from the tier)
src/tier-engine.js               T0-T7 ladder computation
src/tier-analysis.js             "Why this tier" deterministic breakdown
src/roadmap-content.js           Curated per-tier roadmap content (es/en)
src/roadmap-prompt.js            Ready-to-paste implementation prompt
src/roadmap-personalization.js   Optional LLM roadmap-prose personalization client
src/build-next-level.js          Secondary: writes deterministic starter files
src/agent-org-chart.js           Deterministic agent org chart parser
src/agent-synthesis.js           Optional LLM agent-card synthesis client
src/mcp-detector.js              MCP server name/category detector
src/memory-structure-detector.js Context-file import/structure detector
src/automations-detector.js      Scripts/scheduler automation detector
src/browser-tools-detector.js    Browser-automation tooling detector
src/tech-detector.js             Project technologies (frameworks) detector
src/render-terminal.js           Terminal output
src/render-html.js               Self-contained HTML dashboard
src/store.js                     Persistence in the user's home
src/share.js                     Consent state + derived-payload whitelist + sending
src/consent-flow.js              Short, one-time "save to Shakers?" prompt
src/config.js                    Endpoint configuration from env vars, never hardcoded
src/locale.js                    OS locale detection
src/i18n.js                      Report text catalogs (es/en)
reference-server/server.js       Reference (stub) ingestion server, not deployed
install.sh                       Installer (curl | bash, or local)
```
