# AI Footprint — Handoff document (context for another agent)

This document summarizes the project's current architecture and status so
another agent can continue without the conversation history. It reflects
the code on `feat/level-up-framework` and the decisions in
`active-work/talents-ai-score/decisions.md` (ADRs referenced by number
below; **read that file for full rationale**, this is a summary).

## 1. What it is and where it comes from

Command-line tool that builds, **locally**, a deterministic profile of a
developer's AI tool setup and classifies it into an 8-tier ladder (T0-T7,
"level-up framework"), with a curated roadmap from the current tier to the
next one, plus a ready-to-paste implementation prompt.

Origin: inspired by `darnoux/claude-code-level-up` (scan local signals,
classify by level). Kept as a standalone CLI (not a Claude Code skill) so
it covers any AI tool, not just Claude.

Business context: Shakers (freelance talent marketplace). Talents run it
locally and can optionally share a derived-signal summary with the
platform to understand AI adoption across the pool.

## 2. Current model — read this before touching anything

**The model changed materially across ADR-007 → ADR-011 → ADR-013/014 →
ADR-015. If you find old references to a token/enrollment model, a
pre-scan "disclosure wall", or `--consent on|off`, they are stale — the
current model, in force, is below.**

1. **The local report is always computed and shown, unconditionally**
   (ADR-011). There is no gate, no wall, no preview step before the talent
   sees their own report. This replaced ADR-007's pre-scan itemized
   disclosure entirely.
2. **Persisting (saving) to Shakers is opt-in, asked once, after the
   report is already on screen** (ADR-007's opt-in email idea, gating
   revised by ADR-011). Accept → email + send; decline → persisted, never
   asked again. Manage any time via `--consent-status` /
   `--consent-revoke` / `--consent-email`, without re-scanning.
3. **Disclosure = the repo's own README**, not an in-CLI wall (ADR-011).
   The consent text itself is only about *persisting*, never about what's
   shown locally.
4. **No kill switches anymore** (ADR-011 retires
   `AI_FOOTPRINT_INGEST_ENABLED`; the design's would-be
   `AI_FOOTPRINT_SYNTHESIS_ENABLED` never shipped either). Consent,
   enforced client-side, is the only control on sending. There is no
   emergency ops stop — an accepted, documented tradeoff (ADR-011).
5. **The tier (T0-T7) and its 0-4 band are fully deterministic** — no LLM
   ever computes or alters them (ADR-013/014). Two narrow LLM layers exist
   on top, both ephemeral, both optional, both degrading to a deterministic
   fallback (ADR-010/011 for agent-card synthesis, ADR-015 for roadmap
   prose personalization) — neither can change the tier/band, neither
   feeds the persistence payload.
6. **Only derived signals are ever persisted** — never raw file content,
   paths, env vars, or credentials (ADR-003, reinforced by every later
   ADR). The one deliberate exception is the ephemeral, non-persisted
   agent-synthesis call, which does send description *text* (ADR-010,
   accepted with legal sign-off, ADR-011) — but that text never reaches
   `src/share.js`'s persistence payload.

### What was fully retired (do not reintroduce)

- Token-based enrollment (`--enroll=CODE`, `decodeEnrollString`,
  `enroll()`, a Bearer `Authorization` header, `token`/`talentId`/
  `expiresAt`/`enrolledAt` fields) — ADR-005/006's model, superseded by
  ADR-007. Never shipped against real data; nothing to migrate.
- `--consent on|off` as a per-run flag — superseded by the interactive,
  one-time consent-to-persist prompt (`src/consent-flow.js`) plus the
  three one-shot management flags.
- The pre-scan itemized "what's sent/never sent" disclosure wall/preview —
  superseded by ADR-011 ("disclosure = README").
- `AI_FOOTPRINT_INGEST_ENABLED` server kill switch, and any client-side
  awareness of it — ADR-011.
