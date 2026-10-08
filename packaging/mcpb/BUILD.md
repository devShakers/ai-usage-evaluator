# Building the Shakers AI-Usage `.mcpb` bundle

The `.mcpb` (formerly DXT) bundle is a ZIP with `manifest.json` at its root plus the
server code. It runs the all-in-one server (`node bin/mcpb.js`, every tool, including the
sign-up and the onboarding interview).

## Layout inside the bundle
```
manifest.json          # from packaging/mcpb/manifest.json (keep `version` in sync with package.json)
package.json           # the repo's, so the server reports its version and npm installs the pinned LiveKit
bin/                   # copied from the repo (bin/mcpb.js is the entry: Desktop imports it, so it starts unconditionally)
src/                   # copied from the repo
node_modules/          # @livekit/rtc-node + its deps + the LiveKit native binary of every shipped platform
README.md              # packaging/mcpb/README.md
LICENSE                # repo LICENSE
```
`read_cv` parses PDFs via system binaries (`textutil`/`pdftotext`), not an npm package.
Claude Desktop provides the Node runtime for `type: node` extensions, so no prerequisites.

### LiveKit: one bundle with every platform's binary
The onboarding interview needs `@livekit/rtc-node`, which loads a prebuilt native library from
`@livekit/rtc-ffi-bindings-<platform>`. The build stages `@livekit/rtc-node` at the exact version
`package.json` pins and then extracts the bindings of all five platforms LiveKit publishes and we
ship, at the version rtc-node pins: `darwin-arm64`, `darwin-x64`, `linux-x64-gnu`,
`linux-arm64-gnu`, `win32-x64-msvc`. One `.mcpb` serves every machine.

Tradeoff: the bundle grows to roughly 48 MB (about 16 MB uncompressed per binary) instead of
per-platform bundles, in exchange for one artifact and no npm step on the talent's machine.
Windows ARM has no LiveKit binary (404 on npm). Verified loading: darwin arm64 and x64; not yet
verified: Windows, Linux, inside Claude Desktop, or a real room connection.
If LiveKit still fails to load on a machine, `onboarding_interview_start` sends the talent to the
web interview (`open_web`) and logs `[mcp] livekit-unavailable kind=… os=… arch=…` to stderr,
which Claude Desktop keeps in its MCP server log (there is no telemetry in this package).

## Assemble (official toolchain — `@anthropic-ai/mcpb`)
```bash
npm run build:mcpb        # stages the bundle, then `mcpb pack` (validates manifest + builds)
                          # -> dist/shakers-ai-usage.mcpb
```
`scripts/build-mcpb.sh` stages `manifest.json` (at the archive root) plus `package.json`, `bin/`,
`src/`, `README.md`, `PRIVACY.md`, `LICENSE` and the LiveKit `node_modules/` (needs npm and network),
then runs the **official packer**
`npx -y @anthropic-ai/mcpb@2.1.2 pack <dir> <out>`, which validates the manifest schema and
produces the `.mcpb`. `dist/` is gitignored — the `.mcpb` is a release artifact, not committed.

Useful official commands (https://www.anthropic.com/engineering/desktop-extensions):
- `npx @anthropic-ai/mcpb init` — scaffold a canonical manifest.
- `npx @anthropic-ai/mcpb validate packaging/mcpb/manifest.json` — schema-validate (passes).
- `npx @anthropic-ai/mcpb pack dist/mcpb dist/shakers-ai-usage.mcpb` — validate + build.
- `npx @anthropic-ai/mcpb unpack <file> <dir>` — extract to verify self-contained.
- `npx @anthropic-ai/mcpb sign <file>` — sign for distribution (release step).

Keep `manifest.json.version` synced with `package.json.version` on release.

Before publishing, validate the manifest with the official tool
(`npx @modelcontextprotocol/mcpb validate dist/mcpb/manifest.json`) and keep
`manifest.json.version` synced to `package.json.version`.
