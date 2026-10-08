---
name: ai-usage-evaluator-evidence-emission
description: Phase 2 evidence-based evaluation — the CLI emits cli_scan evidence rows instead of relying on the ADR-055 certs->hub relay; skills wired, agents deferred
metadata:
  type: project
---

# CLI evidence emission for cli_scan (talents-ai-score Phase 2)

The framework moved from "score-and-persist" (certify writes the band; certs
relays to Hub, ADR-055) to **Emit -> Store -> Fuse -> Project**: instruments emit
BLIND evidence rows; a server-side Fuser computes the band and projects it to Hub.

## The endpoint (server: shakers-certifications-service, feat/talents-ai-score)
`POST /api/v1/evidence/cli-scan` — `CliScanEvidenceController` -> `EmitCliScanEvidenceService`.
- Auth: talent login Bearer (ADR-042/044). `talentId` derived from JWT, NEVER body.
- `Idempotency-Key` REQUIRED (400 without) -> `instrument_run_id`; repeat = no-op.
- Body: `{ subjectType, subjectSkillId?|agent?, level, veracity, backings[] }`.
- Server FIXES `provenance='detected'`, `instrument='cli_scan'` — not request fields.
- `veracity:'corroborates'` FORBIDDEN (403): a self-run CLI can't self-corroborate. Only `inconclusive`/`contradicts`/`not_assessable`.
- `level` per-subject enum: skill = `execute_well_defined|own_end_to_end|set_direction`; agent = `nascent|operational|proven`. `backings` max 20, quote <=2000 (detected FACTS only, never source code).
- OPEN DECISION (server docblock too): `level` is still CLI-computed, server does not re-verify yet.

## CLI wiring (this repo)
- `src/config.js#getEvidenceCliScanEndpoint` derives `../evidence/cli-scan` from the ingest base (`.../api/v1/usage/reports` -> `.../api/v1/evidence/cli-scan`), same climb-one-segment pattern as the skills/portfolio relay endpoints. Override `SHAKERS_CLI_EVIDENCE_CLI_SCAN_ENDPOINT`.
- `src/evidence-client.js` — the emitter. Pure mappers + `postCliScanEvidence` (Bearer + Idempotency-Key via `requestBackend`). NEVER throws (best-effort, like `share.js#shareCertification`). Skips cleanly when no endpoint / no talent Bearer (superadmin runs have no login session; the endpoint takes no body token).
- SKILL emission is wired in `bin/certify.js#runCertifyPhase`, AFTER the interview/re-persist, one row per certified Skill, one `runId` per run as the Idempotency-Key. Additive/non-breaking: the CERTIFY call still produces the report and persists server-side, so the relay is NOT torn out (see below).

## Level mappings (CLI-computed)
- Skill `combinedLevel` (Middle/Senior/Expert, from `render-skill-interview.js`) -> `middle=execute_well_defined`, `senior=own_end_to_end`, `expert=set_direction`. Falls back to `codeBand` when no interview. Unmappable -> skip.
- Skill veracity: `inconclusive` normally; `contradicts` when `antifraudCapped` (interview contradicted the code claim). Never `corroborates`.
- Agent P-scale (`i18n.js#levelNames`: none/P1..P5) -> `P1=nascent`, `P2/P3=operational`, `P4/P5=proven`, `none`=skip. (Mapping defined but NOT emitted yet — see below.)

## AGENTS are DEFERRED (two independent blockers) — do not force it
Wiring agent evidence now would create rows that can never reach the profile:
1. NO valid `agent.agentId`. The endpoint wants the HUB agent uuid, but there is no Hub agent entity yet (ADR-054). The CLI only knows the LOCAL org-chart agent name. A synthetic id = orphan evidence.
2. Agent projection is UNIMPLEMENTED server-side: the fuser's agent branch calls `EvidenceProjectionPort.projectFusedBand`, whose adapter `throw new Error('Method not implemented.')`.
A documented TODO sits in `src/certify-agents.js` after `finishWithVerdict`. The existing verdict persist remains the agent profile path.

## Fuser/projection state (certs, as merged on feat/talents-ai-score) — relay decision
- Evidence recorded -> fusion recompute: WIRED (`RecomputeFusionOnEvidenceRecordedListener`, async fire-and-forget, reconcile cron backstop).
- SKILL band: fuses AND live-PATCHes Hub (`/works-ai/talents/:id/skills/:id/band` via `HubApiClient`), BUT depends on Hub receive endpoint #126; until it ships the PATCH fails -> `pending` -> hourly reconcile re-pushes.
- AGENT band: fuses but projection throws (unimplemented).
Because skill projection depends on an unconfirmed Hub #126 and agent projection is unimplemented, the ADR-055 relay was NOT torn out — skill evidence is emitted as the primary path, the existing certify/verdict persist is KEPT as the documented fallback so the talent's profile still updates. Reported to coordinator.
