# `shakers mcp` — local MCP server (stdio)

`shakers mcp` runs a local [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio so a desktop AI app (Claude Desktop, ChatGPT Desktop) can run
the AI-usage evaluation on the talent's own machine. It reads the disk directly
and reuses the CLI collectors verbatim; nothing runs remotely.

Transport is hand-rolled JSON-RPC 2.0 (newline-delimited) over stdin/stdout, with
no third-party dependency, to keep the `install.sh` copy path (zero-dep, no
`npm install`) working.

## Tool: `ai_usage`

Runs the same non-interactive path as `shakers ai-usage --json` (scan + collectors
+ tier), then, when the talent consents, sends the report to Shakers via the same
ingest endpoint the CLI uses.

Arguments:

- `consent` (object): `{ granted: boolean, email?: string }`. Ask the talent in
  the chat. When `granted` is `true`, `email` is required (it attributes the report).
  When `false`, the report is still computed and returned but nothing is sent.
- `repoScope` (object, optional): `{ mode: "current" | "all" | "list", repos?: string[] }`.
  Defaults to `current` (the repo at `root`). `all` widens the machine-wide session
  signals; `list` restricts to the named repos.
- `root` (string, optional): absolute path to the repo to evaluate. Defaults to the
  server working directory.
- `lang` (string, optional): `"es"` or `"en"`.

Returns `{ report, maturity, send, scope, consent }` — the same structured report
the CLI produces under `--json`, plus the send result.

## Connecting it: the installer does it

The last step of `install.sh` (`shakers mcp install`, `src/mcp-install.js`) writes the `shakers` server into every
client it finds: Claude Desktop (`claude_desktop_config.json`), Claude Code
(`claude mcp add --scope user`) and Cursor (`~/.cursor/mcp.json`). It uses absolute paths to
`node` and to this CLI, because a Claude Desktop launched from the Dock has no shell `PATH` and
a bare `"command": "shakers"` never starts. It forwards `PATH` and the `SHAKERS_PROFILE` /
`SHAKERS_CLI_*` bases the installer runs with, keeps every other key of the config, backs the
previous file up to `.bak`, replaces an old `shakers-ai-usage` entry, and leaves a config that
is not valid JSON untouched. Re-running the installer picks up an app installed later;
`SHAKERS_SKIP_MCP_INSTALL=1` skips the step.

## Claude Desktop config (by hand)

Add to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`).

Installed via `install.sh` (the `shakers` binary is on `PATH`):

```json
{
  "mcpServers": {
    "shakers-ai-usage": {
      "command": "shakers",
      "args": ["mcp"],
      "env": {
        "SHAKERS_CLI_INGEST_ENDPOINT": "https://<certs-ingest-host>/usage/reports"
      }
    }
  }
}
```

Installed via npm/npx:

```json
{
  "mcpServers": {
    "shakers-ai-usage": {
      "command": "npx",
      "args": ["-y", "shakers-cli", "mcp"],
      "env": {
        "SHAKERS_CLI_INGEST_ENDPOINT": "https://<certs-ingest-host>/usage/reports"
      }
    }
  }
}
```

The ingest endpoint resolves the same way as the CLI: `SHAKERS_CLI_INGEST_ENDPOINT`
(env) takes precedence over the persisted config file.

## Tools: session and profile

- `login` `{ method?, email?, password? }` — signs in and persists the session so the
  certify and `add_*` tools work. `method` is `email` (default) or `google`:
  - `method: "email"` needs `email` + `password` (reuses `requestLogin`). Security note:
    the password travels as a tool argument and appears in the chat transcript.
  - `method: "google"` opens the system browser for the OAuth loopback flow (reuses the
    CLI's `loginWithGoogle`) and **blocks until the talent completes it** — nothing
    sensitive in the transcript. Preferred.
  Returns `{ ok, method, email }` or a structured error (`invalid-credentials`,
  `browser-timeout`, `port-in-use`, …). Tokens are never forged.
- `logout` `{}` — clears the persisted session (`clearAuthSession`). Idempotent: returns
  `{ ok: true, wasLoggedIn }` whether or not a session existed.
- `report` `{ root?, lang? }` — materializes the shareable HTML report for this repo (AI
  usage + certified skills/agents) via `materializeProjectReport` and returns `{ ok, path, fileUrl }`.
  Does **not** open a browser (the chat surfaces the path). Reads the local state written by
  `ai_usage` and the certify tools; `{ ok: false, reason: "no-data" }` when nothing was run yet.
  Requires an active session.
- `share` `{ root? }` — generates the branded LinkedIn card via `generateShareCard` and returns
  `{ ok, path, fileUrl }`. No browser. `{ ok: false, reason: "no-footprint" }` when `ai_usage`
  hasn't run for the repo. Requires an active session.

### Local persistence after certify / ai_usage

So `report` and `share` have something to show, these tools write the same local state
(`report-state.json`, keyed by repo path) the CLI writes:

- `ai_usage` calls `persistFootprint` after the report is built (the tool returns `persisted: true`).
- `certify_agent_verdict` calls `persistAgentCertification` with the verdict.
- `certify_skill_verdict` calls `persistCertification` with an item carrying the interview-enriched
  `combinedLevel` (the same enrichment the CLI applies before re-persisting).

All three are best-effort: a failed local write never fails the tool.
- `list_addable` `{}` — lists the skills and agents discovered from the talent's
  shared AI-usage report (`requestDiscoveredInventory`), as
  `{ skills: [{ skillId, skillName, technologies }], agents: [{ name, tools, model, category, role, level }] }`.
  Session-gated.
- `add_skill` `{ skillId }` — declares a discovered skill by id (`requestDeclareSkill`).
- `add_agent` `{ agentName, whatItDoes?, humanDecides?, timeSavedHoursWeek? }` — declares
  a discovered agent by name (`requestDeclareAgent`).
- `add_project` `{ root?, name?, type?, description?, url?, skillIds? }` — adds the current
  repo to the portfolio (`requestDeclarePortfolio`); `name`/`url` default to the repo
  directory and its git remote, `type` defaults to `PORTFOLIO`.

All of `list_addable` / `add_*` are session-gated: without an active session they return
a clear "call the login tool (or run `shakers login`) first" error. Tokens are never forged.

## Tools: agent certification

Wrap the CLI's agent-certification flow (`open → turn → verdict`) as MCP tools. The
desktop AI drives the Q&A: it relays each question to the talent and calls the next
tool with the answer. The certification endpoints derive from the same ingest
endpoint as `ai_usage`.

- `list_agents` `{ root?, lang? }` — lists local agents (this repo's `.claude/agents`
  plus the home config) as `{ name, role, category, tools, model, parent, hasDefinition }`.
  Local disk read, no network, no session required.
- `certify_agent_open` `{ agentName? | agent?, root?, traceContentConsent?, lang? }` —
  opens an interview for a local agent (definition read from disk) or an inline agent.
  **Requires an active `shakers login` session.** Returns
  `{ ok, sessionId, sessionToken, seq, question, area, turnsRemaining, maxTurns, status }`.
- `certify_agent_turn` `{ agentName? | agent?, sessionId, sessionToken, seq, answer, root?, idempotencyKey? }` —
  submits the talent's answer, returns the next question or a stop (`nextAction: "verdict"`).
  Reuse `idempotencyKey` to re-send a turn whose response was lost.
- `certify_agent_verdict` `{ agentName? | agent?, sessionId, sessionToken, root?, lang? }` —
  returns `{ ok, verdict: { agentName, category, role, level, areas } }`.

Agent certification is session-gated: `certify_agent_open` returns a clear error asking
the talent to run `shakers login` first when there is no active session. Tokens are never
forged. `certify_agent_turn` / `certify_agent_verdict` authenticate with the per-session
token minted at open (the server binds identity only at open), so they carry the
`sessionId`/`sessionToken` returned by `certify_agent_open`.

## Tools: skill certification

Wrap the CLI's `certify skills` flow. Because the MCP server runs locally, it reads the
repo code from disk directly (same as `shakers certify skills`) — no file-provider round
trips. `certify_skill_open` samples the talent's own authored code, runs the CERTIFY code
scan (which mints the server-side Rule C evidence token), and opens the interview.

- `list_certifiable_skills` `{ root? }` — the skills the talent can certify in this repo
  (declared and detected, with local sampling), as `{ skills: [{ skillId, skillName, technology }] }`.
  Requires an active session.
- `certify_skill_open` `{ skillId | skillName, root?, traceContentConsent?, lang? }` —
  resolves the skill, samples authored code, runs CERTIFY (evidence token), opens the interview.
  **Requires an active login session.** Returns `{ ok, skillId, skillName, codeScore, sessionId, sessionToken, seq, question, ... }`.
- `certify_skill_turn` `{ sessionId, sessionToken, seq, answer, idempotencyKey? }` — next question or stop.
- `certify_skill_verdict` `{ sessionId, sessionToken, lang?, idempotencyKey? }` — the verdict.

The sampled `files[]` and the minted `certifyEvidenceToken` are held in a local per-session
cache (`mcp-skill-sessions.json` under the config dir, 0600) — turn re-sends the files and
verdict sends the token, so the caller never carries the code or the token across calls. The
cache is cleared on verdict. Session-gated with the same "call login first" error; no token forging.
