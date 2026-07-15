'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  collectToolProjectUsage,
  flattenProjectPaths,
  decodeClaudeDirName,
  fileUriToPath,
} = require('../src/tool-project-usage');
const { renderTerminal } = require('../src/render-terminal');
const { renderHtml } = require('../src/render-html');
const { derivePayload } = require('../src/share');

/*
 * skill-code-certification / ADR-011: per-tool "projects where it was used"
 * extraction (src/tool-project-usage.js). Deterministic, LOCAL ONLY. These
 * tests drive the extractors directly against fixture home directories
 * (platform-independent, no reliance on the real machine) and assert the
 * privacy contract: discovered project paths NEVER reach the persistence
 * whitelist (src/share.js#derivePayload).
 */

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aiue-home-'));
}
function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function claudeWithCwd(home, encName, cwd) {
  const dir = path.join(home, '.claude', 'projects', encName);
  // first line has no cwd (mirrors real logs); a later line carries it
  write(path.join(dir, 'session.jsonl'), `${JSON.stringify({ type: 'meta' })}\n${JSON.stringify({ cwd })}\n`);
}
function claudeWithIndex(home, encName, projectPath) {
  const dir = path.join(home, '.claude', 'projects', encName);
  write(
    path.join(dir, 'sessions-index.json'),
    JSON.stringify({ version: 1, entries: [{ sessionId: 's1', projectPath }] }, null, 2),
  );
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
}
function claudeBare(home, encName) {
  fs.mkdirSync(path.join(home, '.claude', 'projects', encName), { recursive: true });
}
function cursorWorkspace(home, hash, folderPath) {
  const dir = path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', hash);
  write(path.join(dir, 'workspace.json'), JSON.stringify({ folder: `file://${folderPath}` }));
}

const CLAUDE = { id: 'claude-code', name: 'Claude Code' };
const CURSOR = { id: 'cursor', name: 'Cursor' };
const WINDSURF = { id: 'windsurf', name: 'Windsurf' };

test('claude-code: real cwd from a session file is resolved EXACTLY (not approximate)', () => {
  const home = tmpHome();
  claudeWithCwd(home, '-Users-alex-foo-bar', '/Users/alex/foo/bar');
  const [entry] = collectToolProjectUsage([CLAUDE], { home });
  assert.equal(entry.available, true);
  assert.equal(entry.sourceKey, 'claudeSessions');
  assert.deepEqual(entry.projects, [{ path: '/Users/alex/foo/bar', approximate: false }]);
});

test('claude-code: sessions-index.json projectPath is used when there is no .jsonl (exact)', () => {
  const home = tmpHome();
  // The dir name decode would be lossy (real dash in "back-v2"); the index gives the truth.
  claudeWithIndex(home, '-Users-alex-back-v2-api', '/Users/alex/back-v2/api');
  const [entry] = collectToolProjectUsage([CLAUDE], { home });
  assert.deepEqual(entry.projects, [{ path: '/Users/alex/back-v2/api', approximate: false }]);
});

test('claude-code: with neither cwd nor index, falls back to a lossy decode flagged approximate', () => {
  const home = tmpHome();
  claudeBare(home, '-Users-alex-foo-bar');
  const [entry] = collectToolProjectUsage([CLAUDE], { home });
  assert.equal(entry.projects.length, 1);
  assert.equal(entry.projects[0].approximate, true);
  assert.equal(entry.projects[0].path, '/Users/alex/foo/bar');
});

test('claude-code: exact source wins over the approximate decode when deduping the same path', () => {
  const home = tmpHome();
  claudeWithCwd(home, '-Users-alex-x', '/Users/alex/x'); // exact
  const [entry] = collectToolProjectUsage([CLAUDE], { home });
  assert.deepEqual(entry.projects, [{ path: '/Users/alex/x', approximate: false }]);
});

test('cursor: workspace.json folder URIs are decoded to paths (opened workspaces)', () => {
  const home = tmpHome();
  cursorWorkspace(home, 'hashB', '/Users/alex/beta');
  cursorWorkspace(home, 'hashA', '/Users/alex/alpha');
  const [entry] = collectToolProjectUsage([CURSOR], { home });
  assert.equal(entry.available, true);
  assert.equal(entry.sourceKey, 'cursorWorkspaces');
  // sorted lexicographically → deterministic
  assert.deepEqual(entry.projects.map((p) => p.path), ['/Users/alex/alpha', '/Users/alex/beta']);
});

test('a detected tool with no local history mechanism is honestly reported unavailable', () => {
  const home = tmpHome();
  const [entry] = collectToolProjectUsage([WINDSURF], { home });
  assert.equal(entry.available, false);
  assert.equal(entry.sourceKey, null);
  assert.deepEqual(entry.projects, []);
});

