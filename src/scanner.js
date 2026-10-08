'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { detectors } = require('./detectors');
const { parseAgentOrgChart } = require('./agent-org-chart');
const { detectTechnologies, detectRawDependencyNames } = require('./tech-detector');
const { detectMcpServers, buildMcpAggregate } = require('./mcp-detector');
const { analyzeMemoryStructure } = require('./memory-structure-detector');
const { detectAutomations } = require('./automations-detector');
const { detectBrowserTools } = require('./browser-tools-detector');
const { getHomeDir } = require('./env-paths');

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

// Resolves the absolute path of a projectPath/homePath signal.
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

// Recency = ONLY mtime of already-detected config files/dirs (ADR-003); never reads
// log/history content.

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

// scan() runs once per selected repo; remember each binary's version for a minute instead of asking again.
const VERSION_TTL_MS = 60 * 1000;
const versionCache = new Map();

function getVersion(bin) {
  const cached = versionCache.get(bin);
  if (cached && Date.now() - cached.at <= VERSION_TTL_MS) return cached.version;
  const version = readVersion(bin);
  versionCache.set(bin, { version, at: Date.now() });
  return version;
}

function readVersion(bin) {
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

// Per-tool depth probes.
const mcpCount = (ctx, toolId) => (ctx && ctx.mcp && ctx.mcp.byTool && ctx.mcp.byTool[toolId]) || 0;

const probes = {
  'claude-code': (root, ctx) => ({
    mcpServers: mcpCount(ctx, 'claude-code'),
    skills:
      countDirEntries(path.join(root, '.claude', 'skills')) +
      countDirEntries(path.join(os.homedir(), '.claude', 'skills')),
    commands: countFiles(path.join(root, '.claude', 'commands'), '.md'),
    instructions: exists(path.join(root, 'CLAUDE.md')) ? 1 : 0,
    hooks: countJsonKeys(path.join(root, '.claude', 'settings.json'), 'hooks'),
  }),
  cursor: (root, ctx) => ({
    rules:
      countFiles(path.join(root, '.cursor', 'rules'), '.mdc') +
      (exists(path.join(root, '.cursorrules')) ? 1 : 0),
    mcpServers: mcpCount(ctx, 'cursor'),
  }),
  'github-copilot': (root) => ({
    instructions: exists(path.join(root, '.github', 'copilot-instructions.md')) ? 1 : 0,
  }),
  windsurf: (root, ctx) => ({
    rules:
      (exists(path.join(root, '.windsurfrules')) ? 1 : 0) +
      countFiles(path.join(root, '.windsurf', 'rules'), '.md'),
    // The path (and its medium confidence) now lives in mcp-detector.js's
    // MCP_CONFIG_LOCATIONS, with the rest.
    mcpServers: mcpCount(ctx, 'windsurf'),
  }),
  aider: (root) => ({
    config: exists(path.join(root, '.aider.conf.yml')) ? 1 : 0,
  }),
  continue: (root) => ({
    config:
      (exists(path.join(root, '.continue')) ? 1 : 0) +
      (exists(path.join(os.homedir(), '.continue')) ? 1 : 0),
  }),
  'gemini-cli': (root, ctx) => ({
    instructions: exists(path.join(root, 'GEMINI.md')) ? 1 : 0,
    mcpServers: mcpCount(ctx, 'gemini-cli'),
  }),
  'codex-cli': (root) => ({
    instructions: exists(path.join(root, 'AGENTS.md')) ? 1 : 0,
  }),
  trae: (root) => ({
    // Low confidence: `.trae/rules` structure not verified (see detectors.js).
    rules: countFiles(path.join(root, '.trae', 'rules')),
  }),
};

// Agent org-chart counts (ADR-009): deterministic, structure+names only. PROJECT ∪ HOME
// per ADR-014, since the tier engine's T6 (`agents >= 2`) needs the full picture.

function agentOrgChartCounts(root, agentsCount, mcp) {
  const home = getHomeDir();
  return {
    agents: agentsCount,
    skills:
      countDirEntries(path.join(root, '.claude', 'skills')) +
      countDirEntries(path.join(home, '.claude', 'skills')),
    commands:
      countFiles(path.join(root, '.claude', 'commands'), '.md') +
      countFiles(path.join(home, '.claude', 'commands'), '.md'),
    // Issue 112: the third copy of the MCP paths lived here.
    mcpServers: (mcp && typeof mcp.total === 'number' ? mcp.total : 0),
    hooks:
      countJsonKeys(path.join(root, '.claude', 'settings.json'), 'hooks') +
      countJsonKeys(path.join(home, '.claude', 'settings.json'), 'hooks'),
  };
}

/* ---------- main scan ---------- */

function scan(options = {}) {
  const root = options.root || process.cwd();
  // MCP detection runs FIRST (issue 112), because the per-tool depth probes now read their `mcpServers` count from it.
  const mcp = detectMcpServers(root);
  const scanCtx = { mcp };

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
      // Config footprint: ONLY the aggregated size in bytes and file count, never paths or names.
      footprint: null,
      // Recency: ONLY the date derived from the most recent mtime among its
      // already-detected config files (ADR-003). Never content, logs or history.
      recency: { lastModified: null, daysSinceModified: null, bucket: null },
      // Version: only if the tool was detected via a binary on PATH; runs
      // THAT already-detected binary, with `--version` only.
      version: null,
    };

    if (detected && probes[det.id]) {
      tool.depth = probes[det.id](root, scanCtx);
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

  const technologies = detectTechnologies(root);

  const rawDependencyNames = detectRawDependencyNames(root);

  // Deterministic (no-LLM) memory STRUCTURE (talents-ai-score, issue 016 / ADR-013-014): import count, nesting depth, sections, size — from known context files (project ∪ home).
  const memory = analyzeMemoryStructure(root);

  const automations = detectAutomations(root);

  const browserTools = detectBrowserTools(rawDependencyNames, mcp);

  // Stable per-machine anonymous id: hash of hostname + user.
  const anonId = crypto
    .createHash('sha256')
    .update(`${os.hostname()}::${os.userInfo().username}`)
    .digest('hex')
    .slice(0, 12);

  return {
    schemaVersion: '1.1',
    generatedAt: new Date().toISOString(),
    anonId,
    platform: process.platform,
    scope: options.root ? 'custom' : 'cwd',
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
    agentCounts: agentOrgChartCounts(root, agents.length, mcp),
    // Projects where each detected AI tool has been used (skill-code-
    // Project technologies (ADR-012): dependency manifest names only.
    technologies,
    // MCP servers by name/category (issue 015): never the raw config.
    mcp,
    // Memory structure (issue 016): imports/nesting/sections/size, never text.
    memory,
    // Automations (issue 017): script/scheduler signals, never raw content.
    automations,
    // Browser tools (issue 018): composition over technologies + mcp.
    browserTools,
  };
}

/* ---------- multi-repo scan (per-selected-repo scoping) ---------- */

function scanForRoots(roots, options = {}) {
  const list = (Array.isArray(roots) ? roots : [roots]).filter(
    (r) => typeof r === 'string' && r && exists(r),
  );
  if (list.length === 0) return scan(options);
  const reports = list.map((r) => scan({ ...options, root: r }));
  if (reports.length === 1) return reports[0]; // 1-repo default: identical to scan()
  return mergeReports(reports);
}

function moreRecent(a, b) {
  const ad = a && typeof a.daysSinceModified === 'number' ? a.daysSinceModified : null;
  const bd = b && typeof b.daysSinceModified === 'number' ? b.daysSinceModified : null;
  if (ad === null) return bd === null ? a : b;
  if (bd === null) return a;
  return bd < ad ? b : a;
}

function mergeTools(reports) {
  const byId = new Map();
  for (const rep of reports) {
    for (const t of rep.tools || []) {
      const ex = byId.get(t.id);
      if (!ex) {
        byId.set(t.id, { ...t, depth: { ...t.depth }, signalTypes: [...(t.signalTypes || [])] });
        continue;
      }
      ex.detected = ex.detected || t.detected;
      ex.signalCount = Math.max(ex.signalCount || 0, t.signalCount || 0);
      ex.signalTypes = [...new Set([...(ex.signalTypes || []), ...(t.signalTypes || [])])];
      const keys = new Set([...Object.keys(ex.depth || {}), ...Object.keys(t.depth || {})]);
      const depth = {};
      for (const k of keys) depth[k] = Math.max((ex.depth && ex.depth[k]) || 0, (t.depth && t.depth[k]) || 0);
      ex.depth = depth;
      if (t.footprint && (!ex.footprint || (t.footprint.bytes || 0) > (ex.footprint.bytes || 0))) {
        ex.footprint = t.footprint;
      }
      ex.recency = moreRecent(ex.recency, t.recency);
      if (!ex.version && t.version) ex.version = t.version;
    }
  }
  return [...byId.values()];
}

function mergeMcp(reports) {
  const seen = new Map();
  const byTool = {};
  for (const rep of reports) {
    const mcp = rep.mcp || {};
    for (const s of mcp.servers || []) if (!seen.has(s.name)) seen.set(s.name, s);
    for (const [tool, n] of Object.entries(mcp.byTool || {})) byTool[tool] = Math.max(byTool[tool] || 0, n || 0);
  }
  return buildMcpAggregate([...seen.values()], byTool);
}

function mergeTechnologies(reports) {
  const set = new Set();
  for (const rep of reports) for (const t of rep.technologies || []) set.add(t);
  return [...set].sort();
}

function mergeMemory(reports) {
  const byId = new Map();
  for (const rep of reports) {
    for (const f of (rep.memory && rep.memory.files) || []) {
      const ex = byId.get(f.id);
      const richer =
        !ex ||
        (f.imports || 0) > (ex.imports || 0) ||
        ((f.imports || 0) === (ex.imports || 0) && (f.depth || 0) > (ex.depth || 0));
      if (richer) byId.set(f.id, f);
    }
  }
  const files = [...byId.values()];
  const totalImports = files.reduce((s, f) => s + (f.imports || 0), 0);
  const maxDepth = files.reduce((m, f) => Math.max(m, f.depth || 0), 0);
  return { files, totalImports, maxDepth, layered: maxDepth > 2 };
}

function mergeAutomations(reports) {
  let npm = 0;
  let shell = 0;
  let jsonPiping = 0;
  for (const rep of reports) {
    const a = rep.automations || {};
    npm += (a.scripts && a.scripts.npm) || 0;
    shell += (a.scripts && a.scripts.shell) || 0;
    jsonPiping += a.jsonPiping || 0;
  }
  // Schedulers (cron/launchd/pm2/systemd) probe the machine, not the repo, so
  // they are identical across roots — take the first report's block verbatim.
  const schedulers = (reports[0].automations && reports[0].automations.schedulers) || {};
  return { scripts: { npm, shell }, jsonPiping, schedulers };
}

function mergeBrowserTools(reports) {
  const deps = new Set();
  const mcpNames = new Set();
  for (const rep of reports) {
    const via = (rep.browserTools && rep.browserTools.via) || {};
    for (const d of via.dependencies || []) deps.add(d);
    for (const m of via.mcp || []) mcpNames.add(m);
  }
  const dependencies = [...deps];
  const mcp = [...mcpNames];
  return { detected: dependencies.length > 0 || mcp.length > 0, via: { dependencies, mcp }, count: dependencies.length + mcp.length };
}

function mergeAgents(reports) {
  const seen = new Set();
  const agents = [];
  for (const rep of reports) {
    for (const a of rep.agents || []) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      agents.push(a);
    }
  }
  return agents;
}

