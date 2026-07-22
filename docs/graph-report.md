# Graph report — frozen contracts

Status: **frozen** (this document is the source of truth for the LOCAL graph
report, its data contract, and the hybrid generation of that data). Renderer:
`src/render-graph.js` (+ `src/templates/graph-report.html`). Generator:
`src/graph-generator.js`. Visual spec: the approved `mockup-report-v2.html`.

## The two reports (command split)

The old single `report` command is split into two, so it is explicit which one
you generate. Neither clashes with `share` (the branded LinkedIn footprint card).

| Command | Report | Audience | Contents |
|---|---|---|---|
| **`map`** | LOCAL report (graph protagonist, v2) | the talent, kept locally | Interactive AI/codebase graph as the hero + footprint & certifications as toggleable side drawers. Full detail. |
| **`sheet`** | SHAREABLE report (footprint + certs, no graph) | pass-by-hand to a client/team | Two-column footprint + certifications, **no graph** (= the v1 `mockup-report.html` layout). A local HTML file the talent shares manually. |

- `report` remains as a back-compat alias of **`sheet`** (same
  `materializeProjectReport` behaviour) until removed.
- **No hosting / public URL.** Both are local self-contained `.html` files.
  Hosting a shareable URL is a separate, deferred feature.

## 1. Graph JSON contract (foglamp shape) — FROZEN

The renderer consumes exactly this envelope (a superset of the foglamp scan
contract plus the report `footprint`/`certs`/`favicons` extras):

```jsonc
{
  "version": 1,
  "project": { "name", "slug", "tagline?", "iconDomain?", "date" },
  "stats":   { "agents", "models", "tools", "integrations" },      // integer counts
  "topModels":       [{ "id", "label", "domain?" }],               // ≤ 3
  "topTools":        [{ "id", "label", "domain?" }],               // ≤ 10
  "topIntegrations": [{ "id", "label", "domain?" }],               // ≤ 10
  "graph": {
    "nodes": [{ "id", "label", "kind", "sub?", "domain?", "detail?", "sourceRef?", "group?" }], // ≤ 60
    "edges": [{ "from", "to", "kind?", "label?" }]                                              // ≤ 120
  },
  // report extras (LOCAL report only)
  "footprint": { … } | null,   // tier, ladder, summary, tools[], technologies[]
  "certs":     { agents:[…], skills:[…], pnScaleNote? } | null,
  "favicons":  { "<domain>": "data:image/…;base64,…" } | null
}
```

- **node `kind`** ∈ `entry | cron | agent | model | tool | service | store | external`
- **edge `kind`** ∈ `calls | reads | writes | triggers` (default `calls`)
- **field length caps**: node `label` ≤ 28, `sub` ≤ 40, edge `label` ≤ 24,
  `detail` ≤ 200 (enforced by the generator via `clampStr`).
- `favicons` are inlined as `data:` URIs **at generation time** so the opened
  report is **zero-network at view time**. Missing entry ⇒ colored monogram.
- **Agent autonomy scale is P1–P5** (the real proficiency ladder; `none`, then
  P1…P5 = increasing autonomy/reliability). The mockup's P0–P4 is superseded.
  `certs.agents[].level` carries `P1`…`P5`; `certs.pnScaleNote` is the caption.

## 2. Hybrid generation contract — FROZEN

`generateGraph({ scan, llm, onTrace }) -> foglampContract` (`src/graph-generator.js`).
Two layers:

### 2a. Deterministic (authoritative)
From our own detectors. Input `scan`:

```jsonc
{
  "project": { "name","slug","tagline?","iconDomain?","date?" },
  "agents":  [{ "id","label","model?|toolId?","group?","sub?","detail?","sourceRef?" }],
  "models":  [{ "id","label","domain?","provider?","sub?" }],
  "tools":   [{ "id","label","domain?","sub?","detail?" }],        // external AI microservices
  "integrations": [{ "id","label","domain?","sub?","group?" }],    // 3rd-party integrations
  "technologies": ["…"],
  "entrypoints?": ["…paths…"], "stores?": ["…hints…"]
}
```

Produces the `model` / `tool` / `external` / `agent` nodes and the provable
`agent → model|tool` **calls** edges, plus `stats` and `topX`.

### 2b. LLM pass (enrichment, NON-authoritative)
A model infers the flows/services/stores/entrypoints we can't detect statically.

- **Input**: a **content-free structural summary** (`buildScrubbedSummary`) —
  node ids/labels/kinds/subs/groups, source **paths** (never contents), the
  deterministic edges, and hints. Every string is run through `scrubString`
  (redacts key-prefixes, JWT-ish, long base64, `password/secret/token/api_key/bearer`).
  **Never** source code, secrets, or customer data.
- **Output** (`llm.inferGraph(summary) -> { nodes, edges }`), untrusted:
  the model may only **add** `entry|cron|service|store` nodes and any edges, and
  may **fill** missing `group`/`detail`/`sub` on existing nodes.
- **Merge rules** (`mergeEnrichment`):
  - deterministic nodes are authoritative; the LLM **cannot** introduce
    `agent|model|tool|external` nodes nor override a detected node's `kind`;
  - edges are kept only if **both endpoints exist**; kind validated (bad ⇒
    `calls`); deduped; capped;
  - all caps + length limits re-applied.
- **Failure is graceful**: a throwing/empty LLM pass yields the deterministic
  graph — never a crash, never a fabricated flow.

### Observability & privacy
- **Content-free logs; NO Langfuse.** Instrumentation is emitted via the
  injected `onTrace(evt)` sink: `{ event:'graph.infer', ok, model, inputTokens,
  outputTokens, costUsd, latencyMs, contentFree:true }`. No prompt/response
  content is ever in the event.
- The `llm` port is **injected**, so tests run against a stub (no real Gemini).
  See `test/graph-generator.test.js`.

## Renderer notes
- `renderGraphReport(payload, { lang })` reads the templatized, **verified**
  mockup and injects the payload + run language (`es`/`en`). dagre is embedded
  inline in the template (self-contained; layered LR layout, non-overlapping by
  construction, crossing-reduced).
- Both themes with a toggle (starts light/Shakers). `prefers-reduced-motion`
  respected. Edges animate on load (draw-in) + continuous subtle idle flow;
  click a node ⇒ downstream flow trace + detail drawer.
