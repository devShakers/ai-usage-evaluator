# Shakers (all-in-one, local)

A one-click Claude Desktop extension that runs the **complete Shakers talent toolset** on your
machine: scan your AI usage, build your profile, find projects, register, onboard, and ask Alma.
There is no separate remote connector — the server-backed tools call Shakers (hub/certs) over
HTTP authenticated with your Shakers CLI login.

## What it does
- **Local scan** (on-device, redacted): `ai_usage` scans your AI-tool sessions (Claude
  `~/.claude/projects`, Codex `~/.codex/sessions`, Gemini `~/.gemini/tmp`, Cursor, Continue,
  Cline/Roo, Aider) and your git repos; redacts everything on your machine (counts/tiers/scrubbed
  excerpts — never your source), then with your consent submits the report to Shakers.
- **Server-backed** (your CLI login): profile, rate, availability, languages, portfolios,
  projects, applications, certifications, register/onboarding, roles, and Alma — all over HTTP.

## Tools & slash-commands
Exposes the full tool set; `manifest.json` declares every tool the server registers. Slash-command **prompts**: `/ai_usage`, `/onboarding`,
`/find_projects`, `/certify`, `/ask`, `/my_profile` (each just triggers the relevant tool — no
duplicated logic).

## LiveKit (onboarding interview) — optional native dependency
The onboarding interview uses `@livekit/rtc-node`, a **platform-specific native** package. The
bundle ships **without** it (keeping it OS-agnostic and prerequisite-free): everything works
self-contained, and only `onboarding_interview_*` degrades to `livekit-not-installed` until the
talent installs it (`npm i -g @livekit/rtc-node`, or the CLI's `SHAKERS_PROFILE=talent` install).
To bundle it instead, ship per-OS/arch `.mcpb` variants each carrying the matching prebuilt (see
BUILD.md tradeoff) — not done by default because one bundle can't carry every platform's binary.

## Before you install

When you open the `.mcpb`, Claude Desktop shows this notice for every extension that does not come
from Anthropic: "Only use extensions from developers you trust. Anthropic does not control which
tools developers make available and cannot verify that they will work as intended or that they
won't change." This is expected. Most of the tools only talk to your Shakers account. These ones
also work with this computer:

- Look for your CV: asks you first. Only if you say yes, it lists the names of PDF and Word files
  in your Desktop, Documents, Downloads and iCloud Drive folders that look like a CV, and reads the
  name, email and GitHub user saved by your coding tools. It does not open those files.
- Read your CV: asks you first, naming the file. Only if you say yes, it reads the text of that CV
  file.
- Analyse how you work with AI: asks you first. Only if you say yes, it looks at which AI tools
  you use and the history of your code projects, and sends a summary with anonymised excerpts to
  your profile. Your code and your prompts never leave your computer.
- Add this project to your portfolio: reads the name, web address and dates of the project folder
  open here, asks you first naming all of them, and sends them to Shakers only if you say yes.

## Install
- **Claude Desktop:** open the `.mcpb` → Settings → Extensions → install (one click; Claude
  Desktop supplies the Node runtime).
- **CLI clients** (same server via npm): `… mcp add shakers -- npx -y @shakers/shakers-cli mcp`.

## Sign in
Server-backed tools need a Shakers session. Log in once with `shakers login` (or via the
register/onboarding flow); the local server reuses that session.

## Privacy
Scan redaction happens on-device before any upload; the upload is consent-gated and attributed
to your verified email. See `PRIVACY` / the hosted policy.
