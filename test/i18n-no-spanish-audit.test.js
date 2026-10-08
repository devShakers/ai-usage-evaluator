'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTerminal } = require('../src/render-terminal');
const { renderSheet } = require('../src/render-sheet');

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function stripCodeBlocks(html) {
  return html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/```[\s\S]*?```/g, '');
}

const SPANISH_CHAR_RE = /[áéíóúñÁÉÍÓÚÑ¡¿]/;
const KNOWN_SPANISH_STRINGS = [
  'Herramientas', 'Entorno', 'Tecnologías', 'Agentes', 'Servidores MCP',
  'Tu próximo nivel', 'Análisis de tier', 'Criterios que cumples',
  'Banco vacío', 'Primera herramienta', 'Banco con notas', 'Banco conectado',
  'Herramienta propia', 'Operador agéntico', 'Multi-agente', 'Taller orquestado',
  'Detectadas', 'Siguiente paso', 'Nivel', 'Madurez',
];

// UNACCENTED Spanish, which the character net above is structurally blind to.
const KNOWN_SPANISH_STRINGS_UNACCENTED = [
  'Informe de uso de IA', 'Informe generado localmente',
  'Uso de IA', 'Certificaciones', 'Nivel de setup',
  'Herramientas detectadas', 'Clientes de IA presentes',
  'Stack reconocido en el repositorio',
  'Cambiar tema', 'Oscuro', 'Claro', 'Copiado',
  'Expandir todo', 'Colapsar todo',
  // Issue 054, the anchored-quote copy.
  'De tus respuestas', 'Cita no verificada: no se muestra.',
];

const ALL_KNOWN_SPANISH = [...KNOWN_SPANISH_STRINGS, ...KNOWN_SPANISH_STRINGS_UNACCENTED];

function reportAt(tierKey) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-11T00:00:00.000Z',
    anonId: 'anon123',
    platform: 'darwin',
    environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v20.0.0', editorsInstalled: ['vscode'] },
    summary: { totalDetected: 1, categories: ['Agentic CLI'] },
    tools: [
      {
        id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', category: 'Agentic CLI',
        detected: true, signalTypes: ['bin'], signalCount: 1,
        depth: { instructions: 1, mcpServers: 1, skills: 1 },
        footprint: { bytes: 1024, files: 3 },
        recency: { lastModified: '2026-07-10T00:00:00.000Z', daysSinceModified: 1, bucket: 'this_week' },
        version: '1.0.0',
      },
    ],
    agents: [{ name: 'backend-dev', tools: ['Read', 'Write'], model: 'sonnet', parent: null }],
    agentCounts: { agents: 1, skills: 1, commands: 1, mcpServers: 1, hooks: 0 },
    technologies: ['NestJS', 'React'],
    mcp: {
      servers: [{ name: 'postgres', category: 'data' }, { name: 'playwright-mcp', category: 'browser' }],
      countsByCategory: { data: 1, comms: 0, dev: 0, browser: 1, other: 0 },
      total: 2,
    },
    tierKey,
  };
}

const MATURITY_BY_TIER = {
  T2: { level: 1, key: 'exploring', name: 'Explorando', emoji: 'x', score: 30, tier: 2, tierKey: 'T2', tierName: 'Banco con notas', next: 'x' },
  T7: { level: 4, key: 'orchestrator', name: 'Orquestador', emoji: 'x', score: 100, tier: 7, tierKey: 'T7', tierName: 'Taller orquestado', next: 'x' },
};

for (const tierKey of ['T2', 'T7']) {
  test(`renderTerminal (en, ${tierKey}): no Spanish text anywhere in the report chrome`, () => {
    // Sweep BOTH the default report and the --roadmap-only output (each has its
    // own copy) so no Spanish leaks in either mode.
    const out = stripAnsi(renderTerminal(reportAt(tierKey), MATURITY_BY_TIER[tierKey], 'en'))
      + '\n' + stripAnsi(renderTerminal(reportAt(tierKey), MATURITY_BY_TIER[tierKey], 'en', { showRoadmap: true }));
    assert.equal(SPANISH_CHAR_RE.test(out), false, 'found an accented/Spanish-punctuation character in the English report');
    for (const spanish of KNOWN_SPANISH_STRINGS) {
      assert.equal(out.includes(spanish), false, `found the Spanish string "${spanish}" in the English terminal report`);
    }
  });
}

