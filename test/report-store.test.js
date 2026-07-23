'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

/*
 * skill-code-certification, reporting redesign v2: the report is SCOPED TO A
 * PROJECT (keyed by absolute scanned path). Each project gets its OWN report
 * file (`report-<hash>.html`) and its own state slice; different projects never
 * mix into one document. Within a project the footprint section renders only if
 * there's footprint data, the certification section only if there are certs,
 * and both only when both ran for the SAME project. Re-running either upserts in
 * place (never stacks/duplicates).
 *
 * Every test points AI_FOOTPRINT_CONFIG_DIR at a throwaway directory so the
 * store never touches the real developer machine.
 */

const store = require('../src/report-store');

let tmpConfigDir;
let prevConfigDir;

test.beforeEach(() => {
  tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-report-store-'));
  prevConfigDir = process.env.AI_FOOTPRINT_CONFIG_DIR;
  process.env.AI_FOOTPRINT_CONFIG_DIR = tmpConfigDir;
});
test.afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR;
  else process.env.AI_FOOTPRINT_CONFIG_DIR = prevConfigDir;
  fs.rmSync(tmpConfigDir, { recursive: true, force: true });
});

function report({ score = 30 } = {}) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-11T00:00:00.000Z',
    anonId: 'anon123',
    platform: 'darwin',
    environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v20.0.0', editorsInstalled: ['vscode'] },
    summary: { totalDetected: 1, categories: ['Agentic CLI'] },
    tools: [{
      id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', category: 'Agentic CLI',
      detected: true, signalTypes: ['bin'], signalCount: 1, depth: { instructions: 1 },
      footprint: { bytes: 1024, files: 3 }, recency: { bucket: 'this_week' }, version: '1.0.0',
    }],
    agents: [], agentCounts: { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    technologies: ['React'],
    mcp: { servers: [], countsByCategory: {}, total: 0 },
    tierKey: 'T2',
    _score: score,
  };
}
function maturity({ score = 30 } = {}) {
  return { level: 1, key: 'exploring', name: 'Explorando', emoji: 'x', score, tier: 2, tierKey: 'T2', tierName: 'Banco con notas', next: 'x' };
}
function certItem({ skillId = 10, score = 82, name = 'React' } = {}) {
  return {
    skillId, skillName: name, technology: name,
    sampling: { sampleable: true, includedCount: 3, candidateCount: 5, estTokens: 1000, truncated: false },
    result: { score, rationale: 'Solid usage', improvements: ['Add tests'] },
  };
}

