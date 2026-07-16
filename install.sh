#!/usr/bin/env bash
#
# AI Footprint — installer
#
# Quick usage (from anywhere):
#   curl -fsSL https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/main/install.sh | bash
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
# already lives on main (the curl | raw.githubusercontent one-liner resolves
# files by branch, so the installer breaks if BRANCH doesn't match the
# branch published on the remote).
BRANCH="main"
# ───────────────────────────────────────────────────────────────────────────

RAW="https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}"
INSTALL_DIR="${AI_FOOTPRINT_HOME:-$HOME/.ai-footprint}"
BIN_DIR="${AI_FOOTPRINT_BIN:-$HOME/.local/bin}"
VERSION="0.1.0"

# Colors (only if output is a terminal)
if [ -t 1 ]; then
  C='\033[0;36m'; G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'
else
  C=''; G=''; Y=''; R=''; B=''; N=''
fi

# Fixed top-level files (outside src/). Everything under src/ is discovered
# and copied as a whole below — NOT listed one by one here — precisely so a
# new module added to src/ (like the i18n.js/locale.js pair that once broke
# this installer by being left off a hardcoded list) never goes missing from
# an install again. If a file is ever added to src/ that must NOT ship (none
# today), exclude it explicitly at the discovery step below and say why.
# ADR-014: `shakers` (the branded REPL) is the ONLY installed command. The
# per-command binaries (bin/report.js / bin/certify.js) are still SHIPPED — the
# REPL imports them (run(args,{ask})) — but no launcher is created for them, so
# they aren't invoked directly.
FILES=(
  "package.json"
  "README.md"
  "bin/shakers.js"
  "bin/report.js"
  "bin/certify.js"
)

say()  { printf "  %b\n" "$1"; }
die()  { printf "  ${R}✗ %b${N}\n" "$1" >&2; exit 1; }

uninstall() {
  printf "\n  ${B}${C}Shakers — uninstall${N}\n\n"
  rm -rf "$INSTALL_DIR" && say "${G}+${N} removed $INSTALL_DIR"
  rm -f "$BIN_DIR/shakers" && say "${G}+${N} removed $BIN_DIR/shakers"
  # Legacy launchers from installs before ADR-014's single-entrypoint REPL.
  rm -f "$BIN_DIR/ai-footprint" && say "${G}+${N} removed legacy $BIN_DIR/ai-footprint"
  rm -f "$BIN_DIR/ai-certify" && say "${G}+${N} removed legacy $BIN_DIR/ai-certify"
  say "\n  ${G}${B}Done.${N} (Your reports in ~/.config/ai-footprint/ are kept.)\n"
  exit 0
}

[ "${1:-}" = "--uninstall" ] && uninstall

printf "\n  ${B}${C}Shakers — installer v${VERSION}${N}\n"
say  "${C}local-first developer AI tools, in one branded shell${N}"
say  "  ${B}shakers${N}       opens an interactive Shakers shell with two commands:"
say  "  ${B}footprint${N}     scans your machine and current project for AI tooling"
say  "                (assistants, MCP servers, agents, hooks, custom skills/"
say  "                commands) and scores your setup on a T0-T7 maturity ladder,"
say  "                with a curated roadmap and a copy-paste prompt to level up."
say  "  ${B}certify${N}       certifies your skills from your actual project code: it"
say  "                maps your stack to Shakers Skills and returns a per-skill"
say  "                assessment. Code is sampled, secret-scrubbed, sent for"
say  "                analysis, and never stored."
say  ""

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
  say "${G}+${N} Installing from ${OWNER}/${REPO}@${BRANCH}"
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
  API_URL="https://api.github.com/repos/${OWNER}/${REPO}/contents/src?ref=${BRANCH}"
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

# ─── Place the files ────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/src" "$BIN_DIR"
say "\n  Copying files..."
for f in "${FILES[@]}"; do
  dest="$INSTALL_DIR/$f"
  mkdir -p "$(dirname "$dest")"
  if [ "$LOCAL" -eq 1 ]; then
    cp "$SCRIPT_DIR/$f" "$dest" || die "Could not copy $f"
  else
    curl -fsSL "$RAW/$f" -o "$dest" || die "Could not download $f\n    Check your connection or the script's OWNER/REPO/BRANCH config."
  fi
  say "    ${G}+${N} $f"