- The `[PENDING LEGAL REVIEW]` placeholder that used to sit in the consent
  copy — legal sign-off is now reported (ADR-011, 2026-07-10) and the
  placeholder text is gone from `src/i18n.js`'s `consent` catalog.

## 3. Architecture and files

```
install.sh                       Installer (curl | bash, or local) — English-only, unconditional
package.json
README.md                        User-facing (talent) documentation
HANDOFF.md                       This document
bin/report.js                    CLI orchestrator (flags, flow, sequencing)
src/detectors.js                 Catalog of 12 tools and their signals
src/scanner.js                   Scan engine -> report object (booleans/counts only)
src/tier-engine.js               T0-T7 ladder computation (single source of truth)
src/tier-analysis.js             "Why this tier" deterministic breakdown (met/blocking criteria)
src/maturity.js                  0-4 band, DERIVED from the tier engine; score 0-100 (unchanged formula)
src/roadmap-content.js           Curated per-tier roadmap content, es/en, ported from meta-repo docs
src/roadmap-prompt.js            Assembles the copyable "implementation prompt" from roadmap + signals
src/roadmap-personalization.js   Ephemeral LLM client: personalizes roadmap prose only (ADR-015)
src/build-next-level.js          Secondary path: writes deterministic starter file(s) for the next tier
src/agent-org-chart.js           Deterministic parser of .claude/agents/*.md (name/tools/model/parent)
src/agent-synthesis.js           Ephemeral LLM client: synthesizes short agent-card descriptions (ADR-010/011)
src/mcp-detector.js              MCP server NAME + heuristic category detector (issue 015)
src/memory-structure-detector.js Context-file @file import count/depth/sections/size (issue 016)
src/automations-detector.js      npm/shell scripts, JSON-piping, scheduler detection (issue 017)
src/browser-tools-detector.js    Composes tech-detector + mcp-detector into a browser-tooling signal (issue 018)
src/tech-detector.js             Project technologies (frameworks/libraries) from dependency manifests (ADR-012)
src/render-terminal.js           Terminal output with ANSI colors
src/render-html.js               Self-contained HTML dashboard (zero network calls)
src/store.js                     Persistence in ~/.config/ai-footprint/ (reports, not consent)
src/share.js                     Consent state + STRICT WHITELIST payload (derivePayload) + sending
src/consent-flow.js              Short, one-time "save to Shakers?" prompt (stdin-injectable)
src/consent-skip.js              Explicit reasons for why the consent prompt is/isn't shown this run
src/cli-args.js                  CLI flag parsing (extracted for unit testing)
src/config.js                    Endpoint configuration from env vars — never hardcoded, no defaults
src/locale.js                    OS locale detection for report localization
src/i18n.js                      Report + consent text catalogs (es/en) — tier names, tier analysis, roadmap-unavailable, etc.
src/env-paths.js                 Shared home-directory resolution (test-overridable)
src/terminal-progress.js         Static status line (sync scan) + real spinner (async LLM calls)
src/stdin-ask.js                 Injectable stdin question/answer helper
reference-server/server.js       Reference (in-memory STUB) public ingestion contract, NOT deployed
test/*.test.js                   node:test suite, one file per module/concern (`npm test`)
```

Note: `bin/report.js` uses `require` paths relative to its own location, so
the folder structure must be preserved (the installer respects it).

## 4. Detection and classification

Detected tools (12): Claude Code, Cursor, GitHub Copilot, Windsurf, Aider,
Continue, Cline, Gemini CLI, Codex CLI, Amazon Q Developer, Cody, Zed,
Tabnine.

Signals: project config files/directories, home-directory config, binaries
on `PATH`, installed editor extensions. Depth: per-tool counts
(instructions, config, rules, MCP servers, skills, commands, hooks).

**Scope is project ∪ home** (ADR-014, applied to every new detector added
under the level-up framework): agent org chart, MCP config, memory
structure, automations and browser tools are all read from both the
scanned project root AND the talent's home directory, via
`src/env-paths.js#getHomeDir` (test-overridable via
`AI_FOOTPRINT_HOME_DIR`, mirrors `src/share.js`'s
`AI_FOOTPRINT_CONFIG_DIR` pattern).