function mkproj(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// The shareable report now uses the mockup design (render-sheet.js): BOTH the
// footprint and certifications columns ALWAYS render — a section with no data
// shows a clean empty state instead of being omitted. So "section present" =
// real content, "section absent" = its empty-state text.
const RING = 'id="ringFill"'; // footprint hero ring — present only with footprint data
const NOFOOT_EN = 'No AI footprint yet'; // footprint empty state (en)
const NOSKILLS_EN = 'No certified skills yet'; // skills empty state (en)
function countOf(html, needle) {
  return html.split(needle).length - 1;
}

test('upsertFootprint: writes report-state.json + a per-project report-<hash>.html and returns its file:// link', () => {
  const root = mkproj('proj-');
  try {
    const paths = store.upsertFootprint({ root, report: report(), maturity: maturity(), lang: 'es' });
    assert.ok(fs.existsSync(store.statePath()));
    assert.equal(paths.htmlPath, store.htmlPathFor(root), 'HTML path is the project-scoped one');
    assert.ok(fs.existsSync(paths.htmlPath));
    assert.match(path.basename(paths.htmlPath), /^report-[a-f0-9]{12}\.html$/, 'per-project file name');
    assert.equal(paths.fileUrl.startsWith('file://'), true);
    const html = fs.readFileSync(paths.htmlPath, 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.ok(html.includes(path.basename(root)), 'the project name (basename) is shown in the report header');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('redesign: the light theme background is WHITE and there is NO prefers-color-scheme dark override', () => {
  const root = mkproj('proj-');
  try {
    const paths = store.upsertFootprint({ root, report: report(), maturity: maturity(), lang: 'en' });
    const html = fs.readFileSync(paths.htmlPath, 'utf8');
    // Mockup design: default light theme maps --bg to white; dark is a MANUAL
    // data-theme toggle, never an automatic prefers-color-scheme override.
    assert.ok(html.includes('--bg:var(--white)'), 'light background token is white');
    assert.equal(/prefers-color-scheme\s*:\s*dark/.test(html), false, 'no dark-mode media query');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped: a footprint-only project shows the footprint content + a clean certs empty state', () => {
  const root = mkproj('proj-');
  try {
    const paths = store.upsertFootprint({ root, report: report(), maturity: maturity(), lang: 'en' });
    const html = fs.readFileSync(paths.htmlPath, 'utf8');
    assert.ok(html.includes('col-left') && html.includes('col-right'), 'both columns always present');
    assert.ok(html.includes(RING), 'footprint hero rendered (has data)');
    assert.ok(html.includes(NOSKILLS_EN), 'certs column shows the empty state when none certified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped: a certification-only project shows the certs content + a clean footprint empty state', () => {
  const root = mkproj('proj-');
  try {
    const paths = store.upsertCertification({ root, items: [certItem({ name: 'React' })], lang: 'en' });
    const html = fs.readFileSync(paths.htmlPath, 'utf8');
    assert.ok(html.includes('React'), 'the certified Skill is present');
    assert.equal(html.includes(RING), false, 'no footprint hero when no footprint run');
    assert.ok(html.includes(NOFOOT_EN), 'footprint column shows the empty state');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped: footprint AND certification both render for the SAME project', () => {
  const root = mkproj('proj-');
  try {
    store.upsertFootprint({ root, report: report(), maturity: maturity(), lang: 'en' });
    const paths = store.upsertCertification({ root, items: [certItem({ name: 'React' })], lang: 'en' });
    const html = fs.readFileSync(paths.htmlPath, 'utf8');
    assert.equal((html.match(/<!doctype html>/gi) || []).length, 1, 'exactly one HTML document');
    assert.ok(html.includes(RING), 'footprint hero present');
    assert.ok(html.includes('React'), 'the certified Skill is present');
    assert.equal(html.includes(NOSKILLS_EN), false, 'no certs empty state when a skill exists');
    assert.ok(html.includes(path.basename(root)), 'the project name is present');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped: different projects get SEPARATE report files and do NOT mix', () => {
  const rootA = mkproj('projA-');
  const rootB = mkproj('projB-');
  try {
    const a = store.upsertFootprint({ root: rootA, report: report({ score: 20 }), maturity: maturity({ score: 20 }), lang: 'en' });
    const b = store.upsertCertification({ root: rootB, items: [certItem({ name: 'Express' })], lang: 'en' });
    assert.notEqual(a.htmlPath, b.htmlPath, 'separate files per project');

    const htmlA = fs.readFileSync(a.htmlPath, 'utf8');
    const htmlB = fs.readFileSync(b.htmlPath, 'utf8');
    // A is footprint-only (hero + certs empty state); B is cert-only (skill +
    // footprint empty state) — neither leaks the other's data.
    assert.ok(htmlA.includes(RING) && htmlA.includes(NOSKILLS_EN), 'A: footprint + empty certs');
    assert.ok(htmlB.includes('Express') && htmlB.includes(NOFOOT_EN) && !htmlB.includes(RING), 'B: certs + empty footprint');
    assert.ok(htmlA.includes(path.basename(rootA)) && !htmlA.includes('Express'), 'A does not show B data');

    // Two separate projects in state.
    const state = store.loadState();
    assert.equal(Object.keys(state.projects).length, 2);
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('upsert: re-scanning the SAME project replaces its footprint in place (never stacks)', () => {
  const root = mkproj('proj-');
  try {
    store.upsertFootprint({ root, report: report({ score: 20 }), maturity: maturity({ score: 20 }), lang: 'es' });
    const paths = store.upsertFootprint({ root, report: report({ score: 55 }), maturity: maturity({ score: 55 }), lang: 'es' });
    const state = store.loadState();
    assert.equal(Object.keys(state.projects).length, 1, 'still one project');
    const html = fs.readFileSync(paths.htmlPath, 'utf8');
    assert.ok(html.includes('var SCORE = 55'), 'updated score drives the ring');
    assert.equal(html.includes('var SCORE = 20'), false, 'old score no longer present');
    // Exactly one footprint hero (no stacking).
    assert.equal(countOf(html, RING), 1, 'a single footprint hero');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('upsert: re-certifying the same Skill id in a project updates it in place; a different Skill adds one', () => {
  const root = mkproj('proj-');
  try {
    store.upsertCertification({ root, items: [certItem({ skillId: 10, score: 82 })], lang: 'es' });
    let state = store.loadState();
    let projKey = Object.keys(state.projects)[0];
    assert.equal(Object.keys(state.projects[projKey].certifications).length, 1);

    // Same Skill id, new score -> in-place update.
    const paths = store.upsertCertification({ root, items: [certItem({ skillId: 10, score: 40 })], lang: 'es' });
    state = store.loadState();
    assert.equal(Object.keys(state.projects[projKey].certifications).length, 1, 'same Skill id does not duplicate');
    const html = fs.readFileSync(paths.htmlPath, 'utf8');
    assert.ok(html.includes('40'), 'updated score present');

    // Different Skill id -> a second entry.
    store.upsertCertification({ root, items: [certItem({ skillId: 11, name: 'Express', score: 70 })], lang: 'es' });
    state = store.loadState();
    assert.equal(Object.keys(state.projects[projKey].certifications).length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scoped: the SAME Skill certified in two DIFFERENT projects does NOT collapse into one bucket', () => {
  const rootA = mkproj('projA-');
  const rootB = mkproj('projB-');
  try {
    store.upsertCertification({ root: rootA, items: [certItem({ skillId: 10, score: 82 })], lang: 'en' });
    store.upsertCertification({ root: rootB, items: [certItem({ skillId: 10, score: 30 })], lang: 'en' });
    const state = store.loadState();
    const a = state.projects[path.resolve(rootA)];
    const b = state.projects[path.resolve(rootB)];
    assert.ok(a && b, 'both projects exist');
    assert.equal(Object.keys(a.certifications).length, 1);
    assert.equal(Object.keys(b.certifications).length, 1);
    assert.equal(a.certifications['id:10'].item.result.score, 82, 'project A keeps its own score');
    assert.equal(b.certifications['id:10'].item.result.score, 30, 'project B keeps its own score');
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('i18n: a project report renders in both es and en with localized headings', () => {
  const root = mkproj('proj-');
  try {
    let paths = store.upsertCertification({ root, items: [certItem()], lang: 'es' });
    assert.ok(fs.readFileSync(paths.htmlPath, 'utf8').includes('>Certificaciones<'), 'Spanish heading');
    paths = store.upsertCertification({ root, items: [certItem()], lang: 'en' });
    const enHtml = fs.readFileSync(paths.htmlPath, 'utf8');
    assert.ok(enHtml.includes('>Certifications<') && enHtml.includes('>AI footprint<'), 'English headings');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migration: a v1 global state (footprints by path) is migrated to per-project; orphan global certs dropped', () => {
  const legacyRoot = path.resolve('/tmp/legacy-project-xyz');
  const v1 = {
    schemaVersion: 1,
    updatedAt: '2026-07-10T00:00:00.000Z',
    footprints: {
      [legacyRoot]: { root: legacyRoot, generatedAt: '2026-07-10T00:00:00.000Z', report: report(), maturity: maturity() },
    },
    certifications: { 'id:99': { generatedAt: '2026-07-10T00:00:00.000Z', item: certItem({ skillId: 99 }) } },
  };
  fs.mkdirSync(tmpConfigDir, { recursive: true });
  fs.writeFileSync(store.statePath(), JSON.stringify(v1));

  const state = store.loadState();
  assert.equal(state.schemaVersion, 2);
  assert.ok(state.projects[legacyRoot], 'legacy footprint migrated to a project');
  assert.ok(state.projects[legacyRoot].footprint, 'footprint preserved');
  assert.equal(Object.keys(state.projects[legacyRoot].certifications).length, 0, 'orphan global certs dropped');
});

test('certKey: stable per Skill id, independent of position', () => {
  assert.equal(store.certKey({ skillId: 7, skillName: 'X' }), store.certKey({ skillId: 7, skillName: 'Y' }));
  assert.notEqual(store.certKey({ skillId: 7 }), store.certKey({ skillId: 8 }));
});
