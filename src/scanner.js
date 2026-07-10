'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { detectors } = require('./detectors');
const { parseAgentOrgChart } = require('./agent-org-chart');
const { detectTechnologies } = require('./tech-detector');
const { detectMcpServers } = require('./mcp-detector');
const { analyzeMemoryStructure } = require('./memory-structure-detector');
const { detectAutomations } = require('./automations-detector');

/* ---------- existence-check utilities (existence only, never content) ---------- */

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
    // command -v needs a shell; we use a portable approach
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
      /* no permissions: ignored */
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

// Resolves the absolute path of a projectPath/homePath signal. bin/vscodeExt
// signals don't point to a file of the tool's own (vscodeExt points at the
// SHARED extensions directory), so they aren't used for size or recency —
// mixing them in would pollute both metrics.
function resolveSignalPath(sig, root) {
  if (sig.type === 'projectPath') return path.join(root, sig.path);
  if (sig.type === 'homePath') return path.join(os.homedir(), sig.path);
  return null;
}

/* ---------- DEPTH probes: return ONLY numbers ---------- */

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
  // Parses the JSON ONLY to count keys; no value or name is ever stored.
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(raw);
    const target = key ? obj[key] : obj;
    return target && typeof target === 'object' ? Object.keys(target).length : 0;
  } catch {
    return 0;
  }
}

/* ---------- config footprint: ONLY size in bytes and file count ---------- */
/* No file name or path is ever stored: only numbers are aggregated.        */

const FOOTPRINT_MAX_DEPTH = 4; // caps the cost if some config dir is deeply nested
const FOOTPRINT_MAX_FILES = 5000; // safety cap, avoids expensive scans

