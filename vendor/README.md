# vendor/

Third-party assets embedded **inline, verbatim** into the local HTML report
(zero network calls at render time — ADR-010's "mermaid.js inline,
cero-red"). Not installed via npm (this repo runs `npm install`-free,
HANDOFF §3): vendored as a plain checked-in file, refreshed manually with
`scripts/vendor-mermaid.sh`.

## mermaid.min.js

- **Source:** `https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js`
  (official UMD/global build — exposes `window.mermaid`, no ESM `import`
  needed, so it drops into a single inline `<script>` tag with no bundler).
- **Version pinned:** `10.9.1`.
- **License:** MIT (Mermaid project, © Knut Sveidqvist and contributors).
- **Size:** ~3.2 MB minified, unmodified. This is a KNOWN, ACCEPTED cost
  (talents-ai-score, ADR-010/011): every local `report.html` this CLI
  generates grows by this size in exchange for a zero-network, fully
  offline-openable diagram. Not shrunk/tree-shaken here — do that only with
  an explicit follow-up decision (Mermaid's build doesn't offer a
  official trimmed "flowchart-only" bundle for this version out of the box).
- **Integrity:** `sha256:61b335a46df05a7ce1c98378f60e5f3e77a7fb608a1056997e8a649304a936d6`
  (recompute with `shasum -a 256 vendor/mermaid.min.js` after any refresh).

## Refreshing

```bash
./scripts/vendor-mermaid.sh [version]   # defaults to the pinned version above
```

Review the diff before committing — this is the one place in the repo where
a large, unreadable third-party blob is deliberately checked in; keep the
version bump and its rationale visible in the commit message, not silent.