### Tier ladder (`src/tier-engine.js`, ADR-014)

"The highest tier whose criteria ALL hold, checked strictly bottom-up" —
each tier gates on the exact previous one, so a higher-tier raw signal
(e.g. a hook configured) never lets a setup skip a lower, unmet tier (e.g.
no project context at all).

| Tier | Key name (i18n) | Criterion |
|------|------------------|-----------|
| T0 | Empty bench / Banco vacío | `totalDetected == 0` |
| T1 | First tool / Primera herramienta | `totalDetected >= 1` |
| T2 | Bench with notes / Banco con notas | T1 + `context >= 1` (instructions+config+rules) |
| T3 | Connected bench / Banco conectado | T2 + `mcp >= 1` |
| T4 | Own tooling / Herramienta propia | T3 + `custom >= 1` (skills+commands+rules) |
| T5 | Agentic operator / Operador agéntico | `hasAgentic` + `mcp>=1` + `custom>=1` |
| T6 | Multi-agent / Multi-agente | T5 + `agentCounts.agents >= 2` |
| T7 | Orchestrated workshop / Taller orquestado | T6 + `hooks >= 1` |

`AGENTIC_IDS` (agentic-CLI tools that count toward T5): `claude-code`,
`aider`, `gemini-cli`, `codex-cli`, `amazon-q-developer`.

