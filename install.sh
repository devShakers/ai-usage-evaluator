#!/usr/bin/env bash
#
# Shakers — installer
#
# Quick usage (from anywhere):
#   curl -fsSL https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/release/install.sh | bash
#
# Or, if you've cloned the repo, from inside the folder:
#   ./install.sh
#
# The script detects whether the files are local (installs by copying) or
# not (downloads them from the repo). When done it leaves the `shakers`
# command available. Uninstall: ./install.sh --uninstall
#
set -euo pipefail

# ─── Configuration (EDIT THIS with your real org/repo) ─────────────────────
OWNER="devShakers"
REPO="ai-usage-evaluator"
# "Distribution only" PoC (active-work/talents-ai-score, ADR-002): the CLI
# already lives on release (the curl | raw.githubusercontent one-liner resolves
# files by branch, so the installer breaks if BRANCH doesn't match the
# branch published on the remote).
BRANCH="release"
# Immutable-ref pin (installer integrity hardening): leave empty to install
# from $BRANCH (the mutable default, current behaviour). Set to a full commit
# SHA to pin every download to that exact tree regardless of what `main`
# later becomes — closes the "curl|bash always fetches whatever main is
# TODAY" exposure without needing a signing key (none assigned yet, ADR-001).
# Overridable per-run via SHAKERS_CLI_INSTALL_REF (legacy AI_FOOTPRINT_INSTALL_REF
# still honoured) for one-off pinned installs without editing this file.
PIN_REF="${SHAKERS_CLI_INSTALL_REF:-${AI_FOOTPRINT_INSTALL_REF:-}}"
REF="${PIN_REF:-$BRANCH}"
# ───────────────────────────────────────────────────────────────────────────

RAW="https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}"
INSTALL_DIR="${SHAKERS_CLI_HOME:-${AI_FOOTPRINT_HOME:-$HOME/.shakers}}"
BIN_DIR="${SHAKERS_CLI_BIN:-${AI_FOOTPRINT_BIN:-$HOME/.local/bin}}"
VERSION="0.1.0"

# talents-ai-score, ADR-042: the CLI talks to ONE backend,
# sh-web-works-certifications. The installer writes no endpoint unless a hosted
# base is given (SHAKERS_CLI_CERTS_BASE below): the CLI's built-in defaults
# point at the deployed backend, and every endpoint derives from it.
# The config dir mirrors src/config-dir.js (SHAKERS_CLI_CONFIG_DIR override, legacy
# AI_FOOTPRINT_CONFIG_DIR still honoured, else ~/.config/shakers). ADR-045: the
# CLI migrates an existing ~/.config/ai-footprint to ~/.config/shakers on first
# boot, so an upgrading Talent keeps their config/consent/login session.
CONFIG_DIR="${SHAKERS_CLI_CONFIG_DIR:-${AI_FOOTPRINT_CONFIG_DIR:-$HOME/.config/shakers}}"
CONFIG_FILE="$CONFIG_DIR/config.json"

# Colors (only if output is a terminal)
if [ -t 1 ]; then
  C='\033[0;36m'; G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'
else
  C=''; G=''; Y=''; R=''; B=''; N=''
fi

# ─── Distribution profile (talents-ai-score, ADR-058 fase 1) ────────────────
# `SHAKERS_PROFILE` gates the CLI SURFACE (src/config.js#getProfile,
# src/command-graph.js): `external` = only `usage` (local report), the
# default for the public `curl|bash`; `talent` = the full surface built in
# this unit (start/login/certify/…). This is the ONE installer for BOTH
# paths — the certs-served, token-gated wrapper for a real Talent execs THIS
# SAME script with `SHAKERS_PROFILE=talent` exported, rather than shipping a
# second installer that could drift from this one.
#
# An unrecognized value falls back to `external` (fail SAFE — the narrower
# surface — rather than silently granting the fuller one on a typo).
SHAKERS_PROFILE="${SHAKERS_PROFILE:-external}"
case "$SHAKERS_PROFILE" in
  external|talent) ;;
  *)
    printf "  ${Y}Note:${N} unrecognized SHAKERS_PROFILE=\"%s\" — defaulting to external.\n" "$SHAKERS_PROFILE"
    SHAKERS_PROFILE="external"
    ;;
esac

# Fixed top-level files. Everything under bin/ and src/ is discovered and
# copied as a whole below — NOT listed one by one here — precisely so a new
# module or command (like the i18n.js/locale.js pair, or the register/
# onboarding commands) never goes missing from an install by being left off a
# hardcoded list. `shakers` is the only launcher created; the other bin/*.js
# entry points are dispatched by bin/shakers.js.
FILES=(
  "package.json"
  "README.md"
)

