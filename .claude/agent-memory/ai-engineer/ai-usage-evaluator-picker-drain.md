---
name: ai-usage-evaluator-picker-drain
description: CLI raw-mode picker leaves a residual Enter on the shared stdin reader; the next prompt must drain it, and single-shot ask() gates no-op if they don't
metadata:
  type: project
---

# Picker-residual-Enter drain discipline (ai-usage-evaluator CLI)

The interactive single-select picker (`src/interactive-select.js#runInteractiveMultiSelect`) is driven by suspending the shared line reader, taking over raw stdin, then resuming: `ask.suspend()` -> raw stdin -> `ask.resume()`. That mode switch can leave a stray keystroke queued — an ordinary double-Enter confirming the pick — which the fresh readline created by `resume()` delivers into the reader's queue as an empty line, silently pre-answering the NEXT prompt. `src/stdin-ask.js` exposes `ask.drain()` (clears the queue without ending the stream) specifically for this; its docblock documents the whole mechanism.

**Why:** two prompt styles react differently to that stray empty line, which is what makes bugs here asymmetric and hard to spot:
- SINGLE-SHOT gate (one `await ask()`, no retry): reads the empty line, fails its yes-check, and returns — a silent no-op. Example: `src/certify-agents.js`'s ADR-001 disclaimer (`YES.test((await ask(prompt)).trim())`, ~line 585).
- RETRY-LOOP gate: absorbs the empty line as one "invalid answer" and re-asks (up to 5). Example: `confirmDisclaimerAcceptance` (`src/certify-disclaimer.js`), used by `certify skills`. It survives an undrained residual, masking the missing drain.

**How to apply:** every call site that runs the raw picker must drain the shared `ask` before the chosen action's first prompt. `bin/certify.js#run()` does it after `chooseCertifyTarget` (guarded `if (typeof ask.drain === 'function') ask.drain()`). If you add a new menu/picker entry, drain right after `ask.resume()`, co-located with the mode switch — do NOT rely on the downstream gate having a retry loop.

## Concrete bug fixed (talents-ai-score)
`bin/start.js`'s `start` menu (`chooseMenuItem`) ran the raw picker but never drained. "certify agents" from the menu dispatched `runCertifyAgents` correctly (verified: same args as the direct command, `(['--root',X], {ask})`), but its single-shot disclaimer consumed the residual empty line and declined -> silent return to the menu. "certify skills" worked from the same menu only because its disclaimer retries. Fix: drain inside `chooseMenuItem`'s suspend branch right after `ask.resume()` — convergent with `bin/certify.js`, fixes every menu action, not just agents. The direct `certify agents` (subcommand path) was never broken because no raw picker precedes it.

Reproduction seam: feed `runCertifyAgents` a scripted ask of `['', 's', '1']` vs `['s','1']` — the former asks once and prints "Cancelado. No se ha enviado nada."; the latter proceeds past the gate into the agent picker/open.
