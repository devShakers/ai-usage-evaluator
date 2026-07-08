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
# not (downloads them from the repo). When done it leaves the `ai-footprint`
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
FILES=(
  "package.json"
  "README.md"
  "bin/report.js"
)

say()  { printf "  %b\n" "$1"; }
die()  { printf "  ${R}✗ %b${N}\n" "$1" >&2; exit 1; }

uninstall() {
  printf "\n  ${B}${C}AI Footprint — desinstalar${N}\n\n"
  rm -rf "$INSTALL_DIR" && say "${G}+${N} eliminado $INSTALL_DIR"
  rm -f "$BIN_DIR/ai-footprint" && say "${G}+${N} eliminado $BIN_DIR/ai-footprint"
  say "\n  ${G}${B}Hecho.${N} (Tus informes en ~/.config/ai-footprint/ se conservan.)\n"
  exit 0
}

[ "${1:-}" = "--uninstall" ] && uninstall

printf "\n  ${B}${C}AI Footprint — instalador v${VERSION}${N}\n"
say  "${C}perfil local de uso de IA · 12 herramientas${N}\n"

# ─── Requirements ───────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js es necesario y no está instalado.\n    Instálalo desde https://nodejs.org (v18 o superior)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Se requiere Node 18+. Tienes $(node -v)."
say "${G}+${N} Node $(node -v) detectado"

# Local install (cloned repo) or remote (curl)?
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo '')"
LOCAL=0
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/bin/report.js" ]; then
  LOCAL=1
  say "${G}+${N} Ficheros encontrados en local — instalando por copia"
else
  command -v curl >/dev/null 2>&1 || die "curl es necesario para la instalación remota."
  say "${G}+${N} Instalando desde ${OWNER}/${REPO}@${BRANCH}"
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
    || die "No se pudo listar src/ vía la API de GitHub (${API_URL}).\n    Revisa tu conexión o la config OWNER/REPO/BRANCH del script."
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
[ "${#SRC_FILES[@]}" -gt 0 ] || die "No se encontraron módulos en src/.\n    Revisa OWNER/REPO/BRANCH en install.sh, o que el checkout local tenga la carpeta src/."

# ─── Place the files ────────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR/bin" "$INSTALL_DIR/src" "$BIN_DIR"
say "\n  Copiando ficheros..."
for f in "${FILES[@]}"; do
  dest="$INSTALL_DIR/$f"
  mkdir -p "$(dirname "$dest")"
  if [ "$LOCAL" -eq 1 ]; then
    cp "$SCRIPT_DIR/$f" "$dest" || die "No se pudo copiar $f"
  else
    curl -fsSL "$RAW/$f" -o "$dest" || die "No se pudo descargar $f\n    Revisa tu conexión o la config OWNER/REPO/BRANCH del script."
  fi
  say "    ${G}+${N} $f"
done
for f in "${SRC_FILES[@]}"; do
  dest="$INSTALL_DIR/src/$f"
  if [ "$LOCAL" -eq 1 ]; then
    cp "$SCRIPT_DIR/src/$f" "$dest" || die "No se pudo copiar src/$f"
  else
    curl -fsSL "$RAW/src/$f" -o "$dest" || die "No se pudo descargar src/$f\n    Revisa tu conexión o la config OWNER/REPO/BRANCH del script."
  fi
  say "    ${G}+${N} src/$f"
done

# ─── Create the `ai-footprint` launcher ─────────────────────────────────────
SHIM="$BIN_DIR/ai-footprint"
cat > "$SHIM" <<EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/bin/report.js" "\$@"
EOF
chmod +x "$SHIM"
say "\n  ${G}+${N} Comando creado en $SHIM"

# ─── Verification ───────────────────────────────────────────────────────────
node "$INSTALL_DIR/bin/report.js" --help >/dev/null 2>&1 \
  && say "  ${G}+${N} Verificación OK" \
  || die "La verificación falló al ejecutar la herramienta."

# ─── Final message ──────────────────────────────────────────────────────────
printf "\n  ${G}${B}Instalado correctamente.${N}\n\n"
say "  ${B}Uso:${N}"
say "    ${C}ai-footprint${N}          Informe en la terminal"
say "    ${C}ai-footprint --html${N}   + abre el dashboard visual"
say "    ${C}ai-footprint --json${N}   Salida en JSON"
printf "\n"

# Notice if ~/.local/bin is not in the PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say "  ${Y}Nota:${N} $BIN_DIR no está en tu PATH. Añádelo con:"
    say "    ${C}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc${N}"
    say "  (o usa zsh: ~/.zshrc). Mientras tanto puedes ejecutar: ${C}$SHIM${N}\n"
    ;;
esac
