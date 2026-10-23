# Shakers CLI and MCP

Shakers for freelance talent, from your terminal or your AI assistant. It scans your
AI-tool setup on your own machine and shows how you work with AI. It also lets you sign
up on Shakers, keep your profile up to date, find projects and ask Alma, the Shakers AI
assistant.

## Install

Requires Node 18 or later.

**Command line (npm)**

```bash
npm i -g shakers-cli
```

Or run it without installing: `npx -y shakers-cli <command>`.

**Command line (install script)**

```bash
curl -fsSL https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/release/install.sh | bash
```

Uninstall with the same line ending in `| bash -s -- --uninstall`.

**Claude Code plugin**

```
/plugin marketplace add devShakers/ai-usage-evaluator
/plugin install shakers@shakers-mcp
```

The plugin adds the Shakers MCP server and these slash-commands: `onboarding`, `ai_usage`,
`my_profile`, `find_projects`, `certify` and `ask`.

**Claude Desktop**

Download the `.mcpb` file from the latest
[GitHub Release](https://github.com/devShakers/ai-usage-evaluator/releases) and open it
with Claude Desktop.

## Main commands

```bash
shakers ai-usage       # scan this project and machine, show your AI-usage tier (no account needed)
shakers register       # create your Shakers account and profile
shakers login          # sign in (email or Google)
shakers logout         # forget the stored session
shakers certify        # certify a dimension of your role through an interview
shakers report         # build and open your shareable HTML report
shakers me             # your profile summary
shakers find-projects  # projects and positions available to you
shakers applications   # projects you applied to, and their status
shakers availability   # view or set your availability
shakers rate           # view or set your rate
shakers alma           # chat with Alma
shakers mcp            # run the MCP server for an AI desktop app
```

Run `shakers` with no command to see every command.

## Privacy

- The `ai-usage` scan runs on your machine and its report is shown there first.
- Saving it to Shakers is opt-in. Every time, before anything is uploaded, you see what
  would be sent and what Shakers does with it, and it is uploaded only if you say yes. You
  can leave out agents and text excerpts there. `--consent-revoke` stops future uploads
  from this computer; it does not delete what was already uploaded. To ask for that, write
  to talent@shakersworks.com.
- What is sent is mostly derived data (counts, categories, tier, detected technologies,
  sessions, active days, commits and lines changed). Literal text travels too, and the review
  shows how much: up to 40 fragments of your messages to AI assistants and 20 commands they
  ran (200 characters at most each), and the definition (up to 2,000 characters) and short
  description of each of your AI agents, all after removing anything that looks like a
  secret, a path or an email. The fragments come from the conversations in the repositories
  analysed, or from every conversation on this computer when you analyse the whole machine
  (registration always does). Never your code, your full conversations, the names of your
  repositories, environment variables or credentials.
- An AI model from an external provider (OpenAI, Google or Anthropic) analyses that text
  automatically for Shakers to compute your evaluation, and then it is discarded. Only the result is stored: levels, scores, counts and the names
  of your tools and agents.
- Do not run it on a machine or with conversations that hold information you are not
  allowed to share: client, employer or third-party data. Secret removal is automatic and
  best effort; names or business details you wrote can remain in the fragments.
- Certification sends secret-scrubbed samples of your code and your interview answers to
  Shakers to assess them.
- Read the full policy at <https://www.shakersworks.com/en/politica-de-privacidad>.

## License

Proprietary, source available. See [LICENSE](LICENSE).

## Support

talent@shakersworks.com
