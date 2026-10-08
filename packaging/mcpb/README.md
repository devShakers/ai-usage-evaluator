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
Exposes the full tool set (44 tools). Slash-command **prompts**: `/ai_usage`, `/onboarding`,
`/find_projects`, `/certify`, `/ask`, `/my_profile` (each just triggers the relevant tool — no
duplicated logic).

## LiveKit (onboarding interview) — optional native dependency
The onboarding interview uses `@livekit/rtc-node`, a **platform-specific native** package. The
bundle ships **without** it (keeping it OS-agnostic and prerequisite-free): everything works
self-contained, and only `onboarding_interview_*` degrades to `livekit-not-installed` until the
talent installs it (`npm i -g @livekit/rtc-node`, or the CLI's `SHAKERS_PROFILE=talent` install).
To bundle it instead, ship per-OS/arch `.mcpb` variants each carrying the matching prebuilt (see
BUILD.md tradeoff) — not done by default because one bundle can't carry every platform's binary.

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
