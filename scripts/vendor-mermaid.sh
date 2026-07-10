#!/usr/bin/env bash
# Refreshes vendor/mermaid.min.js from the official jsDelivr CDN build.
# Not run automatically by anything (install.sh stays npm-install-free and
# network-free at install time) — a maintainer runs this deliberately when
# bumping the pinned Mermaid version (see vendor/README.md).
set -euo pipefail

VERSION="${1:-10.9.1}"
URL="https://cdn.jsdelivr.net/npm/mermaid@${VERSION}/dist/mermaid.min.js"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/vendor/mermaid.min.js"

echo "Fetching mermaid@${VERSION} from ${URL} ..."
curl -fsSL --max-time 30 "${URL}" -o "${DEST}"

echo "Done. New size and checksum (update vendor/README.md with both):"
du -h "${DEST}"
shasum -a 256 "${DEST}"