function pathFootprint(p, depth = 0, budget = { files: 0 }) {
  if (budget.files >= FOOTPRINT_MAX_FILES) return { bytes: 0, files: 0 };
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return { bytes: 0, files: 0 }; // we don't follow symlinks
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

/* ---------- recency: ONLY mtime -> derived date (ADR-003) ---------- */
/* Forbidden: reading log/history content to infer usage frequency.          */
/* Only data captured: the last-modified date of the config files/dirs      */
/* already detected as existing — never their content.                      */

function latestMtime(paths) {
  let max = null;
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (!max || st.mtime > max) max = st.mtime;
    } catch {
      /* ignored: doesn't exist or no permissions */
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

/* ---------- version: ONLY runs the ALREADY detected binary, with --version ---------- */
/* Never arbitrary commands; all output is discarded except the version pattern. */

function getVersion(bin) {
  try {
    const out = execFileSync(bin, ['--version'], {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8');
    const match = out.match(/\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?/);
    return match ? match[0] : null;
  } catch {
    return null; // binary without --version, timeout, or any failure: ignored
  }
}

/* ---------- environment metadata: OS/architecture/installed editors ---------- */

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
    // Medium confidence: JetBrains's config path varies by OS/product/version;
    // we check each OS's umbrella folder, not a specific IDE.
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
    // Medium confidence: file name recalled from memory, not verified against
    // Windsurf's current docs in this environment (no network access).
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
    // Medium confidence: same caveat as windsurf.mcpServers above.
    mcpServers: countJsonKeys(path.join(os.homedir(), '.gemini', 'settings.json'), 'mcpServers'),
  }),
  'codex-cli': (root) => ({
    instructions: exists(path.join(root, 'AGENTS.md')) ? 1 : 0,
  }),
  trae: (root) => ({
    // Low confidence: `.trae/rules` structure not verified (see detectors.js).
    rules: countFiles(path.join(root, '.trae', 'rules')),
  }),
};

/* ---------- agent org chart counts (talents-ai-score, ADR-009) ---------- */
/* Deterministic (no-LLM), structure+names only — see src/agent-org-chart.js. */
/* PROJECT ROOT ONLY (not the developer's home directory), unlike the        */
/* claude-code probe's skills/mcpServers above: the org chart itself is      */
/* project-scoped (`<root>/.claude/agents`), so its counts stay scoped the   */
/* same way, deliberately, rather than mixing in personal/home config.       */

function agentOrgChartCounts(root, agentsCount) {
  return {
    agents: agentsCount,
    skills: countDirEntries(path.join(root, '.claude', 'skills')),
    commands: countFiles(path.join(root, '.claude', 'commands'), '.md'),
    mcpServers: countJsonKeys(path.join(root, '.mcp.json'), 'mcpServers'),
    hooks: countJsonKeys(path.join(root, '.claude', 'settings.json'), 'hooks'),
  };
}

/* ---------- main scan ---------- */

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
      // Only the signal TYPE that matched (projectPath/homePath/bin/vscodeExt),
      // never the concrete path, so as not to leak private folder structure.
      signalTypes: [...new Set(matched.map((s) => s.type))],
      signalCount: matched.length,
      depth: {},
      // Config footprint: ONLY the aggregated size in bytes and file count,
      // never paths or names. null when the tool wasn't detected via
      // projectPath/homePath (e.g. only via bin or vscodeExt: there's no path
      // of its own to measure without risking counting the shared extensions
      // directory).
      footprint: null,
      // Recency: ONLY the date derived from the most recent mtime among its
      // already-detected config files (ADR-003). Never content, logs or history.
      recency: { lastModified: null, daysSinceModified: null, bucket: null },
      // Version: only if the tool was detected via a binary on PATH; runs
      // THAT already-detected binary, with `--version` only.
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

  // Deterministic (no-LLM) agent org chart (ADR-009): structure + names
  // only (name, wired tools, model, hierarchy). Never descriptions/prompts.
  const agents = parseAgentOrgChart(root);

  // Deterministic (no-LLM) project technologies (ADR-012): dependency
  // manifest package/module NAMES only (package.json, requirements.txt,
  // go.mod, pyproject.toml) — never business/application code. Always
  // shown locally; associated with Shakers' Skill catalog server-side, only
  // at persistence time (with consent).
  const technologies = detectTechnologies(root);

  // Deterministic (no-LLM) MCP servers BY NAME (talents-ai-score, issue 015 /
  // ADR-013-014): names + category (data/comms/dev/browser/other) from
  // KNOWN MCP config locations (project ∪ home) — never the raw config.
  const mcp = detectMcpServers(root);

  // Deterministic (no-LLM) memory STRUCTURE (talents-ai-score, issue 016 /
  // ADR-013-014): import count, nesting depth, sections, size — from known
  // context files (project ∪ home). Never the file's text content.
  const memory = analyzeMemoryStructure(root);

  // Deterministic (no-LLM) automations (talents-ai-score, issue 017 /
  // ADR-013-014): scripts invoking a known AI CLI, JSON-piping patterns,
  // and scheduled tasks (cron/launchd/pm2/systemd) where safely
  // inspectable. Never the script/config text, only derived counts.
  const automations = detectAutomations(root);

  // Stable per-machine anonymous id: hash of hostname + user. Not reversible
  // to personal data and only useful for deduplicating submissions, not for
  // identifying anyone.
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
    // Environment metadata: OS/architecture/Node version (process.* constants,
    // never read from a file) and which editors are installed (presence
    // booleans, EDITOR_CANDIDATES catalog above). New field, doesn't break
    // `platform` (kept as a string for compatibility with existing
    // share.js/render-html.js).
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
    // Agent org chart (ADR-009): structure + names only, never content.
    agents,
    agentCounts: agentOrgChartCounts(root, agents.length),
    // Project technologies (ADR-012): dependency manifest names only.
    technologies,
    // MCP servers by name/category (issue 015): never the raw config.
    mcp,
    // Memory structure (issue 016): imports/nesting/sections/size, never text.
    memory,
    // Automations (issue 017): script/scheduler signals, never raw content.
    automations,
  };
}

module.exports = { scan };
