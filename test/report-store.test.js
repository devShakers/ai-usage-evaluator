'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

/*
 * skill-code-certification, reporting redesign: the cumulative local report.
 * ONE persistent report.html that fills in over time — footprint UPSERTED per
 * scanned project path, certification UPSERTED per Skill id — regenerated WHOLE
 * from report-state.json each run (never spliced/partially overwritten).
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

test('upsertFootprint: writes report-state.json + report.html and returns a file:// link to the HTML', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  try {
    const paths = store.upsertFootprint({ root, report: report(), maturity: maturity(), lang: 'es' });
    assert.ok(fs.existsSync(store.statePath()));
    assert.ok(fs.existsSync(store.htmlPath()));
    assert.equal(paths.fileUrl.startsWith('file://'), true);
    assert.equal(paths.fileUrl.endsWith('report.html'), true);
    const html = fs.readFileSync(store.htmlPath(), 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.ok(html.includes(root), 'the project path is shown in its footprint block');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('redesign: the report background is WHITE and there is NO prefers-color-scheme dark override', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  try {
    store.upsertFootprint({ root, report: report(), maturity: maturity(), lang: 'en' });
    const html = fs.readFileSync(store.htmlPath(), 'utf8');
    assert.ok(html.includes('--bg:var(--ds-white)'), 'background token is white (#ffffff)');
    assert.equal(/prefers-color-scheme\s*:\s*dark/.test(html), false, 'no dark-mode media query');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cumulative: a footprint is UPSERTED by project path — same path updates in place, a different path adds a second block', () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'projA-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'projB-'));
  try {
    store.upsertFootprint({ root: rootA, report: report({ score: 20 }), maturity: maturity({ score: 20 }), lang: 'es' });
    // Same path again with a new score -> updates in place (still ONE entry).
    store.upsertFootprint({ root: rootA, report: report({ score: 55 }), maturity: maturity({ score: 55 }), lang: 'es' });
    let state = store.loadState();
    assert.equal(Object.keys(state.footprints).length, 1, 'same project path does not duplicate');
    let html = fs.readFileSync(store.htmlPath(), 'utf8');
    assert.ok(html.includes('55'), 'updated score present');
    assert.equal(html.includes('data-target="20"'), false, 'old score no longer in the meter');

    // A different path -> a second footprint block, first still present.
    store.upsertFootprint({ root: rootB, report: report({ score: 90 }), maturity: maturity({ score: 90 }), lang: 'es' });
    state = store.loadState();
    assert.equal(Object.keys(state.footprints).length, 2);
    html = fs.readFileSync(store.htmlPath(), 'utf8');
    assert.ok(html.includes(rootA) && html.includes(rootB), 'both projects present');
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('cumulative: a certification is UPSERTED by Skill id — re-certifying the same Skill updates in place, never appends', () => {
  store.upsertCertification({ items: [certItem({ skillId: 10, score: 82 })], lang: 'es' });
  let state = store.loadState();
  assert.equal(Object.keys(state.certifications).length, 1);

  // Re-certify the SAME Skill id with a new score -> in-place update.
  store.upsertCertification({ items: [certItem({ skillId: 10, score: 40 })], lang: 'es' });
  state = store.loadState();
  assert.equal(Object.keys(state.certifications).length, 1, 'same Skill id does not duplicate');
  const html = fs.readFileSync(store.htmlPath(), 'utf8');
  assert.ok(html.includes('40'), 'updated score present');

  // A different Skill id -> a second certification entry.
  store.upsertCertification({ items: [certItem({ skillId: 11, name: 'Express', score: 70 })], lang: 'es' });
  state = store.loadState();
  assert.equal(Object.keys(state.certifications).length, 2);
});

test('cumulative: footprint AND certification coexist in ONE document', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  try {
    store.upsertFootprint({ root, report: report(), maturity: maturity(), lang: 'en' });
    store.upsertCertification({ items: [certItem({ name: 'React' })], lang: 'en' });
    const html = fs.readFileSync(store.htmlPath(), 'utf8');
    // one document, both sections
    assert.equal((html.match(/<!doctype html>/gi) || []).length, 1, 'exactly one HTML document');
    assert.ok(html.includes('AI Footprint'), 'footprint section heading (en)');
    assert.ok(html.includes('Skill certification'), 'certification section heading (en)');
    assert.ok(html.includes('React'), 'the certified Skill is present');
    assert.ok(html.includes(root), 'the footprint project is present');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('i18n: the cumulative report renders in both es and en with the localized headings', () => {
  store.upsertCertification({ items: [certItem()], lang: 'es' });
  const es = fs.readFileSync(store.htmlPath(), 'utf8');
  assert.ok(es.includes('Certificación de Skills'), 'Spanish certification heading');

  store.upsertCertification({ items: [certItem()], lang: 'en' });
  const en = fs.readFileSync(store.htmlPath(), 'utf8');
  assert.ok(en.includes('Skill certification'), 'English certification heading');
});

test('certKey: stable per Skill id, independent of position', () => {
  assert.equal(store.certKey({ skillId: 7, skillName: 'X' }), store.certKey({ skillId: 7, skillName: 'Y' }));
  assert.notEqual(store.certKey({ skillId: 7 }), store.certKey({ skillId: 8 }));
});