# NATIVE DEPENDENCY — nothing to COPY here, but the installer FETCHES it post-verify
# (see the LiveKit step after the manifest check). The LiveKit interview lazy-requires
# @livekit/rtc-node — a native-FFI package declared under package.json `dependencies`
# and resolved at runtime from $INSTALL_DIR/node_modules. This copy+SHA-256-manifest
# bootstrap vendors no source (the package's per-platform prebuilt binary is fetched,
# not copied), so we run `npm install` into $INSTALL_DIR AFTER the manifest is verified
# and the tree is swapped in, keeping node_modules out of the manifest. Installed for
# EVERY flavor now; the fetch is non-fatal (a failure only disables the interview).
# npm/npx installs of the package pull it automatically via `dependencies`.

# Non-.js assets under src/ that the src/*.js discovery below does NOT pick up
# but that modules read at runtime (e.g. the shareable report HTML template that
# render-sheet.js loads). Ship these explicitly.
ASSETS=(
  "src/templates/report-sheet.html"
)

say()  { printf "  %b\n" "$1"; }
die()  { printf "  ${R}✗ %b${N}\n" "$1" >&2; exit 1; }

uninstall() {
  printf "\n  ${B}${C}Shakers — uninstall${N}\n\n"
  rm -rf "$INSTALL_DIR" && say "${G}+${N} removed $INSTALL_DIR"
  rm -f "$BIN_DIR/shakers" && say "${G}+${N} removed $BIN_DIR/shakers"
  # ADR-045 clean cut: `sh-eval` is renamed to `shakers`, so the OLD `sh-eval`
  # launcher is removed here too — an upgrade must not leave a stale `sh-eval`
  # shim pointing at a bin/sh-eval.js that no longer exists. (Same reason the
  # pre-ADR-014 `ai-footprint`/`ai-certify` launchers below are swept.)
  rm -f "$BIN_DIR/sh-eval" && say "${G}+${N} removed legacy $BIN_DIR/sh-eval"
  # Legacy launchers from installs before ADR-014's single-entrypoint REPL.
  rm -f "$BIN_DIR/ai-footprint" && say "${G}+${N} removed legacy $BIN_DIR/ai-footprint"
  rm -f "$BIN_DIR/ai-certify" && say "${G}+${N} removed legacy $BIN_DIR/ai-certify"
  # $CONFIG_DIR (~/.config/ai-footprint by default) holds MORE than "reports":
  # config.json (endpoints, consent, and — if `superadmin` was ever run — an
  # authenticated superadmin SESSION TOKEN, src/config.js), report-state and
  # per-project HTML reports (src/report-store.js), and — if an agent-
  # certification interview was interrupted — interview-session.json, which
  # carries a BEARER TOKEN for that interview plus the answer that was in
  # flight (src/interview-session-store.js). Opt-in only: an uninstall is not
  # necessarily "I want my local data gone too", and this directory is the one
  # place that data lives.
  if [ "${1:-}" = "--purge" ]; then
    rm -rf "$CONFIG_DIR" && say "${G}+${N} removed $CONFIG_DIR (config, superadmin session, and local reports)"
    say "\n  ${G}${B}Done.${N} Everything — including config, any superadmin session, and local reports — has been removed.\n"
  else
    say "\n  ${G}${B}Done.${N} Config, any superadmin session, and local reports in $CONFIG_DIR are KEPT."
    say "  Re-run ${C}./install.sh --uninstall --purge${N} (or the curl one-liner + ${C}--uninstall --purge${N}) to remove those too.\n"
  fi
  exit 0
}

[ "${1:-}" = "--uninstall" ] && uninstall "${2:-}"

printf "\n  ${B}${C}Shakers — installer v${VERSION}${N}\n"
if [ "$SHAKERS_PROFILE" = "talent" ]; then
  say  "${C}local-first developer AI tools, in one branded shell${N}"
  say  "  ${B}shakers${N}       opens an interactive Shakers shell with these commands:"
  say  "  ${B}usage${N}         scans your machine and current project for AI tooling"
  say  "                (assistants, MCP servers, agents, hooks, custom skills/"
  say  "                commands) and scores your setup on a T0-T7 maturity ladder,"
  say  "                with a curated roadmap and a copy-paste prompt to level up."
  say  "  ${B}certify${N}       certifies your skills from your actual project code: it"
  say  "                maps your stack to Shakers Skills and returns a per-skill"
  say  "                assessment. Code is sampled, secret-scrubbed, sent for"
  say  "                analysis, and never stored."
  say  "  ${B}report${N}        opens the full shareable HTML report for this project"
  say  "                (usage + certified skills) in your browser."
  say  "  ${B}share${N}         turns your usage result into a branded card (built"
  say  "                offline; PNG exported in your browser) to post on LinkedIn."
  say  ""