function mergeAgentCounts(reports, mcpTotal, agentsCount) {
  let skills = 0;
  let commands = 0;
  let hooks = 0;
  for (const rep of reports) {
    const c = rep.agentCounts || {};
    skills = Math.max(skills, c.skills || 0);
    commands = Math.max(commands, c.commands || 0);
    hooks = Math.max(hooks, c.hooks || 0);
  }
  return { agents: agentsCount, skills, commands, mcpServers: mcpTotal, hooks };
}

function mergeEnvironment(reports) {
  const base = reports[0].environment || {};
  const editors = new Set();
  for (const rep of reports) for (const e of (rep.environment && rep.environment.editorsInstalled) || []) editors.add(e);
  return { ...base, editorsInstalled: [...editors] };
}

function mergeReports(reports) {
  const tools = mergeTools(reports);
  const mcp = mergeMcp(reports);
  const agents = mergeAgents(reports);
  const detectedTools = tools.filter((t) => t.detected);
  return {
    // Identity/machine fields (schemaVersion, generatedAt, anonId, platform,
    // scope) are root-independent — carried from the first scan unchanged.
    ...reports[0],
    environment: mergeEnvironment(reports),
    summary: {
      totalDetected: detectedTools.length,
      categories: [...new Set(detectedTools.map((t) => t.category))],
    },
    tools,
    agents,
    agentCounts: mergeAgentCounts(reports, mcp.total, agents.length),
    technologies: mergeTechnologies(reports),
    mcp,
    memory: mergeMemory(reports),
    automations: mergeAutomations(reports),
    browserTools: mergeBrowserTools(reports),
  };
}

module.exports = { scan, scanForRoots, getVersion };
