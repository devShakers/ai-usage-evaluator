# Shakers `shakers`

A **local-first** Shakers CLI (`shakers`) — a plain argument dispatcher:
`shakers <command> [flags]` runs one command and exits; run `shakers` with no
command to print the usage help. There is no interactive shell (the former
REPL was retired — ADR-060). Its commands:

- **`ai-usage`** — builds, **locally**, a deterministic profile of your AI
  tool setup: which copilots/agents you have configured, how deep that
  configuration goes, and what "level-up" **tier** (T0-T7) you're at. Its
  terminal output leads with **why** you're at that tier, then the score, your
  tools, technologies and a **one-line-per-agent** summary (each agent scored
  for how well it's built + how often you've actually used it). The tier
  roadmap / next-steps is available behind `--roadmap`.
- **`certify`** — certifies Skills from your Shakers catalog by analyzing your
  local project's code (resolve which Skills apply, then sample and send
  secret-scrubbed code for a per-Skill assessment), and certifies how deeply
  you command your own agents (`certify agents`) through an interview. Both
  require you to be [logged in](#login-login--logout) first.
- **`report`** — builds and **opens** the full, shareable HTML report for the
  current project (usage + certified Skills, with the complete per-agent
  detail). `ai-usage`/`certify` persist their result silently; `report` is how
  you produce and open the HTML to share with your team.
- **`share`** — *(temporarily disabled)* turns the project's latest `ai-usage`
  result (tier + score) into a branded card you can post on LinkedIn (built
  offline; the PNG is exported in your browser). Invoking it prints a disabled
  notice and runs nothing.
- **`login` / `logout`** — identify yourself as a registered Talent (email
  or Google). See [Login](#login-login--logout).
- **`add-role` / `change-role`** — manage your roles: add a growth role from the
  catalog, or switch your MAIN role to one you already hold (arrow-key pickers).
  The onboarding interview also ends with the same MAIN-role step. See
  [Command families](#command-families) for the `role`/`profile`/`add` groupings.
- **`superadmin`** — a non-production, password-gated test tool for the team
  running this CLI against the service; not something a Talent uses. See
  [Superadmin](#superadmin-non-production-only).

**Session gating (ADR-061).** `ai-usage` is the only command a non-registered
(session-less) caller can run — the anonymous AI-usage evaluation, with its
consent → email → persistence flow. Every other command requires an active
session: exempt are `ai-usage` and `login`; `logout` without a session is a
silent no-op; `certify`/`report`/`share` require `shakers login` first
(`superadmin` is its own non-prod escape hatch, exempt too). A session-less
call to a gated command prints a clear error naming what is missing and both
`shakers login` and `shakers register`; in non-TTY/agent mode it exits with a
non-zero code. `ai-usage` is public: when no session exists it only reminds the
Talent they can sign in (a Yes/No prompt on a TTY), never blocks. The former
standalone `ai-footprint`/`ai-certify` binaries were retired earlier; the
interactive shell that replaced them is now retired too (see
[`docs/decisions.md`](docs/decisions.md): ADR-060 REPL→argv, ADR-061 gating).

The AI usage mechanism is inspired by `darnoux/claude-code-level-up` (scan
local signals and classify by level), extended to cover the main AI tools on
the market (not just Claude) and to a full 8-tier ladder with per-tier roadmap
content.

## What it does

1. **Scans** the current project (and relevant parts of your home
   directory) for known AI-tool configuration.
2. **Classifies** the setup into a tier, `T0` to `T7` ("empty bench" to
   "orchestrated workshop"), computed deterministically — no LLM involved
   in the level itself.
3. **Leads with a "why this tier" analysis**: exactly which criteria you meet,
   with the signal behind each one, and the single next criterion blocking
   progression to the next tier — shown FIRST, before the score.
4. **Evaluates your agents**: one line per agent (nested subagents drawn with
   stacked `↓`), each with a **definition-quality score** (0-100, how well the
   agent is built) and a **usage signal** (how often you've actually invoked it,
   read from your local Claude Code history — usage only, never session
   content). Full per-agent detail (rationale included) lives in the `report`
   HTML.
5. **Roadmap behind `--roadmap`**: current tier → next tier, with what it
   unlocks, steps, a copyable code snippet, community tips and common mistakes,
   plus a ready-to-paste implementation prompt — curated, authored content, not
   generated per run. Hidden from the default output to keep the terminal clean;
   pass `--roadmap` (alias `--next`) to see it.

Everything above runs **always, locally, unconditionally** — nothing is
gated behind a decision. See [Privacy & consent](#privacy--consent-model)
for what happens if you choose to save your report to Shakers.

### Agent evaluation (the LLM feature)

The definition-quality score is the one AI-model-backed part of `ai-usage`. As
with the org-chart synthesis and roadmap personalization, the CLI never calls a
model directly: it POSTs the scrubbed agent definitions to the certifications
service's `agent-evaluation` endpoint (a sibling of your configured ingest
endpoint) that runs the model server-side (**gemini-2.5-flash**) and returns a
score + short rationale per agent. It degrades gracefully: no endpoint, a network error, or a
timeout simply means no scores are shown — the rest of the report is unaffected.
The **usage** signal is entirely local (no network, no model). See
[Privacy & consent](#privacy--consent-model).

## Installation

One line:

```bash
curl -fsSL https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/release/install.sh | bash
```

The installer:

- Requires **Node 18+** (checks and fails clearly if missing/too old).
- Discovers the CLI's own `src/*.js` modules dynamically (via a local copy
  or the GitHub API) rather than hardcoding a file list.
- Places the tool in `~/.shakers/` and drops the single `shakers`
  command in `~/.local/bin` (the standalone `ai-footprint`/`ai-certify`
  launchers are no longer created, and any legacy ones are removed on
  upgrade). The only third-party package is **`@livekit/rtc-node`** (the
  LiveKit interview engine), fetched post-install for every flavor;
  `SHAKERS_SKIP_NATIVE_INSTALL=1` skips that fetch (offline installs / CI).
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

## Publishing (maintainers)

One codebase ships in three flavors; the baked backend target is derived from
the package **name** (`src/config.js#PACKAGE_NAME_ENV`), overridable per run
with `SHAKERS_CLI_ENV=staging|dev|local`. Per-endpoint `SHAKERS_CLI_*_BASE`
env vars and `config.json` always win over the baked default.

| Flavor | Package name | Registry | Baked target | Publish |
|---|---|---|---|---|
| Private (current) | `@shakers/shakers-cli` | GitLab proj 201 (`publishConfig`) | dev (new-works) | `export SHAKERS_GITLAB_TOKEN=<PAT, scope write_registry on proj 201>` then `npm publish` |
| Public beta | `shakers-cli-beta` | npmjs (public) | staging | bump `BETA.version` in `scripts/prepare-beta.js`, then `npm run publish:beta` |
| Local | (checkout, `@shakers/shakers-cli`) | — | dev, or `SHAKERS_CLI_ENV=local` for localhost | run from the clone; no publish |

Both publishes bump `version` first (the registry rejects re-publishing an
existing version). The private one publishes from a checked-out `release` with the
committed `@shakers/shakers-cli` manifest, unchanged. For the beta, bump
`BETA.version` in `scripts/prepare-beta.js` (manual, one line), then run the
single command `npm run publish:beta`: it stamps `name`/`version`/`publishConfig`,
runs `npm publish --tag latest`, and restores the private manifest with git. The
tag is explicit because npm refuses to publish a prerelease (`0.8.0-beta.N`) to
`latest` without one; `--tag latest` still moves `latest` to the new version, so
testers install `shakers-cli-beta` bare (which resolves `latest`) with no manual
`npm dist-tag add` step. The npmjs account for `shakers-cli-beta` must
exist and you must be `npm login`ed (or set `NODE_AUTH_TOKEN`) first — nothing
here publishes automatically.

`@livekit/rtc-node` is a real `dependencies` entry, so `npm i` / `npm i -g` of
either package pulls it automatically (GitLab's packument keeps `dependencies`
but strips `optionalDependencies`, which is why it must not be optional).

## Usage

`shakers <command> [flags]` runs one command and exits. With no command it
prints the usage help:

```bash
shakers                 # print the usage help and exit
shakers --lang es|en    # force the CLI copy language instead of OS-locale detect
```

The commands (only `ai-usage` and `login` run without a session — see
[Session gating](#shakers-shakers)):

```bash
shakers ai-usage      # scan this project + machine, print the report (no HTML link) — anonymous
shakers certify       # certify a DIMENSION of your role over a LiveKit interview (needs login)
shakers report        # build + open the full shareable HTML report (needs login)
shakers share         # branded LinkedIn card (temporarily disabled)
shakers login         # identify yourself as a registered Talent (email or Google)
shakers logout        # forget the stored session (no-op if none)
shakers superadmin    # non-production test tool — not for Talents

# Marketplace & profile (all need login):
shakers alma          # interactive mini-shell to chat with Alma, your AI assistant
shakers find-projects # list the Projects/Positions available to you (paginated, filterable)
shakers show-project  # detail of one project/position (by number or id)
shakers save-project  # bookmark a project/position (by number or id)
shakers unsave-project # remove a bookmark (by number or id)
shakers applications  # projects you applied to + status
shakers invitations   # your unread project invitations
shakers availability  # view (or --set) your availability
shakers rate          # view (or --set) your per-project rate
shakers certifications# your certified / uncertified / expired role dimensions
shakers add-role      # add a role to your profile (a growth role) — arrow-key picker
shakers change-role   # switch your MAIN role to one you already have — arrow-key picker
shakers me            # your profile summary (alias: shakers profile)
```

#### Command families

The flat commands above are also grouped into **families** — a friendlier way to
discover them for both humans and agents. `shakers <family> <subcommand>` runs the
exact same handler; **every flat command keeps working as an alias**, so nothing
breaks. Run `shakers <family>` with no subcommand to list its subcommands, and
`shakers` (no args) prints the full family map.

| Family | Subcommands | Flat aliases |
|--------|-------------|--------------|
| `add` | `skill`, `agent`, `project`, `role` | `add-skill`, `add-agent`, `add-project`, `add-role` |
| `role` | `add`, `change` (`main`) | `add-role`, `change-role` |
| `profile` | `show`, `rate`, `languages`, `socials`, `experiences`, `portfolios`, `availability`, `certifications` | `me`, `rate`, `lang`, `socials`, `experiences`, `portfolios`, `availability`, `certifications` |
| `projects` | `find`, `show`, `save`, `unsave`, `invitations`, `applications` | `find-projects`, `show-project`, `save-project`, `unsave-project`, `invitations`, `applications` |
| `usage` | `run`, `report`, `share` | `ai-usage`, `report`, `share` |
| `certs` | `list`, `certify` | `certifications`, `certify` |
| `account` | `login`, `logout`, `register`, `config` | `login`, `logout`, `register`, `config` |

```bash
shakers role add        # == shakers add-role
shakers role change      # == shakers change-role
shakers profile rate     # == shakers rate
shakers projects find    # == shakers find-projects
shakers usage run        # == shakers ai-usage
shakers account login    # == shakers login
shakers profile          # no subcommand → your profile summary (== shakers me)
shakers projects         # no subcommand → lists the "projects" subcommands
```

Each command keeps all its flags:

```bash
shakers ai-usage --json               # report as JSON on stdout
shakers ai-usage --root ../other       # scan another directory instead of the current one
shakers ai-usage --roadmap             # also show the tier roadmap / next-steps (hidden by default; alias --next)
shakers ai-usage --no-save             # persist nothing (report only, on screen)
shakers ai-usage --build-next-level    # secondary path: write deterministic starter file(s) for the next tier
shakers ai-usage --force               # with --build-next-level, overwrite an existing file
shakers ai-usage --lang es|en          # force the report language instead of OS-locale detect
shakers ai-usage --consent-status      # view your save decision / email / last send
shakers ai-usage --consent-revoke      # revoke consent to save (-> denied), no more sends
shakers ai-usage --consent-reset       # clear the decision (-> undecided), ask again next run
shakers ai-usage --consent-email E     # change the email on file, without touching the decision
shakers ai-usage --set-endpoint URL    # persist the ingest endpoint (see "Configuration" below)
shakers ai-usage --show-endpoint       # show the effective endpoint and where it comes from
```

`ai-usage` no longer prints a report link — its output is the clean terminal
view. Use `report` to produce and open the full HTML (needs login):

```bash
shakers report                          # materialize + open this project's HTML report in the browser
shakers report --root ../other          # report for another project
shakers report --no-open                # just print the file:// link, don't launch the browser
shakers report --lang es|en             # force the surrounding CLI copy + report language
```

The `share` command reuses the last ai-usage stored for the project (needs login):

```bash
shakers share                           # build the LinkedIn card for this project's ai-usage
shakers share --root ../other           # card for another project's ai-usage
shakers share --lang es|en              # force the surrounding CLI copy language (the card is English)
```

### Marketplace & profile

These talk to the Shakers platform on your behalf (they use your login session,
never a project scan). All need `shakers login` first.

**Chat with Alma.** Open an interactive mini-shell with your AI assistant from the
terminal. The conversation keeps its context across turns, and Alma can act on your
profile (with an arrow-key confirmation before anything irreversible):

```bash
shakers alma                                               # opens the conversation; type "exit" to quit
```

Before the first message, `alma` asks for **consent to share a code-free map of the
current project** (its name, services, agents, technologies — never your source
code) so Alma can answer with context. If you decline — or there is no terminal to
ask — every message is sent **without** that context. The consent is CLI-side only.

**Find and open projects.** `find-projects` lists the positions available to you,
ordered by match, paginated and filterable server-side:

```bash
shakers find-projects                                   # first page (grouped All / Saved)
shakers find-projects --page 2 --limit 20               # paginate
shakers find-projects --attendance remote --country ES  # filter by work mode / country
shakers find-projects --tab saved                       # only your saved positions
shakers find-projects --json                             # machine output (includes ids)
```

**Reference a project by its number.** `find-projects` and `applications` hide the
raw ids from the human listing and print a `N)` number instead. `show-project`,
`save-project` and `unsave-project` accept **that number** (from the last listing)
or a full id:

```bash
shakers show-project 3          # detail of item 3 from the last listing
shakers save-project 3          # bookmark item 3
shakers unsave-project 3        # remove the bookmark
shakers show-project <uuid>     # a raw id also works (for scripts / --json)
```

**Your applications and invitations:**

```bash
shakers applications            # positions you applied to + status (also refreshes the number cache)
shakers invitations             # your unread project invitations
```

**Your profile.** View by default; the two setters (`--set`) are interactive with
an explicit confirmation before writing (they change what clients see):

```bash
shakers me                      # summary: headline, role, % complete, rate, availability, languages, skills/agents count
shakers certifications          # your role dimensions by state (certified / uncertified / expired) + band
shakers availability            # view your availability (open-to-work, hours/month, location)
shakers availability --set      # change it — arrow-key pickers, then confirm
shakers rate                    # view your per-project rate
shakers rate --set              # change it — pick modality + currency, type the amount, then confirm
```

**Your roles.** A talent has one **MAIN role** plus optional **growth roles**. Both
commands use the same arrow-key picker as the rest of the CLI:

```bash
shakers add-role                # pick a role from the catalog and add it as a growth role
shakers change-role             # switch your MAIN role to one you already have
```

`add-role` (alias `shakers role add`) reads the role catalog (the roles you do not
already hold) and adds the one you pick. `change-role` (alias `shakers role change`)
lists the roles you already hold and sets the one you pick as your MAIN role.

Setting your **MAIN role** is a step of **registration** (`shakers register`): after
you take or skip the interview during the alta, it offers your resolved/recommended
roles and lets you set your MAIN role. Running the interview on its own
(`shakers onboarding`) does **not** ask for the main role — to change it later use
`shakers change-role`.

**Repeat the onboarding interview.** `shakers onboarding --repeat` (alias
`shakers onboarding repeat`) re-runs the **interview only**, **overwriting** the
previous one (it does not touch your main role). Because the prior evaluation is
discarded and it cannot be undone, it first shows a clear warning and requires an
**explicit Yes/No confirmation** (arrow-key selector); on a non-TTY, pass `--yes` to
confirm. Only after you confirm does it reset the interview and run it again.
Declining aborts with no change. If you have no onboarding yet it tells you to run
`shakers onboarding` first.

```bash
shakers onboarding                 # the interview (+ final main-role step)
shakers onboarding --repeat        # warn + confirm, then overwrite and re-run
shakers onboarding repeat --yes    # same, pre-confirmed (non-interactive / agents)
```

Every listing/detail is also available as `--json` for scripting, and every
command takes `--lang es|en`.

Without installing, from a copy of the repo, `shakers <cmd>` is equivalent to
`node bin/shakers.js <cmd>`.

### Human vs. agent mode (dual TTY contract)

Every command keeps the same dual contract it had before the shell was
retired: on a real terminal it is **interactive** (prompts, masked secret
input, pickers); on a non-TTY (piped stdin, CI, an agent) it runs **one-shot**
and never blocks on a prompt it cannot answer. Each interactive question has a
flag equivalent (`--email`, `--root`, `--skill`, `--accept-disclaimer`,
`--consent-email`, …), read-heavy commands print machine-readable output with
`--json` (`ai-usage --json`), and **exit codes are meaningful** — a gated
command with no session, or a command that failed, exits non-zero, so an agent
can branch on the result.

Results are saved in `~/.config/shakers/` (a per-project cumulative HTML
report plus its `report-state.json`). **Nothing is ever written to the
scanned project** — the report can't slip into a commit by accident.

### MCP server (`shakers mcp`)

`shakers mcp` speaks JSON-RPC over stdio so a desktop AI app (Claude / ChatGPT
Desktop) can drive the same features as tools. It exposes, among others:

- **AI usage**: `ai_usage`, `ai_usage_result`.
- **Auth**: `login`, `logout`, `social_signin_start`, `social_signin_poll`.
- **Sign-up** (from the talent's own AI, ticket 39540; copy from UX review
  39574): every talent-facing text is fixed, comes from the tools in the
  talent's language (es/en/it/pt, fixed by their first message) and the AI shows
  it word for word. `signup_start` (welcome and permission to look for the CV),
  `signup_email` (the email they read most), `signup_draft` (the profile draft
  and the data notice, confirmed before the account exists),
  `signup_create_account` (starts the hub import of LinkedIn + CV + what the AI
  knows and opens the local password/Google window, which claims that profile
  with a code kept only in memory; if the email already has an account, the
  window asks the talent to sign in instead), `signup_status`,
  `update_existing_profile` (shows what would change in an existing profile and
  re-imports filling only empty fields), `save_profile_details`,
  `import_profile`, `open_web` (opens the web signed in through a one-time
  link), `open_linkedin_profile` (only when the talent does not know where to
  find their LinkedIn URL), plus `suggest_register_context` and `read_cv`.
  `ai_usage` is the step after the account exists, right after its two
  disclaimers.
- **Onboarding interview**: `onboarding_interview_start`,
  `onboarding_interview_turn`, `onboarding_interview_complete` (if LiveKit
  cannot load, the talent is sent to the web), `repeat_onboarding_interview`
  (OVERWRITE-repeat — the agent must warn the talent it is irreversible before
  calling), `onboarding_finish` (only after a repeat; the sign-up never calls it).
- **Roles**: `list_available_roles`, `add_role`, `list_my_roles`, `set_main_role`
  — `set_main_role` is the onboarding **final step** (after
  `onboarding_interview_complete`, or if the interview was skipped, offer
  `list_my_roles` and set the picked one).
- **Closed questions** of the sign-up (AI-usage consent, which email, interview
  here or later, how to answer it, main role) are answered by picking an option.
  When the client declares the MCP `elicitation` capability (spec 2025-06-18),
  the tool asks in the client's own dialog (`elicitation/create`) and gets the
  pick directly; otherwise it returns `question` and `options` and the AI offers
  them as buttons or a numbered list. The legal texts are always shown in the
  chat before any consent dialog.
- **Profile / skills / agents**: `list_addable`, `add_skill`, `add_agent`,
  `add_project`, `get_profile`, `get_rate`, `get_languages`, `list_socials`,
  `list_experiences`, `list_portfolios`, `get_availability`.
- **Marketplace**: `find_projects`, `show_project`, `save_project`,
  `unsave_project`, `list_invitations`, `list_applications`.
- **Certifications**: `list_certifications`, `list_certifiable_dimensions`.
- **Alma**: `ask`.

MCP tool names are **stable** (renaming would break existing client configs); the
role tools above were added, not renamed. `register`, `register_preview` and
`register_status` were removed with the sign-up redesign, not renamed.

## Try it

Today the CLI runs from a repo checkout with `node bin/shakers.js` (the npm
package is `shakers`, run with `npx shakers <command>` — e.g. `npx shakers ai-usage` — which is later work). Verified commands:

```bash
node bin/shakers.js                    # no command → prints the usage help (exit 0)
node bin/shakers.js ai-usage           # anonymous AI-usage evaluation (no session needed)
node bin/shakers.js ai-usage --help    # the command's own flags/help
node bin/shakers.js login              # sign in (needs an endpoint configured)
node bin/shakers.js logout             # sign out (silent no-op if no session)
node bin/shakers.js certify            # gated: with no session → clear error, exits 1
```

Gating behaviour to expect, session-less: `ai-usage` and `login` run; `logout`
is a silent no-op (exit 0); `certify`/`report`/`share` print "requires an
active session" naming both `shakers login` and `shakers register`, and **exit
non-zero** (so an agent can branch on it). An unknown command (e.g. the removed `start`) also exits
non-zero.

## Skill certification (`certify`)

`certify` (run as `shakers certify`, alias `certify skills`) certifies
Skills from your Shakers catalog by analyzing your local project. **It
requires you to be [logged in](#login-login--logout) first** (ADR-050) — see
the login gate below; there is no email-only path any more. It runs in two
phases, back to back:

1. **Resolve** — detects your project technologies, asks the certifications
   service which map to a Skill you can certify, and shows certifiable vs
   non-certifiable. Only the detected **technology names** (plus an email
   audit hint, when one is on file) leave the machine here — the call is
   authenticated by your login session's bearer token, not by the email.
2. **Certify** — you pick ONE certifiable Skill to certify (interactive
   single-select, or `--skill <name>` / `--skill <position>` non-interactively
   — one Skill per run, so the mandatory interview below always has exactly
   one Skill to interview about); the CLI takes a deterministic **code
   sample** for it, runs a secret-scrub pass, sends it for a Skill assessment,
   and shows the result. The assessment report is **always shown**; the
   analyzed result is persisted to Shakers only if you granted consent up
   front. Skill scores are **indicative and not reproducible** — not an
   official qualification. This is the single most invasive payload in this
   repo — your **actual sampled code** — so if you granted consent, it's also
   the clearest case of what [Privacy & consent model](#privacy--consent-model)
   describes as Datadog capture: a third party retaining that code for up to
   three months, with no selective deletion afterwards. Right after the
   code-only result, a short **interview about that same Skill** starts
   automatically (see below) — it is no longer optional.

```bash
shakers certify                       # resolve + certify a Skill for the current project
shakers certify --root ../other       # analyze another directory
shakers certify --skill React         # certify the Skill by name (no interactive select)
shakers certify --skill 1             # certify the Skill at this position in the resolve report
shakers certify --email you@shakers.com
shakers certify --lang es|en
shakers certify --accept-disclaimer   # accept the legal disclaimer non-interactively
```

Unlike `ai-usage` (which always produces a local report), `certify` is
inherently server-side: it requires an endpoint — `SHAKERS_CLI_CERTIFY_ENDPOINT`,
or (its usual case) the resolved `SHAKERS_CLI_INGEST_ENDPOINT` from which the
certify route is derived as a sibling (see
[Configuration](#configuration-environment-variables)) — there is no
local-only certification and, since ADR-042, only ONE backend to configure. The
flow is deliberately front-loaded, and checked in this order, entirely before
any Skill is chosen: (1) the endpoint must be configured, (2) your project's
technologies are detected locally (no egress yet), (3) the **login gate**
refuses — with no egress at all — a run with no active session (a superadmin
session bypasses it, see [Superadmin](#superadmin-non-production-only)), (4) a
legal disclaimer is shown that you must explicitly accept (the code-egress
gate), and (5) — the first time, and skipped entirely for a logged-in Talent
whose session already carries an email — the save-to-Shakers consent and an
email OTP verification are handled, still before you choose a Skill. The
disclaimer assumes the project is your own and attributes responsibility to
you, so **never run it on a third party's code** (e.g. a client under NDA).
For local end-to-end testing, run the real certifications service and point
the endpoint at loopback (see "Local end-to-end testing" below); the in-repo
stub that used to serve this route is retired. The real implementation lives
in `sh-web-works-certifications` — the CLI's only backend.

### Skill interview — starts on its own, consent still required

Once `certify skills` shows the code-only assessment for the Skill you
certified, it goes straight into a short **interview about that same Skill**:
a few questions about the sampled code (an antifraud check) and about your
general command of the tool, over the same session/turn/verdict machine
`certify agents` uses. There is no "do you want to try it?" prompt any more —
it always reaches the interview when stdin is an interactive terminal and an
interview endpoint is configured. What it does NOT skip is consent: a legal
notice (what is asked, and what happens to your answers — including the
third-party Datadog retention if you gave content consent) is shown and you
must explicitly accept it before anything about the interview leaves the
machine; declining (or answering nothing) stops there, visibly, and your
code-only Skill certification is unaffected either way. Running from a
pipe/CI (no TTY) cannot host an interview or a consent answer, so it is
skipped with a visible message. The server combines the interview with the
code score into an attested combined level (Middle/Senior/Expert), which can
raise or lower what the code alone gave you.

### Agent certification (`certify agents`) — an interview, not a form

`certify agents` certifies how deeply you command ONE of your own agents
(`.claude/agents/*.md`). It is a real **interview**: the service opens a
session, asks **one question per turn**, decides which of the five assessment
areas each question probes, and decides when to stop. The CLI is the courier —
it re-sends the agent **definition** (never persisted server-side, only hashed)
and your answer, and it deliberately cannot choose the question or the area.

```bash
shakers certify agents                # interview + verdict for one agent
shakers certify agents --root ../other
shakers certify agents --email you@shakers.com
shakers certify agents --lang es|en
```

What is worth knowing before you start:

- **Either the whole flow, or nothing is asked of you.** Certifying now needs
  an **active [login](#login-login--logout) session** (ADR-050) — a session
  proves control of the account, which is a higher bar than the
  email+OTP check this used to be. That is checked **locally, before you are
  asked for anything** — no address, no agent picker, no egress — and if
  you're not logged in it stops right there with a distinct message for
  "never logged in" vs "your session expired," and tells you to run `login`.
  A non-production superadmin session bypasses this (see
  [Superadmin](#superadmin-non-production-only)). `--email` (or the address
  already on file) still travels as an optional audit hint the server matches
  against your session — it is no longer what authenticates you. The
  disclosure still comes first, because the login check itself sends nothing.
- **You can stop and come back.** Progress lives in
  `~/.config/shakers/interview-session.json` (permissions `600`), written
  atomically after every turn. If the process dies — Ctrl-C, a dropped
  connection, a closed laptop — re-run `certify agents` and it offers to
  continue where you left off, re-sending the answer that was in flight so you
  never retype it. The file is deleted when the verdict arrives (or when the
  session expires), and it holds a **bearer token** for your interview plus the
  answer currently in flight, which is why it is `600` and why nothing prints
  it.
- **There is a limit of 5 interviews per 24 hours**, and an abandoned session
  still counts. That is why declining a resume tells you the attempt is already
  spent, and why a transient network failure never silently opens a second
  session.
- **Answers are capped at 4000 characters, counted after the secret-scrub
  pass.** Scrubbing can make text *longer* (a path or a key becomes
  `[REDACTED]`), so an answer that fits raw can be refused. You are told before
  the first question, and an over-long answer is refused **locally**, with the
  exact overshoot — never as a server error after you wrote three paragraphs.
- **You see the turn number and the areas you have been ASKED ABOUT, each with
  how many turns it has had — not how many turns are left.** "Asked about" is not
  "covered": whether an area is substantiated is the grader's judgement, and one
  question is never it. The per-area count is there so a lopsided interview (five
  turns on one area, one on another) is visible instead of invisible. The service
  owns the stop condition; showing you its budget would turn "when does this end"
  into something to play against.
- **Before the first question you are told what is being judged**: the reasoning
  behind each decision, the alternatives you discarded and why, and concrete
  cases where it showed. It is not a request for longer answers — a claim with no
  reasoning behind it does not evidence command however long it is.
- **Two different lifetimes for what you write**, both stated in the disclosure
  you accept before anything leaves: (1) inside Shakers your free text is
  **deleted when the verdict is emitted**, in the same operation — only the
  question, the quote that was verified and each area's tag survive; (2) if you
  granted content consent, the copy at **Datadog LLM Observability** (a third
  party) runs its full retention and **cannot be deleted** — the first deletion
  does not reach it. And the asymmetry that matters: consent is read fresh on
  every call, but if it is on for the **verdict** request, the **whole**
  interview is captured, even if every earlier turn was sent without it.
- **The verdict can take minutes.** Grading runs three samples over the full
  transcript, and it can outlast the CLI's own wait. When that happens the CLI
  polls and collects the verdict rather than reporting a failure; if you give up
  first, the session stays on disk and the next run picks the verdict up.

Like `certify skills`, this needs an endpoint: the four interview routes are
derived from `SHAKERS_CLI_INGEST_ENDPOINT`, the CLI's one backend (see
[Configuration](#configuration-environment-variables)).

## Login (`login` / `logout`)

A registered Talent identifies themselves with `login` (issue 122 / ADR-044).
Since ADR-061 a session is required by **every** command except `ai-usage` and
`login` itself — `certify` (both `skills` and `agents`) also proves control of
the **account**, not just of an email address (ADR-050). `login` and `logout`
run without a session (that is how you obtain/drop one); `logout` with no
session is a silent no-op.

```bash
shakers login                      # no method flag: interactive picker (Email / Google / LinkedIn) on a real TTY
shakers login --email you@shakers.com   # skip the picker, prompt only for the password
shakers login --google             # skip the picker, go straight to the Google flow
shakers login --linkedin           # skip the picker, go straight to the LinkedIn flow
shakers logout                     # forget the stored session (no-op if none)
```

- **No `--password` flag, ever.** `argv` is visible to every other process on
  the machine (`ps`) and lands in shell history, so the password is only ever
  collected via a masked interactive prompt or a stdin pipe — never a flag.
- **Email/password** sends `{ email, password }` to the certifications
  service's `POST /api/v1/auth/login/email`, which proxies the credentials to
  the Shakers Hub **server-side** and runs its token-exchange, returning a
  certifications-service JWT the CLI stores locally. The password transits
  CLI → certifications service → Hub, over TLS, and is never persisted by the
  certifications service.
- **Google** is an **OAuth 2.0 Device Authorization Grant** (RFC 8628): the CLI
  asks the Hub for a short code, shows you a URL and a `XXXX-XXXX` code to enter
  in your browser, and polls until you authorize. Nothing about Google lives on
  your machine — no client id, no loopback server, no secret; the Hub owns all
  Google config and does the token exchange server-side. After you authorize, the
  Hub session is exchanged for the same API JWT the email flow stores.
- **LinkedIn** signs in through the same device flow as Google, with
  `provider=linkedin`: the `login --linkedin` / `--provider linkedin` flags and
  the sign-in window served to AI apps (the loopback method-choice screen) both
  route to it. This reverses the earlier parking (ADR-041/046). Whether it
  completes depends on the Hub having a LinkedIn OAuth app provisioned.
- The session (`{ accessToken, expiresAt, email }`) is stored **atomically**,
  permissions `600`, in `~/.config/shakers/auth-session.json`. **Logged in**
  means "an unexpired token is present" — an unparseable or missing
  `expiresAt` is treated as expired, never as active. `login` while a session
  is already active tells you so instead of silently overwriting it; run
  `logout` first to switch accounts.

## Superadmin (non-production only)

`superadmin` is a password-gated, **non-production** test tool for the team
running this CLI against a service instance — not something a Talent uses.
The server 404s every superadmin route in production regardless of the
password.

```bash
shakers superadmin                     # open a session (prompts password + your own email)
shakers superadmin --email you@shakers.com   # same, prompts only the password
shakers superadmin --inspect --email talent@example.com   # read-only certification receipt (ADR-025)
shakers superadmin --logout            # forget the locally stored session
```

- **Also no `--password` flag**, for the same reason as `login` — the
  password is only ever read from an interactive prompt or a stdin pipe.
- Opening a session validates the password server-side and persists the
  returned token locally (`config.json`'s `superadminSession`, ADR-027).
  `certify` then accepts that session **instead of** a `login` session,
  bypassing the login/identity gates on **any** email/repo, and its results
  are stamped `test_origin: true`.
- **A known, documented exception (ADR-050):** unlike `certify agents`
  (hardened to reject an unregistered email), the skill-code certification's
  superadmin branch still tolerates `userId: null` and lets a superadmin
  certify code against an unregistered email. This asymmetry is deliberate
  and left as-is — it's non-production, encrypted, and yields no durable
  credential — not a bug to fix to parity.
- `--inspect` is read-only: it prints the stored authorship + rubric evidence
  for an email's certifications (an attribution trail, not cryptographic
  proof).

## The report

- **Terminal output** (from `ai-usage`/`certify`) and a **self-contained HTML
  dashboard** (opened by `report`; Shakers branding, responsive, zero network
  calls — no CDN, no external script, no fetch). The terminal is the concise
  view; the HTML carries the full detail.
- **`ai-usage`/`certify` persist their result silently** into
  `report-state.json` and print **no** link (ADR-016). The HTML is produced and
  opened only when you run **`report`** — which regenerates the per-project HTML
  from state, opens it in your browser (use `--no-open` to just print the link),
  and prints the clickable `file://` link.
- **Localized to your OS locale**: a locale starting with `es` shows
  Spanish; anything else shows English (`src/locale.js` / `src/i18n.js`).
  `--lang` overrides this for a single run, including the copyable
  implementation prompt.
- **Terminal sections (ADR-016), in order**: the "why this tier" analysis
  FIRST, then the score meter, detected tools, technologies, and a
  one-line-per-agent summary (name + model + definition-quality score + local
  usage, with `↓` nesting). No environment section; the roadmap / next-steps is
  behind `--roadmap`.
- **HTML sections**: everything above at full length, plus the environment,
  MCP servers, the agent org chart with **per-agent detail** (score, rationale,
  usage), and the current→next roadmap with its implementation prompt.
- **The HTML report is cumulative and scoped per project.** Each scanned
  project has its OWN report file (`report-<hash>.html` in
  `~/.config/shakers/`), keyed by the project's absolute path, and is
  regenerated whole from `report-state.json` each time you run `report`. It
  fills in over time: the usage section appears once you've run `ai-usage`
  in that project, and the certification section once you've run `certify`
  there; both appear together when both have run for the **same** project. This is
  intentional (skill-code-certification, reporting redesign) — the report is a
  persistent per-project artifact, not a per-invocation transcript. So running
  `certify` in a project where you previously ran `ai-usage` correctly
  still shows the usage section: that usage was produced for this
  project and is part of its cumulative record, not stale or leaked data.
  Different projects never mix into one document.
- **Score scope (ADR-010, reverts ADR-009): the 0-100 score is computed over
  project ∪ home** — your whole developer AI setup (the project's signals plus
  your global `~/.claude` and machine-level config), not this one project in
  isolation. It measures the maturity of _you as a developer_, so projects that
  share a home tend to read similar scores. ADR-009 had briefly scoped the score
  to the project directory only, but that drove notes too low (project-level AI
  config is sparse), so ADR-010 reverted it to the earlier project ∪ home
  behaviour. The **tier (T0-T7)** uses the same project ∪ home scope.

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

**Never** read, stored or sent: file _contents_ beyond what's needed to
compute a count, absolute paths, environment variables, or credentials.

## Tier ladder (T0-T7)

The tier is "the highest tier whose criteria you ALL meet, checked strictly
bottom-up". The 0-4 band used elsewhere (e.g. Shakers direction views) is
derived from the tier — the tier is the single source of truth.

| Tier | Name                  | Criterion                                    |
| ---- | --------------------- | -------------------------------------------- |
| T0   | Empty bench           | no tool detected                             |
| T1   | First tool            | at least one tool detected                   |
| T2   | Bench with notes      | T1 + project instructions/rules/config exist |
| T3   | Connected bench       | T2 + at least one MCP server configured      |
| T4   | Own tooling           | T3 + own skills/commands/rules               |
| T5   | Agentic operator      | agentic CLI + MCP + own tooling together     |
| T6   | Multi-agent           | T5 + 2 or more agents defined                |
| T7   | Orchestrated workshop | T6 + at least one hook configured            |

File recency (`mtime`) is informative only — it is never a gating signal
for any tier.

## Optional server-side LLM layers

Three capabilities are ephemeral, optional, server-side LLM calls — all run
independently of the save/consent decision (they never touch the
persistence payload) and all degrade gracefully (deterministic fallback, or
simply no scores shown) if the endpoint is unset or the call fails for any
other reason. Since ADR-042 there is a single backend to answer any of
them — no second hop to retry against.

"Ephemeral" here is about the SHAKERS-side persistence payload only — it does
**not** mean the call's content is never stored anywhere. See
[Privacy & consent model](#privacy--consent-model) for what a `granted`
consent additionally authorizes a third-party observability provider to
capture.

- **Agent-card synthesis** (`SHAKERS_CLI_SYNTHESIS_ENDPOINT`): sends your
  agents' description text to synthesize a short symbolic name + "what it
  does" per agent, for nicer cards. Falls back to the deterministic org
  chart if unavailable — and, per agent, to your own raw `.claude/agents/`
  description (cleaned up and excerpted for card display) or a minimal
  name-derived line if that's missing too, so a card's description is
  never blank.
- **Roadmap personalization** (`SHAKERS_CLI_ROADMAP_ENDPOINT`): asks the
  certifications service to rewrite the current tier jump's prose (what it unlocks, steps,
  tips, mistakes) adapted to your detected stack. The tier, the band, and
  the "when to upgrade" criterion are **never** touched by this call — only
  the curated roadmap's fallback prose can ever change. Only derived
  signals are sent (frameworks, tool/MCP categories, tier), never raw file
  content or agent descriptions.
- **Agent definition-quality evaluation** (`agent-evaluation`, derived as a
  sibling of your ingest endpoint; overridable with
  `SHAKERS_CLI_AGENT_EVAL_ENDPOINT`): sends the scrubbed agent definitions and
  gets back a 0-100 score + short rationale per agent (**gemini-2.5-flash**
  server-side, prompt version `agent-eval-v1`). The definition is treated as
  DATA server-side (prompt-injection safe). Degradation is by omission — the
  server drops any agent it couldn't score, and agents with no returned score
  render without a number. No endpoint / failure → no scores shown.

All three send only derived signals or scrubbed agent definitions — never raw
file content — and a scrub pass runs before anything leaves the machine.

Separately, `ai-usage` reads your **local Claude Code history**
(`~/.claude/projects/**`) to count how often each detected agent was actually
invoked on this machine. This is **usage only**: it extracts a single signal per
line — the `subagent_type` of an `Agent` tool call — and never reads, stores, or
transmits prompt text, tool inputs, or any session content. The counts stay
strictly local (not in the persistence payload). It degrades gracefully if the
history directory is absent or unreadable.

## Privacy & consent model

- **The CLI talks to ONE Shakers backend.** Every call this tool makes — the
  usage send, the optional LLM layers above, `login`, and everything under
  `certify` (resolve, certify, email verification, agent certification,
  skill interview) — goes to a single configured endpoint,
  `sh-web-works-certifications`. Until 2026-08-04 (ADR-021) there was a
  second hop that fell back to `shakers-hub-backend`; ADR-042 retired it once
  it was confirmed that hop never had the routes mounted (it only ever
  answered 404, which had already masked at least one real timeout in a
  diagnosis). There is no fallback any more: an unset or unreachable endpoint
  is a real, named error (timeout / connection refused / 5xx), not a silent
  hop to somewhere else. Nothing is deployed at a real address yet — see
  [Configuration](#configuration-environment-variables) — and `install.sh`
  writes a loopback placeholder by default, so a fresh, unconfigured install
  talks to nothing on the Talent's own machine.
- **The report is always generated and shown locally, unconditionally.**
  There is no gate, no wall, no preview step before you see your own data.
- **Saving (persisting) it to Shakers is opt-in, asked once.** The first
  time you run the tool, right **after** the report is already on screen,
  you're asked a short yes/no question: do you want this report saved in
  Shakers? Accepting asks for an email; declining persists that choice and
  you're never asked again. Manage the decision any time with
  `--consent-status` / `--consent-revoke` / `--consent-email`, without
  re-running the scan.
- **This one yes/no now governs TWO different things (talents-ai-score,
  ADR-028), kept explicit rather than blurred into one vague permission —
  there is no separate flag for each yet, it's a single consent:**
  1. **Persisting in Shakers.** Only derived signals are ever sent for
     saving — booleans, counts, categories, tier/band, the detected
     technology names, and (if it ran) the synthesized agent summaries.
     **Never** file contents, absolute paths, environment variables, or
     credentials. The email you typed travels outside this whitelisted
     payload, in the request body.
  2. **Capturing content in a third-party observability provider.**
     `ai-usage`/`certify`'s optional server-side AI calls — agent-card
     synthesis, roadmap personalization, agent definition-quality
     evaluation, CERTIFY's skill-code
     assessment, and every call of the agent-certification **interview**
     (each turn, plus the verdict) — send a
     `traceContentConsent` flag reflecting your **current**, per-request
     decision. When (and only when) it's `true`, **Datadog LLM
     Observability**, a company **other than Shakers**, may capture and
     retain the prompt/output of that call — which, for CERTIFY and agent
     certification, includes your **actual sampled source code** and your
     **free-text answers**, not just derived signals. Retention is up to
     **three months**, configured on Datadog's side. **There is no promise
     of later, per-item deletion of that content** — unlike the structured
     payload above (governed by `--consent-revoke`/purge), Datadog's
     retention is the only expiry that exists for it. If you decline (or
     never decide), nothing is sent there — this is the safe default; the
     flag is only ever omitted or `true`, never inferred.
- **The optional LLM layers above still run REGARDLESS of your save
  decision** — that's what makes the diagram, the roadmap and the agent
  scores "always show". What changes with consent is ONLY whether Datadog
  may capture what they send, per point 2 above; the call itself, and
  whether it's silently dropped or degraded on failure, is unaffected by
  consent either way. The local **usage** read (Claude Code history) is not
  even a network call — it never leaves the machine, consent or not.
- The consent decision lives in `~/.config/shakers/consent.json`
  (permissions `600`).
- An **unfinished interview** (agent certification, or the skill-code
  interview under `certify skills`) lives in
  `~/.config/shakers/interview-session.json` (permissions `600`, written
  atomically — the two kinds share one file, discriminated by a `kind`
  field). It holds a bearer token for that interview and the answer
  currently in flight — nothing else of what you typed — and it is deleted as
  soon as the verdict arrives or the session expires. Delete it by hand at any
  time: the only consequence is losing the ability to resume that interview
  (the attempt it spent is already counted server-side either way).
- A **login session** lives in `~/.config/shakers/auth-session.json`
  (permissions `600`, written atomically): the bearer token that identifies
  you to `certify`, plus its expiry and (when the server sent one) your
  email. See [Login](#login-login--logout).
- **Legal**: sending data about how a person works involves personal-data
  processing (GDPR). This model has legal/labor sign-off reported for the
  current design (see `active-work/talents-ai-score/decisions.md`,
  ADR-011/013). **Activating sending against real Shakers talents in
  production is a separate deployment decision that still requires its own
  legal/labor go-ahead** for that rollout — this repo doesn't ship a
  production endpoint by default (see below).
- **Legal copy across FOUR separate disclosure texts** (reviewed — the
  `[PENDING LEGAL/LABOR REVIEW — NOT FINAL]` markers were removed), each shown
  before a different kind of egress: the save-to-Shakers consent intro
  (`ai-usage` / `certify skills`), the `certify skills` code-egress disclaimer,
  the `certify agents` interview disclaimer, and the `certify skills` interview
  disclaimer. All four state that **you are solely responsible for owning/being
  authorized to analyze the code you submit, that Shakers assumes no liability
  for it, and that misuse may lead to penalties on your Shakers account (up to
  suspension)**. The skill-interview disclosure additionally names, per
  ADR-049, that the interview asks questions **about the code you just
  sampled**. And per ADR-051, that disclosure's own yes/no is a **real consent
  gate**, not decorative text: declining it skips the interview outright (your
  code-only Skill certification stands either way) — only the earlier "do you
  want to try the interview?" opt-in was removed, not this consent.

## Configuration (environment variables)

The backend endpoints ARE baked in, per flavor, in `ENV_PROFILES`
(`src/config.js`): `staging`, `dev` and `local`. The default flavor is derived
from the package `name` (`shakers-cli-beta` → staging, `@shakers/shakers-cli` →
dev), forceable with `SHAKERS_CLI_ENV=staging|dev|local` — see
[Publishing](#publishing-maintainers) above. No secret is ever compiled in
(ADR-002/007). The baked profile is only a DEFAULT: the per-endpoint
`SHAKERS_CLI_*_BASE` env vars and `config.json` always win over it (env >
`config.json` > baked profile), and the profile bases reach the getters by
seeding a fresh `config.json` on first run. Every code path that depends on an
endpoint either degrades gracefully (no send / deterministic fallback) or — for
`certify`, which has no local-only product — surfaces an actionable error;
neither ever breaks the local `ai-usage` report.

**Since ADR-042 the CLI talks to ONE backend**, `sh-web-works-certifications`.
The two-hop chain this section used to describe (a `shakers-hub-backend`
fallback) is retired: it never had the routes mounted on `develop`, so every
"fallback" was an instant 404 that once masked a real timeout in a
diagnosis. Only ONE variable needs setting; everything else this CLI calls is
**derived from it** as a sibling route (`deriveFromIngest` in `src/config.js`)
— the base path's last segment (e.g. `.../usage/reports`) is swapped for the
sibling's (e.g. `.../usage/skill-certification/sessions`).

| Variable                              | Purpose                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SHAKERS_CLI_INGEST_ENDPOINT`          | **The one endpoint to configure.** Where a saved `usage` report is sent (if consent is granted). Every other endpoint below derives from it unless it has its own override.                            |
| `SHAKERS_CLI_CERTIFY_ENDPOINT`         | Override for the `certify` skill-certification route. Unset derives from ingest. Unlike `usage`'s endpoints, a missing one here is an **actionable error**, never a silent no-op — `certify` has no local-only product. |
| `SHAKERS_CLI_LOGIN_ENDPOINT`           | Override for `login`'s email/password route. Unset derives from ingest (climbing out of the `usage` module: `.../api/v1/auth/login/email`).                                                            |
| `SHAKERS_CLI_DEVICE_AUTHORIZE_ENDPOINT`| Override for Google device-flow authorize (`POST .../auth/device/code`). Unset derives from the hub base.                                                                                               |
| `SHAKERS_CLI_DEVICE_TOKEN_ENDPOINT`    | Override for Google device-flow token polling (`POST .../works/auth/device/token`). Unset derives from the hub base.                                                                                    |
| `SHAKERS_CLI_SYNTHESIS_ENDPOINT`       | Override for agent-card synthesis (optional feature). Unset derives from ingest.                                                                                                                        |
| `SHAKERS_CLI_ROADMAP_ENDPOINT`         | Override for roadmap personalization (optional feature). Unset derives from ingest.                                                                                                                     |
| `SHAKERS_CLI_AGENT_EVAL_ENDPOINT`      | Override for agent definition-quality evaluation (optional feature). Unset derives from ingest.                                                                                                          |
| `SHAKERS_CLI_CONFIG_DIR`               | Override `~/.config/shakers/` (mainly for tests).                                                                                                                                                        |

> **Env prefix (ADR-045):** the CLI's variables use the `SHAKERS_CLI_*` prefix
> (distinct from the certifications backend's own `SHAKERS_*`). The pre-rename
> `AI_FOOTPRINT_*` names are still honoured as a fallback — if the new name is
> unset and the old one is set, the old one is used — so nothing breaks for
> anyone who exported the old variables.

Every other endpoint this CLI calls (email verification request/verify,
agent-certification interview sessions, skill-certification interview
sessions, and the two superadmin routes) has **no** env-var override at all —
they are always derived from ingest; see `src/config.js` for the full list of
`get*Endpoint` getters. The agent-certification and skill-interview session
bases are derived exactly like the others, but their **per-session** URLs
(`/:id`, `/:id/turns`, `/:id/verdict`) are built by string concatenation in
the client, never re-derived (`deriveFromIngest` replaces the base's last
path segment, and that base already ends in `sessions`).

### Config file (persistent ingest endpoint)

So you don't have to `export SHAKERS_CLI_INGEST_ENDPOINT` every session, it
can also live in a persistent file next to consent/reports:

```
~/.config/shakers/config.json
{
  "ingestEndpoint": "https://your-certifications-service/api/v1/usage/reports"
}
```

Set it without editing JSON by hand:

```bash
shakers ai-usage --set-endpoint https://your-certifications-service/api/v1/usage/reports
shakers ai-usage --show-endpoint     # prints the effective endpoint and its source
```

**Resolution precedence:** `SHAKERS_CLI_INGEST_ENDPOINT` (env var, the raw
developer override, legacy `AI_FOOTPRINT_INGEST_ENDPOINT` honoured too) **>**
`config.json` **>** none. There is still no compiled-in production default in
the code — only `install.sh` bakes a loopback placeholder into a FRESH config
file (see the prominent comment there; **this must change before real
distribution**). Every sibling-derived endpoint in the table above keeps
deriving from whichever value this resolves to.

**A config file written before ADR-042 may still carry the retired
`ingestEndpointFallback` key.** `install.sh` never overwrites an existing
`config.json`, so upgrading doesn't clean it up. The policy is deliberate:
the key is **ignored** (nothing reads it any more), **never migrated** (there
is nowhere to migrate a hub URL to — the one endpoint is already configured
separately) and **never erased** (this CLI never rewrites a Talent's config
file except behind an explicit `--set-*`, and a rewrite is the one operation
that could lose it). `--show-endpoint` is the one place that says the key is
present and unused, so nobody debugging their setup mistakes it for a live
hop.

**Endpoint safety (bounded):** because the endpoint decides where the sampled
code (`certify`) and derived signals (`ai-usage`) are sent, `--set-endpoint`
refuses to persist an `http://` URL to any host other than
`localhost`/`127.0.0.1`/`::1` — a non-local host must be `https`. There is no
domain allowlist yet (`SHAKERS_CLI_DOMAINS` in `src/config.js` is deliberately
empty — see that file's docblock for why an unverified entry would be worse
than none); a non-loopback, non-allowlisted host still requires you to type
the hostname back before `--set-endpoint` persists it. The env var is not
validated (it's the explicit developer escape hatch); a hand-edited config
file carrying an insecure remote endpoint is ignored at read time.

## Local end-to-end testing

**Run the real backend and point the CLI at loopback.** There used to be a
`reference-server/` stub in this repo that you could run instead; it is
**retired** (talents-ai-score, issue 044) and it is not coming back. It still
answered the `agent-certification/followups` and `/verdict` routes after those
were retired from the service, and it never had a single **interview** route, so
anyone who ran it was testing against a contract that no longer exists. That is
worse than having no stub: it fails silently and in your favour.

It was retired rather than repaired on purpose. Serving the agent-certification
interview would mean reimplementing session state, the `seq` cursor, per-turn
idempotency, the stop condition and evidence anchoring — a second implementation
of the most delicate semantics in the system, which would lie to your face the
moment it drifted from the real one. Running the real service is what the team
does, and it is the only way to get answers you can trust.

This also settles a standing caveat: the old stub kept its reports in an
in-memory map, so every mention of it had to warn that production demands a real
database. That warning is **obsolete by retirement, not by oversight** — there is
no in-repo server left that anyone could mistake for the real one. Persistence is
the certifications service's business (Prisma/Postgres), and always was.

The backend is the Shakers certifications service
(NestJS + Prisma + Postgres) — since ADR-042, the CLI's **only** backend.
Its `usage` module mounts every route this CLI calls (plus `auth/login/*`)
under the service's `api/v1` global prefix. Start it in its own checkout (it
needs its own database and secrets — see that repo's README), then:

```bash
# the service listens on PORT, default 3000, with global prefix /api/v1
export SHAKERS_CLI_INGEST_ENDPOINT=http://127.0.0.1:3000/api/v1/usage/reports
shakers ai-usage
```

`http://` is accepted **only** for loopback (`localhost`, `127.0.0.1`, `::1`);
every other host must be `https` (`src/config.js`). If you prefer not to export
a variable each session, persist it instead — the env var wins over the file:

```bash
shakers ai-usage --set-endpoint http://127.0.0.1:3000/api/v1/usage/reports
```

Every other URL the CLI needs (`skill-certification`, `login`, the Google
config/login pair, `email-verification/request` and `/verify`,
`agent-synthesis`, `agent-evaluation`, `graph-inference`, and the
`agent-certification/sessions…` / `skill-certification/sessions…` interview
routes) is derived as a sibling of whatever `ingestEndpoint` resolves to, so
that one variable is enough — `login` first, since `certify` refuses to run
without a session (ADR-050):

```bash
shakers login --email you@shakers.com
```

Note the real OTP (for the non-login email-verification path, still used by
`ai-usage`'s save-to-Shakers consent) is emailed via HubSpot with a Redis
TTL/single-use code — there is no fixed local code any more, so read the one
you were sent. There is no fallback hop to exercise any more (ADR-042): an
unset or unreachable endpoint fails with the real cause (timeout / connection
refused / 5xx), it does not retry anywhere else.

The CLI's own test suite does not need any of this: it wires an in-process fake
(`test-fixtures/ingest-service-fake.js`) into a throwaway server on an ephemeral
port. That fake is a **test double, not a runnable server** — it binds no port,
has no launcher, is never installed, and only implements what the assertions in
`test/` require.

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
bin/shakers.js                   Argv command dispatcher + session gate — the single entrypoint (ADR-060/061)
bin/ai-usage.js                  `ai-usage` command logic (run(args,{ask}))
bin/certify.js                   `certify` command logic — skills/agents subcommands + picker (run(args,{ask}))
bin/report-html.js               `report` command — materialize + open the HTML (run(args,{ask}))
bin/share.js                     `share` command logic — currently disabled (run(args,{ask}))
bin/login.js                     `login`/`logout` command logic (run/runLogout(args,{ask}))
bin/superadmin.js                `superadmin` non-production test-tool command (run(args,{ask}))

── ai-usage: detection & classification ──
src/detectors.js                 Catalog of tools and signals
src/scanner.js                   Scan engine -> report object
src/scan-exclusions.js           Paths/dirs excluded from the scan
src/tier-engine.js               T0-T7 ladder computation (single source of truth)
src/tier-analysis.js             "Why this tier" deterministic breakdown
src/maturity.js                  0-4 band + 0-100 score (derived from the tier)
src/mcp-detector.js              MCP server name/category detector
src/memory-structure-detector.js Context-file import/structure detector
src/automations-detector.js      Scripts/scheduler automation detector
src/browser-tools-detector.js    Browser-automation tooling detector
src/tech-detector.js             Project technologies (frameworks) detector
src/tech-extensions.js           Technology name map / extensions
src/agent-org-chart.js           Deterministic agent org chart parser (+ hierarchy)
src/agent-synthesis.js           Optional LLM agent-card synthesis client
src/agent-evaluation.js          Optional LLM agent definition-quality client (gemini-2.5-flash, server-side)
src/agent-usage.js               Local Claude Code history reader (usage signal only, never content)
src/roadmap-content.js           Curated per-tier roadmap content (es/en)
src/roadmap-prompt.js            Ready-to-paste implementation prompt
src/roadmap-personalization.js   Optional LLM roadmap-prose personalization client
src/build-next-level.js          Secondary: writes deterministic starter files

── certify: Skill + agent certification ──
src/certify-args.js              `certify` flag parsing (--skill, --accept-disclaimer, --fast…)
src/certify-client.js            Resolve/certify HTTP client (discriminated results)
src/certify-disclaimer.js        Legal disclaimer + explicit acceptance (egress gate, `certify skills`)
src/certify-preconditions.js     LOGIN precondition for `certify agents` (ADR-050)
src/certify-render.js            Resolve report renderer
src/certify-remediation-prompt.js Copyable remediation prompt per Skill
src/certify-agents.js            `certify agents` interview flow
src/certify-skill-interview.js   `certify skills`' mandatory-start skill interview (ADR-049/051)
src/interview-engine.js          Shared turn-loop/resume/verdict engine (agents + skill interviews)
src/agent-certification-client.js HTTP client for both interview kinds' session/turn/verdict routes
src/skill-sampler.js             Deterministic per-Skill code sampling (+ scrub)
src/skill-selection.js           --skill selection parsing (by name or position)
src/authorship.js                Git-authorship filtering/attribution of sampled code (ADR-017)
src/interactive-select.js        Interactive single-/multi-select picker
src/interview-session-store.js   Atomic 0600 session-in-flight store (shared by both interview kinds)
src/legal-notice.js              Shared framing for the four disclosure texts
src/render-certification.js      Certification report (terminal + HTML sections)
src/render-skill-interview.js    Skill-interview combined-level verdict renderer

── login / superadmin ──
src/auth-session-store.js        Atomic 0600 login-session store (`login`)
src/auth-client.js               Email/password login HTTP client
src/auth-device-client.js        Google device-flow HTTP client (RFC 8628: authorize/token/api-token)
src/device-login.js              Google device-flow orchestration (blocking CLI loop + shared start/poll)
src/device-auth-store.js         Atomic 0600 pending-device-grant store (bridges the MCP start/poll tools)

── share: LinkedIn card ──
src/share-card.js                Builds the self-contained branded SVG/HTML card
src/shakers-wordmark.js          Inlined "shakers" logotype (auto-generated from SVG)

── consent, identity, persistence, reporting ──
src/consent-flow.js              Short, one-time "save to Shakers?" prompt
src/consent-skip.js              Explicit reasons the consent prompt is/isn't shown
src/email-verification.js        Email OTP verification client (gates persistence)
src/share.js                     Consent state + derived-payload whitelist + sending
src/report-store.js              Per-project cumulative report state + HTML (persistence)
src/report-theme.js              Shared Shakers HTML theme (tokens/base/copy script)
src/store.js                     Legacy latest/history store — UNUSED (kept on disk)
src/render-terminal.js           Terminal output (why-first, one-line-per-agent; ADR-016)
src/render-html.js               Self-contained HTML dashboard (full detail, per-agent scores)
src/osc-link.js                  OSC 8 clickable terminal links
src/open-file.js                 Best-effort cross-platform "open in browser" (report/login-browser)

── graph-inference plumbing (retained; the `map` command was removed) ──
src/repo-context.js              Content-free structural repo summary (entrypoints, AI call-sites…)
src/graph-infer-client.js        Optional LLM graph-inference client (gemini-2.5-pro, server-side)
src/graph-scan.js                Deterministic agent-subgraph + footprint drawer (feeds the sheet)
src/graph-generator.js           Deterministic graph generation

── shared plumbing ──
src/cli-args.js                  `ai-usage` flag parsing
src/config.js                    Endpoint configuration from env vars, never hardcoded — one backend (ADR-042)
src/config-dir.js                Single source for the config dir + legacy `~/.config/ai-footprint` migration (ADR-045)
src/env-paths.js                 Home-directory + `SHAKERS_CLI_*`/`AI_FOOTPRINT_*` env resolution (test-overridable)
src/stdin-ask.js                 Injectable stdin question/answer helper
src/terminal-progress.js         Status line + spinner for slow calls
src/locale.js                    OS locale detection
src/i18n.js                      Text catalogs (es/en) — report, CLI, certify, login, superadmin

test-fixtures/ingest-service-fake.js  In-process backend FAKE for tests only — not shipped, binds no port
install.sh                       Installer (curl | bash, or local)
```