else
  # ADR-058 fase 1 (widened by the dueño, 2026-08-12): the `external` profile's
  # surface is usage/report/share — the pre-pivot public surface — so the
  # pre-flight description mirrors THAT instead of pitching the talent-only
  # commands (certify/start/login) this install never exposes.
  say  "${C}a local-first CLI that scans your machine for AI tooling${N}"
  say  "  ${B}shakers${N}       opens an interactive shell with these commands:"
  say  "  ${B}usage${N}         scans your machine and current project for AI tooling"
  say  "                (assistants, MCP servers, agents, hooks, custom skills/"
  say  "                commands) and builds a private, LOCAL report. Nothing"
  say  "                leaves your machine unless you choose to share it."
  say  "  ${B}report${N}        opens the full shareable HTML report for this project"
  say  "                in your browser."
  say  "  ${B}share${N}         turns your usage result into a branded card (built"
  say  "                offline; PNG exported in your browser) to post on LinkedIn."
  say  ""
fi

# ─── Requirements ───────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js is required and not installed.\n    Install it from https://nodejs.org (v18 or higher)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node 18+ is required. You have $(node -v)."
say "${G}+${N} Node $(node -v) detected"

# Local install (cloned repo) or remote (curl)?
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo '')"
LOCAL=0
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/bin/shakers.js" ]; then
  LOCAL=1
  say "${G}+${N} Files found locally — installing by copy"
else
  command -v curl >/dev/null 2>&1 || die "curl is required for remote installation."
  say "${G}+${N} Installing from ${OWNER}/${REPO}@${REF}"
fi

