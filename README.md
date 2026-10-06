# Shakers connector — distribution

Public distribution channel for the **Shakers** connector. This repo ships two things and **no source code**:

1. A **Claude Code plugin marketplace** (`.claude-plugin/marketplace.json`, named `shakers-mcp`) that lists one plugin, `shakers`.
2. A **GitHub-Releases host** for the `.mcpb` bundle used by **Claude Desktop** and other MCP clients.

The connector itself is the public npm package **`shakers-cli-beta`** (staging flavor; `shakers-cli` in prod). The MCP server ships inside it — `npx -y shakers-cli-beta mcp` runs the full stdio server on your machine. Everything here just points at that package; nothing proprietary is vendored except build config.

## What the connector does

A local-first Shakers talent toolset. Local scan tools (`ai_usage`, `read_cv`, `suggest_register_context`) run on-device with on-device redaction; the server-backed tools (profile, projects, applications, certifications, register, onboarding, roles, Alma) call Shakers over HTTP authenticated with your CLI login.

Slash-commands exposed by the plugin. Each is shipped as a plugin **skill** (model-invocation disabled, so only you trigger it), which is why the short form works. When the name is unambiguous you type the bare command; the fully-qualified `/shakers:<name>` form always works too.

| Command | What it does |
| --- | --- |
| `/ai_usage` | Scan this machine and build your "My work with AI" report. |
| `/my_profile` | Show your Shakers profile (role, rate, availability). |
| `/find_projects` | Find open Shakers positions matched to you. |
| `/onboarding` | Register and onboard (import, pricing, availability, interview). |
| `/certify` | See and start certifications for your role dimensions. |
| `/ask [question]` | Ask Alma, the Shakers AI assistant. |

## Use it in Claude Code (plugin marketplace)

```bash
# add this repo as a marketplace
claude plugin marketplace add devShakers/ai-usage-evaluator
# install the plugin
claude plugin install shakers@shakers-mcp
```

Or inside a session: `/plugin marketplace add devShakers/ai-usage-evaluator` then `/plugin install shakers@shakers-mcp`.

The plugin declares the MCP server (`.mcp.json`) as `npx -y shakers-cli-beta mcp` with `SHAKERS_CLI_ENV=staging`. Node.js 18+ is required on your machine; `npx` fetches the package on first run.

## Use it in Claude Desktop (.mcpb bundle)

Download the bundle from the latest release and open it with Claude Desktop (Settings → Extensions → install from file):

**Stable URL (always newest):**

```
https://github.com/devShakers/ai-usage-evaluator/releases/latest/download/shakers-ai-usage-staging.mcpb
```

The `.mcpb` is self-contained (it bundles the CLI's `bin/` + `src/`); it needs Node.js 18+ on your machine but no npm install. The onboarding interview needs an optional native dependency (`@livekit/rtc-node`) that the bundle does not carry — that one tool degrades gracefully if absent; everything else works.

## How the `.mcpb` is built

`.github/workflows/release.yml` runs on a published GitHub Release (or manually). It:

1. `npm install`s the public CLI package (`shakers-cli-beta` for staging, `shakers-cli` for prod) from npm — no auth.
2. Stages its `bin/ src/ README LICENSE` plus this repo's vendored `mcpb/manifest.json`.
3. Injects `SHAKERS_CLI_ENV` (the target env) and the resolved package version into the staged manifest.
4. Packs with `npx -y @anthropic-ai/mcpb@2.1.2 pack <stage> <out>`.
5. Uploads the asset as `shakers-ai-usage-<env>.mcpb` on the release.

**Why inject `SHAKERS_CLI_ENV` instead of relying on the package name:** the bundle intentionally omits `package.json`, and the CLI bakes its backend flavor from `package.json.name`. Without it the server would default to **dev**. Injecting `SHAKERS_CLI_ENV` into `server.mcp_config.env` makes the env deterministic for both staging and prod from a single vendored manifest — the official packer validates and honors `mcp_config.env`.

Prod (`shakers-cli`) is wired but that package is not published yet; run the workflow with `env=prod` once it is.

## Layout

```
.claude-plugin/
  marketplace.json   # marketplace shakers-mcp: lists the one plugin, shakers
  plugin.json        # plugin manifest (metadata)
.mcp.json            # plugin's MCP server: npx -y shakers-cli-beta mcp
skills/              # six user-invocable skill wrappers (/ai_usage, /ask, …)
mcpb/manifest.json   # vendored manifest for the .mcpb build (env injected in CI)
.github/workflows/release.yml
```

---

© Shakers Works S.L. — All rights reserved. See [LICENSE](./LICENSE).
