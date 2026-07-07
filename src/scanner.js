'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { detectors } = require('./detectors');

/* ---------- utilidades de comprobación (solo existencia, nunca contenido) ---------- */

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function onPath(bin) {
  const cmd = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [bin] : ['-v', bin];
  try {
    // command -v necesita shell; usamos un enfoque portable
    if (process.platform === 'win32') {
      execFileSync('where', [bin], { stdio: 'ignore' });
    } else {
      execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

function vscodeExtInstalled(prefix) {
  const dirs = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-insiders', 'extensions'),
    path.join(os.homedir(), '.cursor', 'extensions'),
  ];
  for (const d of dirs) {
    if (!exists(d)) continue;
    try {
      const entries = fs.readdirSync(d);
      if (entries.some((e) => e.toLowerCase().startsWith(prefix.toLowerCase()))) {
        return true;
      }
    } catch {
      /* sin permisos: se ignora */
    }
  }
  return false;
}

function evalSignal(sig, root) {
  switch (sig.type) {
    case 'projectPath':
      return exists(path.join(root, sig.path));
    case 'homePath':
      return exists(path.join(os.homedir(), sig.path));
    case 'bin':
      return onPath(sig.name);
    case 'vscodeExt':
      return vscodeExtInstalled(sig.prefix);
    default:
      return false;
  }
}

// Resuelve la ruta absoluta de una señal projectPath/homePath. Las señales
// bin/vscodeExt no apuntan a un fichero propio de la herramienta (vscodeExt
// apunta al directorio COMPARTIDO de extensiones), así que no se usan para
// tamaño ni recencia — mezclarlas ensuciaría ambas métricas.
function resolveSignalPath(sig, root) {
  if (sig.type === 'projectPath') return path.join(root, sig.path);
  if (sig.type === 'homePath') return path.join(os.homedir(), sig.path);
  return null;
}

/* ---------- sondas de PROFUNDIDAD: devuelven SOLO números ---------- */

function countDirEntries(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

function countFiles(p, ext) {
  try {
    return fs.readdirSync(p).filter((f) => (ext ? f.endsWith(ext) : true)).length;
  } catch {
    return 0;
  }
}

function countJsonKeys(file, key) {
  // Parsea el JSON SOLO para contar claves; no se guarda ningún valor ni nombre.
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(raw);
    const target = key ? obj[key] : obj;
    return target && typeof target === 'object' ? Object.keys(target).length : 0;
  } catch {
    return 0;
  }
}

/* ---------- huella de configuración: SOLO tamaño en bytes y nº de ficheros ---------- */
/* Nunca se guarda un nombre de fichero ni una ruta: se agregan solo números.  */

const FOOTPRINT_MAX_DEPTH = 4; // acota el coste si algún dir de config es profundo
const FOOTPRINT_MAX_FILES = 5000; // cota de seguridad, evita escaneos costosos

function pathFootprint(p, depth = 0, budget = { files: 0 }) {
  if (budget.files >= FOOTPRINT_MAX_FILES) return { bytes: 0, files: 0 };
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return { bytes: 0, files: 0 }; // no seguimos symlinks
    if (st.isFile()) {
      budget.files += 1;
      return { bytes: st.size, files: 1 };
    }
    if (st.isDirectory() && depth < FOOTPRINT_MAX_DEPTH) {
      let bytes = 0;
      let files = 0;
      let entries = [];
      try {
        entries = fs.readdirSync(p, { withFileTypes: true });
      } catch {
        return { bytes: 0, files: 0 };
      }
      for (const e of entries) {
        if (budget.files >= FOOTPRINT_MAX_FILES) break;
        const sub = pathFootprint(path.join(p, e.name), depth + 1, budget);
        bytes += sub.bytes;
        files += sub.files;
      }
      return { bytes, files };
    }
    return { bytes: 0, files: 0 };
  } catch {
    return { bytes: 0, files: 0 };
  }
}

function aggregateFootprint(paths) {
  const budget = { files: 0 };
  let bytes = 0;
  let files = 0;
  for (const p of paths) {
    const sub = pathFootprint(p, 0, budget);
    bytes += sub.bytes;
    files += sub.files;
  }
  return { bytes, files };
}

/* ---------- recencia: SOLO mtime -> fecha derivada (ADR-003) ---------- */
/* Prohibido: leer contenido de logs/historiales para inferir frecuencia de uso. */
/* Único dato capturado: la fecha de última modificación de los ficheros/dirs de */
/* configuración ya detectados como existentes — nunca su contenido.            */

function latestMtime(paths) {
  let max = null;
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (!max || st.mtime > max) max = st.mtime;
    } catch {
      /* ignorado: no existe o sin permisos */
    }
  }
  return max;
}

