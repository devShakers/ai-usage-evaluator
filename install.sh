#!/usr/bin/env bash
#
# AI Footprint — instalador
#
# Uso rápido (desde cualquier sitio):
#   curl -fsSL https://raw.githubusercontent.com/devShakers/ai-usage-evaluator/main/install.sh | bash
#
# O, si has clonado el repo, desde dentro de la carpeta:
#   ./install.sh
#
# El script detecta si los ficheros están en local (instala copiando) o no
# (los descarga desde el repo). Al terminar deja el comando `ai-footprint`
# disponible. Desinstalar: ./install.sh --uninstall
#
set -euo pipefail

# ─── Configuración (EDITA ESTO con tu org/repo real) ───────────────────────
OWNER="devShakers"
REPO="ai-usage-evaluator"
# PoC "solo distribución" (active-work/talents-ai-score, ADR-002): el CLI ya
# vive en main (el one-liner curl | raw.githubusercontent resuelve los
# ficheros por rama, así que el instalador se rompe si BRANCH no coincide con
# la rama publicada en el remoto).
BRANCH="main"
# ───────────────────────────────────────────────────────────────────────────

RAW="https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}"
INSTALL_DIR="${AI_FOOTPRINT_HOME:-$HOME/.ai-footprint}"
BIN_DIR="${AI_FOOTPRINT_BIN:-$HOME/.local/bin}"
VERSION="0.1.0"

# Colores (solo si la salida es una terminal)
if [ -t 1 ]; then
  C='\033[0;36m'; G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'
else
  C=''; G=''; Y=''; R=''; B=''; N=''
fi

FILES=(
  "package.json"
  "README.md"
  "bin/report.js"
  "src/detectors.js"
  "src/scanner.js"
  "src/maturity.js"
  "src/render-terminal.js"
  "src/render-html.js"
  "src/store.js"
  "src/share.js"
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

# ─── Requisitos ─────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js es necesario y no está instalado.\n    Instálalo desde https://nodejs.org (v18 o superior)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Se requiere Node 18+. Tienes $(node -v)."
say "${G}+${N} Node $(node -v) detectado"

# ¿Instalación local (repo clonado) o remota (curl)?
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo '')"
LOCAL=0
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/bin/report.js" ]; then
  LOCAL=1
  say "${G}+${N} Ficheros encontrados en local — instalando por copia"
else
  command -v curl >/dev/null 2>&1 || die "curl es necesario para la instalación remota."
  say "${G}+${N} Instalando desde ${OWNER}/${REPO}@${BRANCH}"
fi

# ─── Colocar los ficheros ───────────────────────────────────────────────────
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

# ─── Crear el lanzador `ai-footprint` ───────────────────────────────────────
SHIM="$BIN_DIR/ai-footprint"
cat > "$SHIM" <<EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/bin/report.js" "\$@"
EOF
chmod +x "$SHIM"
say "\n  ${G}+${N} Comando creado en $SHIM"

# ─── Verificación ───────────────────────────────────────────────────────────
node "$INSTALL_DIR/bin/report.js" --help >/dev/null 2>&1 \
  && say "  ${G}+${N} Verificación OK" \
  || die "La verificación falló al ejecutar la herramienta."

# ─── Mensaje final ──────────────────────────────────────────────────────────
printf "\n  ${G}${B}Instalado correctamente.${N}\n\n"
say "  ${B}Uso:${N}"
say "    ${C}ai-footprint${N}          Informe en la terminal"
say "    ${C}ai-footprint --html${N}   + abre el dashboard visual"
say "    ${C}ai-footprint --json${N}   Salida en JSON"
printf "\n"

# Aviso si ~/.local/bin no está en el PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say "  ${Y}Nota:${N} $BIN_DIR no está en tu PATH. Añádelo con:"
    say "    ${C}echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && source ~/.bashrc${N}"
    say "  (o usa zsh: ~/.zshrc). Mientras tanto puedes ejecutar: ${C}$SHIM${N}\n"
    ;;
esac