# ─── Discover src/ modules ──────────────────────────────────────────────────
# Read live, never hardcoded: locally we list the actual directory; remotely
# we ask the GitHub Contents API (Node, already a hard requirement, parses
# the JSON — no jq dependency added). This is what makes adding a module to
# src/ safe: nothing here needs to change for it to be picked up.
SRC_FILES=()
if [ "$LOCAL" -eq 1 ]; then
  for f in "$SCRIPT_DIR"/src/*.js; do
    [ -e "$f" ] && SRC_FILES+=("$(basename "$f")")
  done
else
  API_URL="https://api.github.com/repos/${OWNER}/${REPO}/contents/src?ref=${REF}"
  SRC_JSON="$(curl -fsSL "$API_URL")" \
    || die "Could not list src/ via the GitHub API (${API_URL}).\n    Check your connection or the script's OWNER/REPO/BRANCH config."
  while IFS= read -r name; do
    SRC_FILES+=("$name")
  done < <(printf '%s' "$SRC_JSON" | node -e '
    let data = "";
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => {
      let items;
      try { items = JSON.parse(data); } catch { items = []; }
      if (!Array.isArray(items)) items = [];
      for (const item of items) {
        if (item && item.type === "file" && /\.js$/.test(item.name)) {
          console.log(item.name);
        }
      }
    });
  ')
fi
[ "${#SRC_FILES[@]}" -gt 0 ] || die "No modules found in src/.\n    Check OWNER/REPO/BRANCH in install.sh, or that the local checkout has the src/ folder."

BIN_FILES=()
if [ "$LOCAL" -eq 1 ]; then
  for f in "$SCRIPT_DIR"/bin/*.js; do
    [ -e "$f" ] && BIN_FILES+=("$(basename "$f")")
  done
else
  BIN_API_URL="https://api.github.com/repos/${OWNER}/${REPO}/contents/bin?ref=${REF}"
  BIN_JSON="$(curl -fsSL "$BIN_API_URL")" \
    || die "Could not list bin/ via the GitHub API (${BIN_API_URL}).\n    Check your connection or the script's OWNER/REPO/BRANCH config."
  while IFS= read -r name; do
    BIN_FILES+=("$name")
  done < <(printf '%s' "$BIN_JSON" | node -e '
    let data = "";
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => {
      let items;
      try { items = JSON.parse(data); } catch { items = []; }
      if (!Array.isArray(items)) items = [];
      for (const item of items) {
        if (item && item.type === "file" && /\.js$/.test(item.name)) {
          console.log(item.name);
        }
      }
    });
  ')
fi
[ "${#BIN_FILES[@]}" -gt 0 ] || die "No entry points found in bin/.\n    Check OWNER/REPO/BRANCH in install.sh, or that the local checkout has the bin/ folder."

# ─── Stage the files (installer integrity hardening) ────────────────────────
# Everything is downloaded/copied into a STAGING dir first, never directly
# into $INSTALL_DIR — an interrupted download/copy (network drop, disk full,
# Ctrl-C) only ever leaves stray bytes in staging, never a half-upgraded,
# mixed-version install. A SHA-256 manifest of the staged tree is generated
# and then re-verified against what actually landed after the swap below, so
# corruption introduced by the move itself (or a mismatched partial mirror)
# is caught loudly instead of silently shipping a broken install.
#
# NOT covered (documented, not fixed here — no signing key/owner assigned
# yet, ADR-001 Open Q6): this manifest proves INTERNAL consistency (what got
# installed matches what was staged), not AUTHENTICITY (that the staged bytes
# are what Shakers actually published) — that needs the repo owner to publish
# a detached signature (e.g. `minisign`/`cosign`) alongside each release and
# this script to ship a pinned public key to verify it against.
STAGING_PARENT="$(dirname "$INSTALL_DIR")"
mkdir -p "$STAGING_PARENT"
STAGING_DIR="$(mktemp -d "$STAGING_PARENT/.$(basename "$INSTALL_DIR").staging.XXXXXX" 2>/dev/null || mktemp -d)"
OLD_DIR=""
_install_cleanup() {
  # Runs on ANY exit (success or failure). Only ever touches STAGING_DIR/
  # OLD_DIR — never the live $INSTALL_DIR while it's the current, working one.
  [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ] && rm -rf "$STAGING_DIR" 2>/dev/null || true
  if [ -n "$OLD_DIR" ] && [ -d "$OLD_DIR" ]; then
    if [ ! -d "$INSTALL_DIR" ]; then
      # The swap was interrupted between "move current away" and "move new
      # in" — restore the previous, known-good install rather than leaving
      # the user with NONE.
      mv "$OLD_DIR" "$INSTALL_DIR" 2>/dev/null || true
    else
      rm -rf "$OLD_DIR" 2>/dev/null || true
    fi
  fi
}
trap _install_cleanup EXIT

mkdir -p "$STAGING_DIR/bin" "$STAGING_DIR/src" "$BIN_DIR"
say "\n  Copying files..."
for f in "${FILES[@]}"; do
  dest="$STAGING_DIR/$f"
  mkdir -p "$(dirname "$dest")"
  if [ "$LOCAL" -eq 1 ]; then
    cp "$SCRIPT_DIR/$f" "$dest" || die "Could not copy $f"
  else
    curl -fsSL "$RAW/$f" -o "$dest" || die "Could not download $f\n    Check your connection or the script's OWNER/REPO/BRANCH config."
  fi
  say "    ${G}+${N} $f"
done
for f in "${BIN_FILES[@]}"; do
  dest="$STAGING_DIR/bin/$f"
  if [ "$LOCAL" -eq 1 ]; then
    cp "$SCRIPT_DIR/bin/$f" "$dest" || die "Could not copy bin/$f"
  else
    curl -fsSL "$RAW/bin/$f" -o "$dest" || die "Could not download bin/$f\n    Check your connection or the script's OWNER/REPO/BRANCH config."
  fi
  say "    ${G}+${N} bin/$f"
done
for f in "${SRC_FILES[@]}"; do
  dest="$STAGING_DIR/src/$f"
  if [ "$LOCAL" -eq 1 ]; then
    cp "$SCRIPT_DIR/src/$f" "$dest" || die "Could not copy src/$f"
  else
    curl -fsSL "$RAW/src/$f" -o "$dest" || die "Could not download src/$f\n    Check your connection or the script's OWNER/REPO/BRANCH config."
  fi
  say "    ${G}+${N} src/$f"
done
for f in "${ASSETS[@]}"; do
  dest="$STAGING_DIR/$f"
  mkdir -p "$(dirname "$dest")"
  if [ "$LOCAL" -eq 1 ]; then
    cp "$SCRIPT_DIR/$f" "$dest" || die "Could not copy $f"
  else
    curl -fsSL "$RAW/$f" -o "$dest" || die "Could not download $f\n    Check your connection or the script's OWNER/REPO/BRANCH config."
  fi
  say "    ${G}+${N} $f"
done

# ─── Manifest (generate, then swap, then verify) ────────────────────────────
say "\n  Generating SHA-256 manifest..."
node -e '
  const fs = require("fs");
  const path = require("path");
  const crypto = require("crypto");
  const root = process.argv[1];
  const out = [];
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) { walk(abs, relPath); continue; }
      const hash = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      out.push(`${hash}  ${relPath}`);
    }
  })(root, "");
  fs.writeFileSync(path.join(root, "MANIFEST.sha256"), out.join("\n") + "\n");
' "$STAGING_DIR" || die "Could not generate the install manifest."
say "    ${G}+${N} MANIFEST.sha256 ($(wc -l < "$STAGING_DIR/MANIFEST.sha256" | tr -d ' ') files)"

# Atomic-ish swap: move the CURRENT install aside, move the newly staged tree
# in, then discard the old one. Both moves are same-filesystem renames
# (STAGING_DIR/OLD_DIR are siblings of INSTALL_DIR), so each individually is
# atomic; the tiny gap BETWEEN the two moves is the one window that isn't —
# the EXIT trap above restores the previous install if it's interrupted right
# there, so a failure never leaves the user with no working `shakers` at all.
if [ -d "$INSTALL_DIR" ]; then
  OLD_DIR="$(mktemp -d "$STAGING_PARENT/.$(basename "$INSTALL_DIR").old.XXXXXX" 2>/dev/null || mktemp -d)"
  rmdir "$OLD_DIR" 2>/dev/null || true # mv target must not pre-exist for a clean rename
  mv "$INSTALL_DIR" "$OLD_DIR" || die "Could not move the current install aside for the upgrade."
fi
mv "$STAGING_DIR" "$INSTALL_DIR" || die "Could not move the staged install into place."
STAGING_DIR="" # nothing left for the cleanup trap to remove; it's now $INSTALL_DIR

# Re-verify: the files that actually landed at $INSTALL_DIR must match the
# manifest generated from staging BEFORE the swap — the whole point of the
# manifest is to catch corruption from the move itself, not just trust it.
node -e '
  const fs = require("fs");
  const path = require("path");
  const crypto = require("crypto");
  const root = process.argv[1];
  const manifest = fs.readFileSync(path.join(root, "MANIFEST.sha256"), "utf8").trim().split("\n").filter(Boolean);
  let bad = 0;
  for (const line of manifest) {
    const idx = line.indexOf("  ");
    const expected = line.slice(0, idx);
    const rel = line.slice(idx + 2);
    let actual;
    try {
      actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, rel))).digest("hex");
    } catch {
      actual = null;
    }
    if (actual !== expected) { console.error(`manifest mismatch: ${rel}`); bad++; }
  }
  process.exit(bad ? 1 : 0);
' "$INSTALL_DIR" || die "Installed files do not match the generated manifest — the install may be corrupt. Re-run the installer."
say "    ${G}+${N} Manifest verified against the installed files"

# ─── Native dep for the LiveKit interview (all flavors) ──────────────────────
# The onboarding/certification interview lazy-requires @livekit/rtc-node (native
# FFI, a real package.json dependency now) from $INSTALL_DIR/node_modules. We fetch
# it HERE — after the manifest is verified and the tree is swapped in, so
# node_modules is never part of the SHA manifest. Installed for EVERY profile so a
# clean public install can run the interview. NON-FATAL: if npm is missing or the
# install fails (offline, registry error) we warn and finish; everything except the
# interview still works. SHAKERS_SKIP_NATIVE_INSTALL=1 skips it (offline / tests).
if [ "${SHAKERS_SKIP_NATIVE_INSTALL:-}" != "1" ]; then
  say "\n  Installing the interview engine (LiveKit)..."
  RECOVER="npm install --omit=dev --prefix \"$INSTALL_DIR\" @livekit/rtc-node"
  if ! command -v npm >/dev/null 2>&1; then
    say "  ${Y}Note:${N} npm was not found on your PATH, so the onboarding interview"
    say "  ${Y}engine (@livekit/rtc-node) could not be installed. Everything else works.${N}"
    say "  ${Y}Install npm (it ships with Node), then re-run this installer, or run:${N}"
    say "    ${C}$RECOVER${N}"
  elif npm install --omit=dev --prefix "$INSTALL_DIR" >/dev/null 2>&1; then
    say "    ${G}+${N} Interview engine installed (@livekit/rtc-node)"
  else
    say "  ${Y}Note:${N} could not install the onboarding interview engine"
    say "  ${Y}(@livekit/rtc-node) — you may be offline or the registry is unreachable.${N}"
    say "  ${Y}Everything else works; the onboarding interview stays unavailable until${N}"
    say "  ${Y}you re-run this installer, or run:${N}"
    say "    ${C}$RECOVER${N}"
  fi
fi

# ─── Create the single `shakers` launcher (ADR-014) ─────────────────────────
# The branded REPL is the ONLY command. bin/report.js / bin/certify.js are
# shipped (the REPL imports them) but get NO standalone launcher.
SHIM="$BIN_DIR/shakers"
cat > "$SHIM" <<EOF
#!/usr/bin/env bash
# Runtime prerequisite preflight — a CLEAR message instead of a cryptic
# "node: command not found" / modern-syntax SyntaxError if this install is run
# on a machine where Node is missing or too old (e.g. copied elsewhere).
if ! command -v node >/dev/null 2>&1; then
  printf '\n  shakers: Node.js was not found on your PATH.\n  Install Node 18+ from https://nodejs.org and re-run.\n\n' >&2
  exit 1
fi
_nm="\$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "\${_nm:-0}" -lt 18 ] 2>/dev/null; then
  printf '\n  shakers: Node 18+ is required (found %s).\n  Update Node from https://nodejs.org and re-run.\n\n' "\$(node -v 2>/dev/null || echo none)" >&2
  exit 1
fi
exec node "$INSTALL_DIR/bin/shakers.js" "\$@"
EOF
chmod +x "$SHIM"
say "\n  ${G}+${N} Command created at $SHIM"

# Remove legacy launchers from installs before the single-entrypoint REPL, so
# an upgrade doesn't leave the retired `ai-footprint`/`ai-certify` commands
# lying around pointing at the old direct binaries.
rm -f "$BIN_DIR/sh-eval" "$BIN_DIR/ai-footprint" "$BIN_DIR/ai-certify" 2>/dev/null || true

# ─── Baked default endpoint config ──────────────────────────────────────────
# Write the team default into config.json ONLY if the user has no config yet
# — never clobber an existing one (they may have run --set-endpoint or point at
# prod). This makes a fresh curl|bash / ./install.sh install work against :3004
# with no export and no --set-endpoint: usage, OTP, certify and the ephemeral
# LLM endpoints all derive from it. SEE THE PRE-DEPLOYMENT PLACEHOLDER WARNING
# ABOVE — this is loopback and MUST change before this repo's `main` is what
# Talents actually install.
#
# ADR-042 NOTE, and it is the reason `--show-endpoint` now has a line about this:
# preserving an existing config means a talent who installed before this change
# KEEPS the obsolete `ingestEndpointFallback` key in their file. Nothing reads it
# any more, and this installer does not rewrite their config to strip it — see
# the policy docblock in src/config.js (`hasRetiredFallbackConfig`).
#
# ADR-058 fase 1 NOTE: `profile` is seeded the SAME way — only on a config.json
# this installer is creating fresh, never added/changed on an EXISTING file.
# An existing config predates this feature (no `profile` key at all), and
# src/config.js#getProfile's own default for that case is 'talent' (see its
# docblock) — i.e. re-running this installer over an old install can never
# silently narrow an existing Talent's surface to `external`.
normalize_url() { printf '%s' "$1" | sed -E 's#([^:])/{2,}#\1/#g; s#/+$##'; }
HOSTED_CERTS_BASE="$(normalize_url "${SHAKERS_CLI_CERTS_BASE:-${AI_FOOTPRINT_CERTS_BASE:-}}")"
HOSTED_HUB_BASE="$(normalize_url "${SHAKERS_CLI_HUB_BASE:-${AI_FOOTPRINT_HUB_BASE:-}}")"
HOSTED_PROFILE_URL="$(normalize_url "${SHAKERS_CLI_PROFILE_URL:-${AI_FOOTPRINT_PROFILE_URL:-}}")"

if [ -f "$CONFIG_FILE" ]; then
  say "\n  ${G}+${N} Existing config kept ($CONFIG_FILE) — not overwritten"
elif [ -n "$HOSTED_CERTS_BASE" ]; then
  mkdir -p "$CONFIG_DIR"
  CFG_PROFILE="$SHAKERS_PROFILE" CFG_CERTS="$HOSTED_CERTS_BASE" \
  CFG_HUB="$HOSTED_HUB_BASE" CFG_PROFILE_URL="$HOSTED_PROFILE_URL" \
  CFG_FILE="$CONFIG_FILE" node <<'NODE'
const fs = require('fs');
const certs = process.env.CFG_CERTS;
const cfg = { certsBase: certs, ingestEndpoint: certs + '/usage/reports', profile: process.env.CFG_PROFILE };
if (process.env.CFG_HUB) cfg.hubBase = process.env.CFG_HUB;
if (process.env.CFG_PROFILE_URL) cfg.profileUrl = process.env.CFG_PROFILE_URL;
fs.writeFileSync(process.env.CFG_FILE, JSON.stringify(cfg, null, 2) + '\n');
NODE
  chmod 600 "$CONFIG_FILE" 2>/dev/null || true
  say "\n  ${G}+${N} Hosted backend written to $CONFIG_FILE"
  say "    ${C}certs: $HOSTED_CERTS_BASE${N}"
  [ -n "$HOSTED_HUB_BASE" ] && say "    ${C}hub:   $HOSTED_HUB_BASE${N}"
  [ -n "$HOSTED_PROFILE_URL" ] && say "    ${C}profile: $HOSTED_PROFILE_URL${N}"
  say "    Profile: ${C}$SHAKERS_PROFILE${N}"
else
  # No hosted backend given: write no endpoint, so the CLI's own defaults (the
  # deployed certs) apply. A baked loopback URL sent every report to nothing.
  mkdir -p "$CONFIG_DIR"
  if printf '{\n  "profile": "%s"\n}\n' "$SHAKERS_PROFILE" > "$CONFIG_FILE"; then
    chmod 600 "$CONFIG_FILE" 2>/dev/null || true
    say "\n  ${G}+${N} Config written to $CONFIG_FILE (default Shakers backend)"
    say "    Change it anytime with ${C}shakers${N} → ${C}usage --set-endpoint <url>${N}"
  else
    say "\n  ${Y}!${N} Could not write $CONFIG_FILE; the CLI will use its default Shakers backend"
  fi
  say "    Profile: ${C}$SHAKERS_PROFILE${N}"
fi

# ─── Verification ───────────────────────────────────────────────────────────
# Drive the REPL non-interactively (pipe `exit`) so verification never hangs.
printf 'exit\n' | node "$INSTALL_DIR/bin/shakers.js" >/dev/null 2>&1 \
  && say "  ${G}+${N} Verification OK (shakers)" \
  || die "Verification failed while running shakers."

# ─── Final message ──────────────────────────────────────────────────────────
printf "\n  ${G}${B}Installed successfully.${N}\n\n"
say "  ${B}Usage:${N}"
if [ "$SHAKERS_PROFILE" = "talent" ]; then
  say "    ${C}shakers${N}               Open the Shakers shell, then type a command:"
  say "      ${C}usage${N}               Scan this project + machine; print the report to the terminal"
  say "      ${C}usage --roadmap${N} Also show the next-steps / roadmap section (hidden by default)"
  say "      ${C}usage --json${N}    Machine-readable JSON output"
  say "      ${C}certify${N}             Certify your skills from this project's code"
  say "      ${C}report${N}              Open the full shareable HTML report for this project in your browser"
  say "      ${C}help${N} / ${C}exit${N}          List commands / leave the shell"
  say ""
  say "  ${B}Getting started:${N} run ${C}shakers${N} in any project, then type ${C}usage${N}"
  say "  and, once done, ${C}certify${N}. Local-first; nothing is sent without your consent."
else
  # ADR-058 fase 1 (widened by the dueño, 2026-08-12): `external`'s surface is
  # usage/report/share — no certify/start/login pitch here either.
  say "    ${C}shakers${N}               Open the shakers shell, then type a command:"
  say "      ${C}usage${N}               Scan this project + machine; print a LOCAL report to the terminal"
  say "      ${C}usage --json${N}    Machine-readable JSON output"
  say "      ${C}report${N}              Open the full shareable HTML report for this project in your browser"
  say "      ${C}help${N} / ${C}exit${N}          List commands / leave the shell"
  say ""
  say "  ${B}Getting started:${N} run ${C}shakers${N} in any project, then type ${C}usage${N}."
  say "  Local-first; nothing is sent without your consent."
fi
printf "\n"
# ─── Legal notice (skill-code-certification / ADR-001 + ADR-003) ─────────────
# talents-ai-score, ADR-028: Langfuse is deprecated for this module — content
# now goes to Datadog LLM Observability, a THIRD-PARTY provider, gated on your
# consent, with NO promise of later deletion (revises the "own systems / does
# not leave Shakers infrastructure" claim from ADR-027, no longer true once
# Datadog is in the loop).
say "  ${B}${Y}Before you use these tools:${N}"
say "  ${Y}These tools run locally inside the shakers shell. usage sends only derived${N}"
say "  ${Y}signals (never file contents) and only if you opt in. certify sends sampled,${N}"
say "  ${Y}secret-scrubbed source code to a server-side model to assess your skills. If${N}"
say "  ${Y}you consented to saving (usage/certify), that code and the model's output${N}"
say "  ${Y}are ALSO captured and retained for up to three months by a THIRD-PARTY${N}"
say "  ${Y}observability provider (Datadog); it does leave Shakers infrastructure for${N}"
say "  ${Y}that purpose, and that content cannot be selectively deleted afterwards. If${N}"
say "  ${Y}you did not consent, none of it is captured there. You are SOLELY responsible${N}"
say "  ${Y}for ensuring you own, or are authorized to analyze, this project's code. Shakers${N}"
say "  ${Y}assumes no liability for the code you submit. Submitting code that is not${N}"
say "  ${Y}yours, or that you are not authorized to analyze, is a misuse of these tools${N}"
say "  ${Y}and may result in penalties on your Shakers account, up to and including${N}"
say "  ${Y}suspension. Skill scores are indicative and unverified, not an official${N}"
say "  ${Y}qualification.${N}"
printf "\n"

# ─── Ensure BIN_DIR is on PATH ──────────────────────────────────────────────
# The launcher lives in $BIN_DIR (default ~/.local/bin), which is NOT on the
# default macOS/zsh PATH (/etc/paths ships /usr/local/bin, not ~/.local/bin).
# Previous installs only PRINTED a hint here — easy to miss, and it pointed at
# ~/.bashrc even for zsh users — which is exactly how `shakers: command not
# found` kept happening despite a "successful" install (verification runs node
# directly, so it never exercises PATH). Now we append the export to the user's
# shell rc, idempotently, and only when the dir isn't already reachable — and we
# ALWAYS print what we changed plus the one line to run in the current shell.
# We keep the tool user-scoped in ~/.local/bin (no sudo) rather than dropping it
# in /usr/local/bin (already on PATH, but system-wide and usually root-owned).
ensure_on_path() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return 0 ;;   # already reachable this session
  esac

  local shell_name rc export_line marker
  shell_name="$(basename "${SHELL:-}")"
  case "$shell_name" in
    zsh)  rc="$HOME/.zshrc" ;;
    bash) if [ -f "$HOME/.bash_profile" ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    *)    rc="" ;;   # unknown shell — don't guess, just print the hint
  esac

  export_line="export PATH=\"$BIN_DIR:\$PATH\""
  marker="# added by ai-footprint installer (shakers on PATH)"

  if [ -n "$rc" ]; then
    if [ -f "$rc" ] && grep -qF "$marker" "$rc" 2>/dev/null; then
      say "\n  ${G}+${N} $BIN_DIR already on PATH via $rc (left as-is)"
    else
      if printf '\n%s\n%s\n' "$marker" "$export_line" >> "$rc" 2>/dev/null; then
        say "\n  ${G}+${N} Added $BIN_DIR to your PATH in ${B}$rc${N}"
      else
        say "\n  ${Y}Note:${N} couldn't write $rc. Add this line yourself:"
        say "    ${C}$export_line${N}"
      fi
    fi
    say "  To use ${C}shakers${N} in ${B}this${N} terminal right now, run:"
    say "    ${C}$export_line${N}"
    say "  New terminals pick it up automatically. Or run it directly: ${C}$SHIM${N}\n"
  else
    say "\n  ${Y}Note:${N} $BIN_DIR is not in your PATH. Add it with:"
    say "    ${C}$export_line${N}"
    say "  then restart your shell. Meanwhile you can run: ${C}$SHIM${N}\n"
  fi
}
ensure_on_path
# Offer to connect the MCP to the AI apps found on this machine; it asks first.
# Re-running the installer picks up an app installed later. SHAKERS_MCP_INSTALL=1 answers
# yes without asking, SHAKERS_SKIP_MCP_INSTALL=1 skips the step.
if [ "${SHAKERS_SKIP_MCP_INSTALL:-}" != "1" ]; then
  "$SHIM" mcp install || say "  ${Y}Note:${N} re-run this installer to retry the apps marked above.\n"
fi
