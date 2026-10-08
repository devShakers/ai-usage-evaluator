# Install recipes per client (all-in-one local server)

One piece now: the **all-in-one local Shakers server** (`node bin/mcp.js`) exposes the full
toolset — the on-device scan tools **and** the server-backed tools (which call Shakers over HTTP
with your CLI login). No separate remote connector. Minimize friction by publishing the Claude
`.mcpb` (one-click) and the npm package (for `… mcp add npx …`), with deep-link buttons for
Cursor/VS Code.

| Client | How to add the server | One-click / no-JSON? |
| --- | --- | --- |
| **Claude Desktop** | Install the **`.mcpb`** (Settings → Extensions). Claude Desktop supplies Node — no prerequisites. | **Yes**, one click. |
| **Claude Code** | `claude mcp add shakers -- npx -y @shakers/shakers-cli mcp` | One command. |
| **Cursor** | "Add to Cursor" deep-link with stdio config `npx -y @shakers/shakers-cli mcp`. | **Yes**, deep-link. |
| **VS Code** | "Install in VS Code" badge (`vscode:mcp/install?<urlencoded JSON>`) with the same stdio command. | **Yes**, badge. |
| **Gemini CLI** | `gemini mcp add shakers npx -- -y @shakers/shakers-cli mcp` | One command. |
| **Codex CLI and app** | `shakers mcp install`: adds the server and the `shakers` skill in `~/.codex/skills/shakers/`. Codex keeps MCP tools out of the prompt and ignores server instructions, so `codex mcp add` alone leaves the model unaware of Shakers. | One command. |
| **Windsurf** | Settings → add server / marketplace; stdio `npx -y @shakers/shakers-cli mcp`. | Partial (often raw JSON). |

Scan-only variant (tools: ai_usage/ai_usage_result/read_cv/suggest_register_context) is still
available by appending `--local`: `npx -y @shakers/shakers-cli mcp --local`.

## Sign in
Server-backed tools require a Shakers session: run `shakers login` once (or the register/
onboarding flow). The server reuses `~/.config/shakers/` auth-session.

## Slash-commands
The server advertises MCP **prompts**: `/ai_usage`, `/onboarding`, `/find_projects`, `/certify`,
`/ask`, `/my_profile`. In a client that surfaces prompts they appear as slash-commands and each
triggers the matching tool.

## npm entrypoint status
`@shakers/shakers-cli` already exposes the `shakers` bin; `shakers mcp` starts the all-in-one
server (and `shakers mcp --local` the scan-only one) — so `npx -y @shakers/shakers-cli mcp` works
today with no new entrypoint.
