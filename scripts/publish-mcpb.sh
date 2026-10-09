#!/usr/bin/env sh
# Publish a built .mcpb to the PUBLIC GitLab "downloads" project's Generic Package
# Registry, versioned. That downloads project holds artifacts only (no source),
# so its public visibility never exposes this repo's code.
#
# Each publish uploads TWO generic package versions under the channel's name:
#   <version>  immutable, the audited release (refuses to overwrite an existing one)
#   latest     overwritten every publish, the stable URL the front points at
# Channel -> package name:
#   stable  -> shakers-ai-usage
#   staging -> shakers-ai-usage-staging
#
# Public download URL (anonymous, because the downloads project is public):
#   $GITLAB_HOST/api/v4/projects/$PROJECT_ID/packages/generic/<name>/<version>/shakers-ai-usage.mcpb
#
# Required env:
#   GITLAB_HOST   e.g. https://git.shakers.tools
#   PROJECT_ID    numeric id of the public downloads project
#   GITLAB_TOKEN  token with write_package_registry on that project (a project
#                 access token locally; in CI use CI_JOB_TOKEN with a JOB-TOKEN
#                 header instead). Downloaders need NO token.
#
# Usage: scripts/publish-mcpb.sh <stable|staging> <path-to.mcpb>
set -e

CHANNEL="${1:?usage: publish-mcpb.sh <stable|staging> <file.mcpb>}"
FILE="${2:?usage: publish-mcpb.sh <stable|staging> <file.mcpb>}"
[ -f "$FILE" ] || { echo "no existe el fichero: $FILE" >&2; exit 1; }
case "$CHANNEL" in
	stable)  NAME=shakers-ai-usage ;;
	staging) NAME=shakers-ai-usage-staging ;;
	*) echo "canal invalido: '$CHANNEL' (usa stable | staging)" >&2; exit 1 ;;
esac

: "${GITLAB_HOST:?falta GITLAB_HOST}"
: "${PROJECT_ID:?falta PROJECT_ID}"
: "${GITLAB_TOKEN:?falta GITLAB_TOKEN}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
BASE="$GITLAB_HOST/api/v4/projects/$PROJECT_ID/packages/generic/$NAME"
FNAME=shakers-ai-usage.mcpb

upload() { # upload <version-segment>
	code=$(curl -s -o /tmp/mcpb_publish.out -w '%{http_code}' \
		--header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
		--upload-file "$FILE" "$BASE/$1/$FNAME")
	case "$code" in
		200|201) ;;
		*) echo "fallo subiendo $NAME/$1 (HTTP $code)" >&2; cat /tmp/mcpb_publish.out >&2; exit 1 ;;
	esac
}

# Immutability guard: a cut version is never re-uploaded.
exists=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$VERSION/$FNAME")
[ "$exists" = 200 ] && { echo "ya publicado $NAME v$VERSION — sube 'version' en package.json antes de publicar" >&2; exit 1; }

upload "$VERSION"
upload "latest"
echo "publicado $CHANNEL v$VERSION:"
echo "  version (inmutable): $BASE/$VERSION/$FNAME"
echo "  latest  (alias)    : $BASE/latest/$FNAME"
