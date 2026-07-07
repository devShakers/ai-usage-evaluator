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
  }),
  'codex-cli': (root) => ({
    instructions: exists(path.join(root, 'AGENTS.md')) ? 1 : 0,
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
    };

    if (detected && probes[det.id]) {
      tool.depth = probes[det.id](root);
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
    summary: {
      totalDetected: detectedTools.length,
      categories: [...new Set(detectedTools.map((t) => t.category))],
    },
    tools,
  };
}

module.exports = { scan };
