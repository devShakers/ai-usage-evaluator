#!/usr/bin/env sh
# Builds the all-in-one .mcpb with the official packer, staging @livekit/rtc-node and the LiveKit binary of every shipped platform.
# Optional flavor overrides (all unset => the default stable build):
#   MCPB_OUT            output .mcpb path             (default dist/shakers-ai-usage.mcpb)
#   MCPB_BUNDLE_VERSION manifest "version"            (default: keep the source manifest's)
#   MCPB_DISPLAY_NAME   manifest "display_name"       (default: keep the source manifest's)
#   MCPB_CLI_ENV        baked server.mcp_config.env.SHAKERS_CLI_ENV (e.g. staging | prod)
#   MCPB_ALMA_BASE      baked server.mcp_config.env.SHAKERS_CLI_ALMA_BASE
# MCPB_CLI_ENV is load-bearing for non-dev flavors: the manifest env is the only
# staging/prod signal the bundle's CLI reads (via readEnv(), SHAKERS_CLI_ prefix).
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$ROOT/dist/mcpb"
OUT="${MCPB_OUT:-$ROOT/dist/shakers-ai-usage.mcpb}"
MCPB_VERSION="2.1.2"
LIVEKIT_PLATFORMS="darwin-arm64 darwin-x64 linux-x64-gnu linux-arm64-gnu win32-x64-msvc"

rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"

# Stage the manifest. With no override env set, this is a byte-for-byte copy (default
# stable build unchanged); otherwise apply version / display_name / baked-env overrides.
if [ -n "${MCPB_BUNDLE_VERSION}${MCPB_DISPLAY_NAME}${MCPB_CLI_ENV}${MCPB_ALMA_BASE}" ]; then
  MCPB_SRC_MANIFEST="$ROOT/packaging/mcpb/manifest.json" \
  MCPB_DST_MANIFEST="$STAGE/manifest.json" \
  node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync(process.env.MCPB_SRC_MANIFEST, "utf8"));
  if (process.env.MCPB_BUNDLE_VERSION) m.version = process.env.MCPB_BUNDLE_VERSION;
  if (process.env.MCPB_DISPLAY_NAME)   m.display_name = process.env.MCPB_DISPLAY_NAME;
  if (process.env.MCPB_CLI_ENV || process.env.MCPB_ALMA_BASE) {
    m.server = m.server || {};
    m.server.mcp_config = m.server.mcp_config || {};
    const env = Object.assign({}, m.server.mcp_config.env);
    if (process.env.MCPB_CLI_ENV)   env.SHAKERS_CLI_ENV = process.env.MCPB_CLI_ENV;
    if (process.env.MCPB_ALMA_BASE) env.SHAKERS_CLI_ALMA_BASE = process.env.MCPB_ALMA_BASE;
    m.server.mcp_config.env = env;
  }
  fs.writeFileSync(process.env.MCPB_DST_MANIFEST, JSON.stringify(m, null, 2) + "\n");
  '
else
  cp "$ROOT/packaging/mcpb/manifest.json" "$STAGE/manifest.json"
fi
cp "$ROOT/packaging/mcpb/README.md"     "$STAGE/README.md"
cp "$ROOT/packaging/mcpb/PRIVACY.md"    "$STAGE/PRIVACY.md"
cp "$ROOT/LICENSE"                      "$STAGE/LICENSE"
cp "$ROOT/package.json"                 "$STAGE/package.json"
cp -R "$ROOT/bin" "$STAGE/bin"
cp -R "$ROOT/src" "$STAGE/src"

# The only runtime dependency, at the exact version package.json pins (the host's own binary comes with it).
(cd "$STAGE" && npm install --omit=dev --no-package-lock --no-audit --no-fund >/dev/null)

# rtc-node pins its FFI bindings exactly; add every platform's prebuilt binary at that same version.
FFI_VERSION="$(node -p "require('$STAGE/node_modules/@livekit/rtc-ffi-bindings/package.json').version")"
TGZ="$ROOT/dist/livekit-tgz"
rm -rf "$TGZ" && mkdir -p "$TGZ"
for PLATFORM in $LIVEKIT_PLATFORMS; do
  NAME="@livekit/rtc-ffi-bindings-$PLATFORM"
  FILE="$(cd "$TGZ" && npm pack "$NAME@$FFI_VERSION" --silent)"
  DEST="$STAGE/node_modules/@livekit/rtc-ffi-bindings-$PLATFORM"
  rm -rf "$DEST" && mkdir -p "$DEST"
  tar -xzf "$TGZ/$FILE" -C "$DEST" --strip-components=1
done
rm -rf "$TGZ"

# `mcpb pack` validates manifest.json (at the archive root) then zips the directory.
npx -y "@anthropic-ai/mcpb@${MCPB_VERSION}" pack "$STAGE" "$OUT"
echo "built $OUT (LiveKit FFI $FFI_VERSION: $LIVEKIT_PLATFORMS)"