test('renderTerminal (en): the English tier name and section headings ARE present', () => {
  // Default mode carries the report headings + tier name (Environment is HTML-only after the CPO condense; "AI usage profile" is the EN-only header subtitle, always present).
  const def = stripAnsi(renderTerminal(reportAt('T2'), MATURITY_BY_TIER.T2, 'en'));
  assert.match(def, /Detected/);
  assert.match(def, /AI usage profile/);
  assert.equal(def.includes('Skills'), false);
  assert.match(def, /Agents/);
  assert.match(def, /Tier analysis: why this level/);
  // ADR-016: the roadmap heading + the (English) next-tier name live in the
  // --roadmap-only output.
  const road = stripAnsi(renderTerminal(reportAt('T2'), MATURITY_BY_TIER.T2, 'en', { showRoadmap: true }));
  assert.match(road, /Your next AI-usage level/);
  assert.match(road, /Bench with notes/); // English tierNames.T2, in the roadmap title
});

// The SHAREABLE project report (src/render-sheet.js + its src/templates/report-sheet.html), added by issue 048.

const SHEET_PROJECT = {
  root: '/tmp/demo-project',
  footprint: { report: reportAt('T2'), maturity: MATURITY_BY_TIER.T2 },
  certifications: {
    'skill-1': {
      generatedAt: '2026-07-11T00:00:00.000Z',
      item: {
        skillId: 'skill-1',
        skillName: 'React',
        technology: 'React',
        sampling: { sampleable: true, sampledFiles: 2, totalFiles: 2 },
        result: { score: 90, rationale: 'Solid component composition.', improvements: ['Add tests.'] },
      },
    },
  },
  // Agent certifications were removed from the report (ADR-033); the sheet renders
  // Skill certifications only.
};

const EMPTY_SHEET_PROJECT = { root: '/tmp/empty-project', footprint: null, certifications: {} };

function sweepSheet(project) {
  // Drop the <style> block and every inline SVG (the wordmark's path data is
  // opaque coordinates, not copy) so the sweep looks only at real text.
  return renderSheet(project, 'en')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '');
}

for (const [label, project] of [['populated', SHEET_PROJECT], ['empty', EMPTY_SHEET_PROJECT]]) {
  test(`renderSheet (en, ${label}): no Spanish text anywhere in the shareable report`, () => {
    const sweep = sweepSheet(project);
    assert.equal(SPANISH_CHAR_RE.test(sweep), false, 'found an accented/Spanish-punctuation character in the English sheet');
    for (const spanish of ALL_KNOWN_SPANISH) {
      assert.equal(sweep.includes(spanish), false, `found the Spanish string "${spanish}" in the English sheet`);
    }
  });
}

test('renderSheet (en): the English chrome IS present, including the template and its inline script', () => {
  const html = renderSheet(SHEET_PROJECT, 'en');
  // Document + header title (the string that used to be hardcoded Spanish).
  assert.match(html, /<title>Shakers · AI usage report<\/title>/);
  assert.match(html, /AI usage report/);
  assert.match(html, /<html lang="en"/);
  // Body copy, from the catalog.
  assert.match(html, />AI usage</);
  assert.match(html, />Certifications</);
  assert.match(html, /Setup Level/);
  assert.match(html, /Detected tools/);
  assert.match(html, /Project technologies/);
  assert.match(html, /Report generated locally/);
  assert.match(html, /Toggle theme/);
  assert.match(html, /Dark/);
  assert.match(html, /Light/);
  assert.match(html, /Copied/);
  assert.match(html, /Expand all/);
  assert.match(html, /Collapse all/);
  // The issue-054 anchored-quote copy was agent-certification display (ADR-033): removed with the agent cert tab, so it no longer renders here.
  assert.doesNotMatch(html, /__[A-Z_]+__/);
});

test('renderSheet (es): Spanish locale is unaffected — the Spanish chrome is still there', () => {
  const html = renderSheet(SHEET_PROJECT, 'es');
  assert.match(html, /<title>Shakers · Informe de uso de IA<\/title>/);
  assert.match(html, /<html lang="es"/);
  assert.match(html, />Uso de IA</);
  assert.match(html, />Certificaciones</);
  assert.match(html, /Tecnologías del proyecto/);
  assert.match(html, /Expandir todo/);
  assert.match(html, /Colapsar todo/);
  assert.match(html, /Cambiar tema/);
  // The issue-054 anchored-quote copy was agent-certification display (ADR-033):
  // removed with the agent cert tab, so it no longer renders here.
  assert.doesNotMatch(html, /__[A-Z_]+__/);
});

test('renderTerminal (es): Spanish locale is unaffected — Spanish headings still present', () => {
  // The renderHtml half of this test went with issue 090: that document has not been reachable from production since 7fae2c8, so asserting Spanish survived in it proved nothing.
  const out = stripAnsi(renderTerminal(reportAt('T2'), { ...MATURITY_BY_TIER.T2, key: 'exploring' }, 'es'));
  assert.match(out, /Análisis de tier/);
});