test('output is deterministic — same fixture yields identical results', () => {
  const home = tmpHome();
  claudeWithCwd(home, '-Users-alex-a', '/Users/alex/a');
  cursorWorkspace(home, 'h1', '/Users/alex/b');
  const a = collectToolProjectUsage([CLAUDE, CURSOR], { home });
  const b = collectToolProjectUsage([CLAUDE, CURSOR], { home });
  assert.deepEqual(a, b);
});

test('flattenProjectPaths merges, dedupes and sorts across tools', () => {
  const usage = [
    { toolId: 'claude-code', projects: [{ path: '/z' }, { path: '/a' }] },
    { toolId: 'cursor', projects: [{ path: '/a' }, { path: '/m' }] },
    { toolId: 'windsurf', projects: [] },
  ];
  assert.deepEqual(flattenProjectPaths(usage), ['/a', '/m', '/z']);
});

test('decodeClaudeDirName strips the leading dash and turns dashes into separators', () => {
  assert.equal(decodeClaudeDirName('-Users-alex-foo'), '/Users/alex/foo');
});

test('fileUriToPath decodes file:// URIs and percent-encoding, rejects non-file input', () => {
  assert.equal(fileUriToPath('file:///Users/alex/my%20app'), '/Users/alex/my app');
  assert.equal(fileUriToPath('/not/a/uri'), null);
  assert.equal(fileUriToPath(undefined), null);
});

/* ---------- rendering parity (terminal + HTML) ---------- */

const BASE_REPORT = {
  schemaVersion: 1,
  generatedAt: '2026-07-15T00:00:00.000Z',
  anonId: 'anon',
  platform: 'darwin',
  environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v20.0.0', editorsInstalled: [] },
  summary: { totalDetected: 0, categories: [] },
  tools: [],
  agents: [],
  agentCounts: { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
  technologies: [],
  mcp: { servers: [], countsByCategory: {}, total: 0 },
};
const MATURITY = { level: 2, key: 'integrated', name: 'Integrado', score: 40, emoji: '◑', tierKey: 'T3', next: 'x' };

const USAGE = [
  { toolId: 'claude-code', toolName: 'Claude Code', available: true, sourceKey: 'claudeSessions', projects: [{ path: '/Users/alex/proj-one', approximate: false }] },
  { toolId: 'windsurf', toolName: 'Windsurf', available: false, sourceKey: null, projects: [] },
];

test('renderTerminal: lists projects per tool and the unavailable note', () => {
  const out = renderTerminal({ ...BASE_REPORT, toolProjectUsage: USAGE }, MATURITY, 'en');
  assert.match(out, /Projects by AI tool/);
  assert.match(out, /\/Users\/alex\/proj-one/);
  assert.match(out, /does not expose a local project history/);
});

test('renderTerminal: the whole section is omitted when nothing is available', () => {
  const empty = [{ toolId: 'windsurf', toolName: 'Windsurf', available: false, sourceKey: null, projects: [] }];
  const out = renderTerminal({ ...BASE_REPORT, toolProjectUsage: empty }, MATURITY, 'en');
  assert.doesNotMatch(out, /Projects by AI tool/);
});

test('renderHtml: renders the projects-per-tool section with the discovered path', () => {
  const html = renderHtml({ ...BASE_REPORT, toolProjectUsage: USAGE }, MATURITY, 'en');
  assert.match(html, /Projects by AI tool/);
  assert.match(html, /\/Users\/alex\/proj-one/);
});

test('renderHtml: section omitted when no tool exposes a history', () => {
  const empty = [{ toolId: 'windsurf', toolName: 'Windsurf', available: false, sourceKey: null, projects: [] }];
  const html = renderHtml({ ...BASE_REPORT, toolProjectUsage: empty }, MATURITY, 'en');
  assert.doesNotMatch(html, /Projects by AI tool/);
});

/* ---------- privacy contract: project paths are NEVER persisted ---------- */

test('derivePayload does NOT include toolProjectUsage nor any discovered project path', () => {
  const secretPath = '/Users/alex/clients/acme-under-nda/secret-repo';
  const report = {
    ...BASE_REPORT,
    summary: { totalDetected: 1, categories: ['assistant'] },
    tools: [{ id: 'claude-code', detected: true, depth: {} }],
    toolProjectUsage: [
      { toolId: 'claude-code', toolName: 'Claude Code', available: true, sourceKey: 'claudeSessions', projects: [{ path: secretPath, approximate: false }] },
    ],
  };
  const payload = derivePayload(report, MATURITY);
  assert.equal('toolProjectUsage' in payload, false);
  assert.doesNotMatch(JSON.stringify(payload), new RegExp('acme-under-nda'));
});