function recencyBucket(days) {
  if (days === null || days === undefined) return null;
  if (days <= 1) return 'today';
  if (days <= 7) return 'this_week';
  if (days <= 30) return 'this_month';
  if (days <= 90) return 'this_quarter';
  return 'stale';
}

function computeRecency(paths) {
  const mtime = latestMtime(paths);
  if (!mtime) return { lastModified: null, daysSinceModified: null, bucket: null };
  const daysSinceModified = Math.max(0, Math.floor((Date.now() - mtime.getTime()) / 86400000));
  return {
    lastModified: mtime.toISOString(),
    daysSinceModified,
    bucket: recencyBucket(daysSinceModified),
  };
}

/* ---------- versión: SOLO se ejecuta el binario YA detectado, con --version ---------- */
/* Nunca comandos arbitrarios; se descarta toda la salida salvo el patrón de versión. */

function getVersion(bin) {
  try {
    const out = execFileSync(bin, ['--version'], {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8');
    const match = out.match(/\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?/);
    return match ? match[0] : null;
  } catch {
    return null; // binario sin --version, timeout, o cualquier fallo: se ignora
  }
}

/* ---------- metadatos de entorno: SO/arquitectura/editores instalados ---------- */

const EDITOR_CANDIDATES = [
  {
    id: 'vscode',
    name: 'Visual Studio Code',
    signals: [{ type: 'bin', name: 'code' }, { type: 'homePath', path: '.vscode' }],
  },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    signals: [{ type: 'bin', name: 'code-insiders' }, { type: 'homePath', path: '.vscode-insiders' }],
  },
  { id: 'sublime-text', name: 'Sublime Text', signals: [{ type: 'bin', name: 'subl' }] },
  { id: 'vim', name: 'Vim', signals: [{ type: 'bin', name: 'vim' }] },
  { id: 'neovim', name: 'Neovim', signals: [{ type: 'bin', name: 'nvim' }] },
  { id: 'emacs', name: 'Emacs', signals: [{ type: 'bin', name: 'emacs' }] },
  {
    // Confianza media: la ruta de config de JetBrains varía por SO/producto/versión;
    // se comprueba la carpeta paraguas de cada SO, no un IDE concreto.
    id: 'jetbrains',
    name: 'JetBrains IDEs',
    signals: [
      { type: 'homePath', path: '.config/JetBrains' },
      { type: 'homePath', path: 'Library/Application Support/JetBrains' },
      { type: 'homePath', path: 'AppData/Roaming/JetBrains' },
    ],
  },
];

function detectEditors(root) {
  const installed = [];
  for (const ed of EDITOR_CANDIDATES) {
    const hit = ed.signals.some((s) => evalSignal(s, root));
    if (hit) installed.push(ed.id);
  }
  return installed;
}

const probes = {
  'claude-code': (root) => ({
    mcpServers:
      countJsonKeys(path.join(root, '.mcp.json'), 'mcpServers') ||
      countJsonKeys(path.join(os.homedir(), '.claude.json'), 'mcpServers'),
    skills:
      countDirEntries(path.join(root, '.claude', 'skills')) +
      countDirEntries(path.join(os.homedir(), '.claude', 'skills')),
    commands: countFiles(path.join(root, '.claude', 'commands'), '.md'),
    instructions: exists(path.join(root, 'CLAUDE.md')) ? 1 : 0,
    hooks: countJsonKeys(path.join(root, '.claude', 'settings.json'), 'hooks'),
  }),
  cursor: (root) => ({
    rules:
      countFiles(path.join(root, '.cursor', 'rules'), '.mdc') +
      (exists(path.join(root, '.cursorrules')) ? 1 : 0),
    mcpServers: countJsonKeys(path.join(root, '.cursor', 'mcp.json'), 'mcpServers'),
  }),
  'github-copilot': (root) => ({
    instructions: exists(path.join(root, '.github', 'copilot-instructions.md')) ? 1 : 0,
  }),
  windsurf: (root) => ({
    rules:
      (exists(path.join(root, '.windsurfrules')) ? 1 : 0) +
      countFiles(path.join(root, '.windsurf', 'rules'), '.md'),
    // Confianza media: nombre de fichero recordado de memoria, sin verificar
    // contra la doc actual de Windsurf en este entorno (sin acceso a red).
    mcpServers: countJsonKeys(path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers'),
  }),
  aider: (root) => ({
    config: exists(path.join(root, '.aider.conf.yml')) ? 1 : 0,
  }),
  continue: (root) => ({
    config:
      (exists(path.join(root, '.continue')) ? 1 : 0) +
      (exists(path.join(os.homedir(), '.continue')) ? 1 : 0),
  }),
  'gemini-cli': (root) => ({
    instructions: exists(path.join(root, 'GEMINI.md')) ? 1 : 0,
    // Confianza media: mismo caveat que windsurf.mcpServers arriba.
    mcpServers: countJsonKeys(path.join(os.homedir(), '.gemini', 'settings.json'), 'mcpServers'),
  }),
  'codex-cli': (root) => ({
    instructions: exists(path.join(root, 'AGENTS.md')) ? 1 : 0,
  }),
  trae: (root) => ({
    // Confianza baja: estructura de `.trae/rules` no verificada (ver detectors.js).
    rules: countFiles(path.join(root, '.trae', 'rules')),
  }),
};

/* ---------- escaneo principal ---------- */

function scan(options = {}) {
  const root = options.root || process.cwd();
  const tools = [];

  for (const det of detectors) {
    const matched = det.signals.filter((s) => evalSignal(s, root));
    const detected = matched.length > 0;

    const tool = {
      id: det.id,
      name: det.name,
      vendor: det.vendor,
      category: det.category,
      detected,
      // Solo el TIPO de señal que casó (projectPath/homePath/bin/vscodeExt),
      // nunca la ruta concreta, para no filtrar estructura de carpetas privadas.
      signalTypes: [...new Set(matched.map((s) => s.type))],
      signalCount: matched.length,
      depth: {},
      // Huella de config: SOLO tamaño agregado en bytes y nº de ficheros, nunca
      // rutas ni nombres. null cuando la herramienta no se detectó por
      // projectPath/homePath (p.ej. solo por bin o vscodeExt: no hay ruta propia
      // que medir sin arriesgar contar el directorio compartido de extensiones).
      footprint: null,
      // Recencia: SOLO fecha derivada del mtime más reciente entre sus ficheros
      // de config ya detectados (ADR-003). Nunca contenido, logs ni historiales.
      recency: { lastModified: null, daysSinceModified: null, bucket: null },
      // Versión: solo si la herramienta se detectó por binario en PATH; se
      // ejecuta ESE binario, ya detectado, con `--version` únicamente.
      version: null,
    };

    if (detected && probes[det.id]) {
      tool.depth = probes[det.id](root);
    }

    if (detected) {
      const pathSignals = matched
        .map((s) => resolveSignalPath(s, root))
        .filter((p) => p !== null);
      if (pathSignals.length > 0) {
        tool.footprint = aggregateFootprint(pathSignals);
        tool.recency = computeRecency(pathSignals);
      }

      const binSignal = matched.find((s) => s.type === 'bin');
      if (binSignal) {
        tool.version = getVersion(binSignal.name);
      }
    }

    tools.push(tool);
  }

  const detectedTools = tools.filter((t) => t.detected);

  // ID anónimo estable por máquina: hash de hostname + usuario. No reversible
  // a datos personales y sirve solo para deduplicar envíos, no para identificar.
  const anonId = crypto
    .createHash('sha256')
    .update(`${os.hostname()}::${os.userInfo().username}`)
    .digest('hex')
    .slice(0, 12);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    anonId,
    platform: process.platform,
    scope: options.root ? 'custom' : 'cwd',
    // Metadatos de entorno: SO/arquitectura/versión de Node (constantes de
    // process.*, nunca leídas de fichero) y qué editores tiene instalados
    // (booleanos de presencia, catálogo EDITOR_CANDIDATES arriba). Campo nuevo,
    // no rompe `platform` (se mantiene como string por compatibilidad con
    // share.js/render-html.js existentes).
    environment: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      editorsInstalled: detectEditors(root),
    },
    summary: {
      totalDetected: detectedTools.length,
      categories: [...new Set(detectedTools.map((t) => t.category))],
    },
    tools,
  };
}

module.exports = { scan };