done
for f in "${SRC_FILES[@]}"; do
  dest="$INSTALL_DIR/src/$f"
  if [ "$LOCAL" -eq 1 ]; then
    cp "$SCRIPT_DIR/src/$f" "$dest" || die "Could not copy src/$f"
  else
    curl -fsSL "$RAW/src/$f" -o "$dest" || die "Could not download src/$f\n    Check your connection or the script's OWNER/REPO/BRANCH config."
  fi
  say "    ${G}+${N} src/$f"
done

# ─── Create the single `shakers` launcher (ADR-014) ─────────────────────────
# The branded REPL is the ONLY command. bin/report.js / bin/certify.js are
# shipped (the REPL imports them) but get NO standalone launcher.
SHIM="$BIN_DIR/shakers"
cat > "$SHIM" <<EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/bin/shakers.js" "\$@"
EOF
chmod +x "$SHIM"
say "\n  ${G}+${N} Command created at $SHIM"

# Remove legacy launchers from installs before the single-entrypoint REPL, so
# an upgrade doesn't leave the retired `ai-footprint`/`ai-certify` commands
# lying around pointing at the old direct binaries.
rm -f "$BIN_DIR/ai-footprint" "$BIN_DIR/ai-certify" 2>/dev/null || true

# ─── Verification ───────────────────────────────────────────────────────────
# Drive the REPL non-interactively (pipe `exit`) so verification never hangs.
printf 'exit\n' | node "$INSTALL_DIR/bin/shakers.js" >/dev/null 2>&1 \
  && say "  ${G}+${N} Verification OK (shakers)" \
  || die "Verification failed while running shakers."

# ─── Final message ──────────────────────────────────────────────────────────
printf "\n  ${G}${B}Installed successfully.${N}\n\n"
say "  ${B}Usage:${N}"
say "    ${C}shakers${N}               Open the Shakers shell, then type a command:"
say "      ${C}footprint${N}           Scan this project + machine; print the report and a"
say "                          link to the cumulative HTML report for the project"
say "      ${C}footprint --json${N}    Machine-readable JSON output"
say "      ${C}certify${N}             Certify your skills from this project's code"
say "      ${C}help${N} / ${C}exit${N}          List commands / leave the shell"
say ""
say "  ${B}Getting started:${N} run ${C}shakers${N} in any project, then type ${C}footprint${N}"
say "  and, once done, ${C}certify${N}. Local-first; nothing is sent without your consent."
printf "\n"
# ─── Legal notice (skill-code-certification / ADR-001 + ADR-003) ─────────────
# NOT FINAL: pending review by a legal/labor expert before production. The
# account-penalty clause in particular depends on the Shakers Terms of Service.
say "  ${B}${Y}Before you use these tools:${N}"
say "  ${Y}These tools run locally. ai-footprint sends only derived signals (never file${N}"
say "  ${Y}contents) and only if you opt in. ai-certify sends sampled, secret-scrubbed${N}"
say "  ${Y}source code to a server-side model to assess your skills; that code is${N}"
say "  ${Y}processed ephemerally and not persisted. You are SOLELY responsible for${N}"
say "  ${Y}ensuring you own, or are authorized to analyze, this project's code. Shakers${N}"
say "  ${Y}assumes no liability for the code you submit. Submitting code that is not${N}"
say "  ${Y}yours, or that you are not authorized to analyze, is a misuse of these tools${N}"
say "  ${Y}and may result in penalties on your Shakers account, up to and including${N}"
say "  ${Y}suspension. Skill scores are indicative and unverified, not an official${N}"
say "  ${Y}qualification.${N}"
say "  ${Y}[This notice is pending review by a legal/labor expert and is NOT FINAL.]${N}"
printf "\n"

# Notice if ~/.local/bin is not in the PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say "  ${Y}Note:${N} $BIN_DIR is not in your PATH. Add it with:"
    say "    ${C}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc${N}"
    say "  (or zsh: ~/.zshrc). Meanwhile you can run: ${C}$SHIM${N}\n"
    ;;
esac