Band 0-4 is derived from the tier via a fixed lookup
(`BAND_BY_TIER = [0, 1, 2, 3, 3, 4, 4, 4]`), single source of truth —
`src/maturity.js#classify()` no longer computes its own independent level
rules. This DOES change the band for some setups vs. the old ad-hoc rules
(most notably breadth-only setups — several tools installed, none
configured — that used to reach band 3 via `breadth >= 3` alone; the
ladder requires T2's context first, so those setups now land at band 1).
Documented, intended consequence of the recalibration, not a regression
(level-model.md, ADR-014).

`mtime`/recency is explicitly **informative only** (ADR-003) — never a
gating signal for any tier, by construction.

The `score` (0-100, visual meter) and `breadth` are unchanged formulas from
before the tier engine; only the discrete band classification is now
tier-derived.

### Tier analysis (`src/tier-analysis.js`)

Mechanical readout of `tier-engine.js`'s own ladder rule — every rendered
sentence is a template filled with an already-computed signal, never an
LLM guess. `analyzeTier(report, t)` takes the **full i18n catalog** `t` (not
just its `tierAnalysis` sub-object) so it can also resolve the localized
tier NAME via `t.tierNames` — this is the only sanctioned way to display a
tier name; `tier-engine.js`'s own `TIERS[].name` field is Spanish-only BY
DESIGN (domain logic, not i18n) and must never be shown directly to a
talent.

### Roadmap content (`src/roadmap-content.js`, ADR-013/014)

Ported verbatim from meta-repo authored sources (product-manager, not
LLM-generated at runtime):
- Spanish (source of truth):
  `active-work/talents-ai-score/build/roadmap-content.md`
- English (mirror, fully authored, not a fallback):
  `active-work/talents-ai-score/build/roadmap-content.en.md`

One entry per tier JUMP (current → next), keyed by the current tier. T7 has
its own terminal entry (no next jump). The report shows only the entry for
the talent's own `tierKey`. `getRoadmapEntry(tierKey, lang)` has a
defensive `contentUnavailable` fallback (never fires today — both
languages are fully populated for T0-T7) instead of ever falling back to
showing Spanish under a non-Spanish locale.

### Optional LLM layers (both ephemeral, both degrade cleanly)

- **`src/agent-synthesis.js`** (ADR-010, gating revised by ADR-011): sends
  agent description *content* (free text from `.claude/agents/*.md`) to
  `AI_FOOTPRINT_SYNTHESIS_ENDPOINT` on **every run**, independent of
  consent — this is what makes "always show the diagram" possible. A
  `scrubSecrets` heuristic redacts obvious secrets/PII before anything
  leaves the machine. Failure of any kind (no endpoint, network error,
  timeout, invalid response) → `null`, render layer falls back to the
  deterministic org chart. Never touches the persistence payload.
- **`src/roadmap-personalization.js`** (ADR-015): asks
  `AI_FOOTPRINT_ROADMAP_ENDPOINT` to rewrite only the 4 prose gaps of the
  current jump's entry (`whatUnlocks`/`steps`/`tips`/`mistakes`); tier,
  band, the "upgrade when" criterion and the copyable snippet are never
  part of the request and never touched. Only derived signals go out
  (frameworks, tool/MCP categories, agent names+counts, automations) —
  never raw file content or agent descriptions. Any failure → curated
  content verbatim, same resilience invariant as agent-synthesis.
- Both use `src/terminal-progress.js`'s spinner, shown only when the call
  will actually be attempted (agents exist / a jump exists AND the
  relevant endpoint is configured) — otherwise no misleading "in
  progress" message.

### Agent card description ("always present, never blank")

Priority chain in `src/render-html.js`/`src/render-terminal.js`'s
`buildAgentCardTree`: (1) the synthesis result's `whatItDoes` if the
ephemeral call succeeded for that agent; else (2) the agent's own raw
`.claude/agents/*.md` frontmatter `description`, cleaned of YAML/escape
artifacts (`cleanRawDescription`) and excerpted to first-sentence-or-160-
chars-whichever-shorter (`excerptForCard`) — **local-only display**, this
raw text is never sent anywhere by this path (`scrubSecrets` is
deliberately NOT applied here — it was found to mangle legitimate file
paths in real descriptions; it's still applied on the actual
agent-synthesis network request); else (3) a minimal name-derived
last-resort line. Never a wall of raw system-prompt text, never blank.

### Implementation prompt (`src/roadmap-prompt.js`)

Deterministic, ready-to-paste text template — never a second LLM call —
assembled from the roadmap entry (curated or ADR-015-personalized, this
module doesn't know or care which) plus already-derived signals
(frameworks, detected tool names, tier). `--lang` controls this
independently of the OS-locale-driven report language would suggest, but
in practice both share the SAME `lang` value resolved once in
`bin/report.js` — there is one language axis for the whole run, the prompt
included. Has its own "Copy" button in the HTML report (inline JS, reads
`textContent`, `navigator.clipboard` with `execCommand` fallback, zero
network).

## 5. i18n (`src/i18n.js`, `src/locale.js`)

- `detectReportLang()`: `LC_ALL` → `LANG` → `LANGUAGE` → macOS
  `AppleLocale` → `Intl` → `null`. Any resolved code starting with `es` →
  Spanish; anything else (including "no locale detected") → English. Only
  `es`/`en` are supported; `en` is the universal fallback.
- `getCatalog(lang)` returns the full resolved catalog. `tierName(tierKey,
  lang)` is the sanctioned way to get a localized tier name (never
  `tier-engine.js`'s raw field).
- **Audited for zero Spanish leakage under a non-Spanish OS locale**
  (`test/i18n-no-spanish-audit.test.js`, plus a real e2e
  `LANG=en_US.UTF-8` CLI run in `test/bin-report-cli.test.js`): tier names,
  the tier analysis section, section headings/labels, notices, and the
  fully-authored English roadmap content all render in English. The one
  legitimate exception: a talent's own raw agent description
  (`.claude/agents/*.md` frontmatter) is THEIR authored content, not CLI
  copy, and is correctly out of scope for this audit.
- `install.sh` is **not** part of this i18n layer at all — it runs before
  Node is available, so it's unconditionally English regardless of OS
  locale (translated as a standalone pass, see git history on this
  branch).
- **Known gap, not yet fixed**: `bin/report.js#help()`'s `--help` text is a
  hardcoded Spanish string, not routed through `src/i18n.js` — unlike every
  other CLI-owned string, it does not respect `--lang`/OS locale. It's also
  missing the `--consent-status`/`--consent-revoke`/`--consent-email`
  flags from its own listing. Flagged here for whoever picks this up next;
  out of scope for the docs-only pass that produced this file.

## 6. Data flow and payload (`src/share.js#derivePayload`)

Every field is rebuilt explicitly (never spread) so an unexpected extra key
on an upstream object can never reach the payload. Current whitelist:
`schemaVersion, generatedAt, anonId, platform, level, levelName, score,
totalDetected, categories, tools[{id, detected, depth}], agents[{name,
tools, model, parent}], agentCounts, technologies, agentSynthesis[{name,
symbolicName, whatItDoes}], tier, tierKey, mcp{countsByCategory, total},
memory{totalImports, maxDepth, layered}, automations{scripts, jsonPiping,
schedulers}, browserTools{detected, count, via{dependency, mcp}}`.

Explicitly **excluded by design**: MCP server *names*
(`report.mcp.servers` — issue 015: names stay local-only), per-file memory
detail (`report.memory.files`), browser-tool *names* (`via` ships as origin
booleans only), any agent description/prompt text, `tool.version` (re-
identification risk), `tool.recency`/mtime (activity-monitoring risk,
explicitly gated pending further legal review if ever proposed), and
`environment.editorsInstalled` (fingerprinting risk). See the file's own
PENDING DECISION comment block for the per-field reasoning if any of these
is ever proposed for inclusion — each requires an explicit human decision
first, documented in `decisions.md` if cross-role.

`band` was deliberately dropped from the payload (redundant with `level`,
which the backend already treats as the band) — only `tier`/`tierKey` (the
finer T0-T7 axis) are new relative to the pre-level-up contract.

The `anonId` is a non-reversible hash of hostname+user, for deduplication
only. The email travels OUTSIDE this whitelisted payload, in the request
body: `{email, payload}`.

## 7. Lifecycle for the talent

Every run: the report is generated and shown locally, always, unconditionally.

First run only (no consent decision persisted yet), shown **after** the
report: a short yes/no question (`src/consent-flow.js`).
- **Accept** → asks for an email (basic format validation, no
  verification — `email_verified` is conceptually always false), sends
  `{email, payload}` once immediately, persists `consent=granted` + email.
  Every following run resends silently (`src/share.js#autoShare`, max once
  per hour, client-side throttle — independent of the server's own
  email+IP rate limit).
- **Decline** → persists `consent=denied`. Local report only, forever,
  unless the talent explicitly re-engages via a management command.

Management, any time, without re-running the scan or the prompt:
- `--consent-status` — decision / email / last send.
- `--consent-revoke` — revoke (→ `denied`); keeps the stored email (a
  later re-grant doesn't require retyping it).
- `--consent-email <email>` — change the email on file without touching
  the decision.

`src/consent-skip.js` makes every reason the prompt is or isn't shown this
run **explicit** (already-persisted decision — by far the most common —
non-interactive stdin still attempted, not skipped outright, since a piped
answer is legitimate).

## 8. Server contract (reference stub, `reference-server/server.js`)

- `POST /reports` — public, no per-identity auth. Body `{email, payload}`.
  201 ok / 400 invalid shape or email / 429 rate-limited (per normalized
  email AND per IP).
- `POST /works/ai-footprint/agent-synthesis` — public, no auth. Stub is a
  NAIVE deterministic placeholder (title-cases the name, echoes the tool
  list), not a real LLM call — just enough to exercise the CLI's
  request/response contract end to end locally.
- `GET /health` — liveness.
- `GET /admin/reports` (`X-Admin-Key`) — audit listing, in-memory.
- **No kill switch anymore** (ADR-011 retires
  `AI_FOOTPRINT_INGEST_ENABLED` from this stub entirely — consent,
  client-side, is the only control left).

This stub is NOT deployed anywhere (ADR-002). The real implementation of
this contract is `shakers-hub-backend` (see its own specs.md under
`active-work/talents-ai-score`), not this file — in-memory store, no real
Talent match, no Redis rate limiting, generated admin key: all fine for
local testing, all need replacing for production.

## 9. Current status (tested)

All of the following is covered by the `test/*.test.js` suite (`npm test`,
zero-dependency `node:test`) and/or has been verified end to end locally:

- Scan + tier classification across the full T0-T7 range, including
  boundary cases per tier-engine.js's own criteria table.
- Tier analysis (met/blocking criteria) matches `computeTier()`'s logic by
  construction.
- Roadmap content: both `es` and `en` fully populated for every tier jump,
  parity-checked (`test/roadmap-content.test.js`); the copyable
  implementation prompt (`test/roadmap-prompt.test.js`) and its HTML "Copy"
  button (`test/render-html-roadmap.test.js`).
- i18n: catalog key-path parity between `es`/`en`
  (`test/i18n-catalog-parity.test.js`) and a zero-Spanish-under-English-
  locale audit, both a rich synthetic sweep and a real
  `LANG=en_US.UTF-8` e2e CLI run (`test/i18n-no-spanish-audit.test.js`,
  `test/bin-report-cli.test.js`).
- Agent org chart, MCP/memory/automations/browser-tools detectors, project
  ∪ home scope, each with a dedicated `scanner-*.test.js` companion.
- Agent-card description priority chain (synthesis > cleaned raw > name
  fallback) and the ephemeral synthesis/roadmap-personalization clients'
  resilience to every failure mode (no endpoint, network error, timeout,
  invalid response) — `agent-synthesis.test.js`,
  `roadmap-personalization.test.js`.
- Consent flow: prompt shown once, accept→email→send→silent resend,
  decline→never asked again, malformed email re-prompts without
  persisting, no network → decision still persists, send fails silently.
- Consent management: `--consent-status`, `--consent-revoke`,
  `--consent-email`.
- Server rejections (reference stub): 400/429; no `Authorization` header
  anywhere in the client or the stub.
- `install.sh`: install-by-copy and `--uninstall`, fully in English
  regardless of the invoking shell's locale; installer logic (Node
  detection, dynamic `src/*.js` discovery, path handling) unchanged by the
  English-only text pass.

## 10. Configuration pending to be filled in

- `install.sh`: `OWNER`/`REPO`/`BRANCH` — recheck against the real public
  repo if this doc is out of date.
- CLI: `AI_FOOTPRINT_INGEST_ENDPOINT`, `AI_FOOTPRINT_SYNTHESIS_ENDPOINT`,
  `AI_FOOTPRINT_ROADMAP_ENDPOINT` — none has a default; each degrades
  gracefully when unset.
- Server (reference stub only): `ADMIN_KEY`, `PUBLIC_URL`, `PORT`.

## 11. Suggested next steps

- Route `bin/report.js#help()` through `src/i18n.js` (currently hardcoded
  Spanish, unlike every other CLI-owned string) and add the missing
  `--consent-*` flags to its own listing — see the "known gap" note in §5.
- Implement the real ingestion + agent-synthesis contracts in
  `shakers-hub-backend` per its own specs.md (Data model, API contracts,
  email↔Talent match, a real model call for agent synthesis).
- Decide whether `tool.footprint`/`environment.arch`/`.nodeVersion` (see
  the PENDING DECISION block in `src/share.js#derivePayload`) should join
  the persisted whitelist — each needs an explicit human call, not a
  default-on.
- Legal/labor go-ahead specifically for the **production rollout** against
  real Shakers talents (distinct from the design-level sign-off already
  reported for ADR-011/013 — see §5 there): confirm before flipping on
  real sending in production, since that's when real personal-data
  processing at scale begins.
- Retention/purge policy for "lead" emails (non-Talent submissions) — no
  Talent-deletion hook reaches them today; open question already flagged
  in `shakers-hub-backend`'s specs.md.
