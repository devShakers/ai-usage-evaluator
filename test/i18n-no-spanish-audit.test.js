'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderHtml } = require('../src/render-html');
const { renderTerminal } = require('../src/render-terminal');

/*
 * talents-ai-score, i18n audit ([IMPORTANTE]): with a non-Spanish locale,
 * NOTHING in the report may be in Spanish — tier names, tier analysis,
 * section headings/labels, MCP/tool categories, roadmap content, notices.
 * This exercises a RICH synthetic report (tools, technologies, MCP
 * servers, agents, a mid-ladder tier) through both renderers at
 * lang='en' and asserts no Spanish leaks through anywhere in the CLI's
 * OWN chrome (headings/labels/analysis/roadmap).
 *
 * Deliberately excluded from the "no Spanish" sweep, by explicit, existing
 * product decision (not an i18n gap):
 *   - Roadmap snippet CODE blocks: comments/messages inside a snippet are
 *     part of the AUTHORED content and may legitimately differ from the
 *     prose around them (both source docs: "snippets are not translated"
 *     — see src/roadmap-content.js's header). Stripped out before the
 *     sweep via the <pre>...</pre> exclusion below.
 *   - Raw agent frontmatter descriptions: the TALENT'S OWN text, in
 *     whatever language they wrote it — not CLI copy. This test doesn't
 *     include any `agentDescriptions` to keep the sweep unambiguous; a
 *     dedicated exclusion isn't needed since none are present.
 */

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function stripCodeBlocks(html) {
  return html.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/```[\s\S]*?```/g, '');
}

// Accented characters and inverted punctuation cover the overwhelming
// majority of real Spanish prose; a handful of specific known Spanish
// headings are also checked directly as a second, more specific net.
const SPANISH_CHAR_RE = /[áéíóúñÁÉÍÓÚÑ¡¿]/;
const KNOWN_SPANISH_STRINGS = [
  'Herramientas', 'Entorno', 'Tecnologías', 'Agentes', 'Servidores MCP',
  'Tu próximo nivel', 'Análisis de tier', 'Criterios que cumples',
  'Banco vacío', 'Primera herramienta', 'Banco con notas', 'Banco conectado',
  'Herramienta propia', 'Operador agéntico', 'Multi-agente', 'Taller orquestado',
  'Detectadas', 'Siguiente paso', 'Nivel', 'Madurez',
];

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
  test(`renderHtml (en, ${tierKey}): no Spanish text anywhere in the report chrome`, () => {
    const html = renderHtml(reportAt(tierKey), MATURITY_BY_TIER[tierKey], 'en');
    const sweep = stripCodeBlocks(html).replace(/<style>[\s\S]*?<\/style>/, '');
    assert.equal(SPANISH_CHAR_RE.test(sweep), false, 'found an accented/Spanish-punctuation character in the English report');
    for (const spanish of KNOWN_SPANISH_STRINGS) {
      assert.equal(sweep.includes(spanish), false, `found the Spanish string "${spanish}" in the English report`);
    }
  });

  test(`renderTerminal (en, ${tierKey}): no Spanish text anywhere in the report chrome`, () => {
    const out = stripAnsi(renderTerminal(reportAt(tierKey), MATURITY_BY_TIER[tierKey], 'en'));
    assert.equal(SPANISH_CHAR_RE.test(out), false, 'found an accented/Spanish-punctuation character in the English report');
    for (const spanish of KNOWN_SPANISH_STRINGS) {
      assert.equal(out.includes(spanish), false, `found the Spanish string "${spanish}" in the English terminal report`);
    }
  });
}

test('renderHtml (en): the English tier name and section headings ARE present (positive check, not just absence)', () => {
  const html = renderHtml(reportAt('T2'), MATURITY_BY_TIER.T2, 'en');
  assert.match(html, /Tools</);
  assert.match(html, />Environment</);
  assert.match(html, /Project technologies/);
  assert.match(html, />Agents</);
  assert.match(html, /Detected MCP servers/);
  assert.match(html, /Your next level/);
  assert.match(html, /Tier analysis: why this level/);
  assert.match(html, /Bench with notes/); // English tierNames.T2
});

test('renderTerminal (en): the English tier name and section headings ARE present', () => {
  const out = stripAnsi(renderTerminal(reportAt('T2'), MATURITY_BY_TIER.T2, 'en'));
  assert.match(out, /Detected/);
  // The terminal was condensed (CPO, 2026-07-16): the "Environment" block was
  // dropped from the terminal (it stays in the HTML — see the renderHtml check
  // above). Anchor on the EN header subtitle instead, which is EN-only ("perfil
  // de uso de IA" in es) and always present, so this still verifies the EN
  // render carries English copy, not Spanish.
  assert.match(out, /AI usage profile/);
  assert.match(out, /Project technologies/);
  assert.match(out, /Agents/);
  assert.match(out, /Your next level/);
  assert.match(out, /Tier analysis: why this level/);
  assert.match(out, /Bench with notes/);
});

test('renderHtml/renderTerminal (es): Spanish locale is unaffected — Spanish headings still present', () => {
  const html = renderHtml(reportAt('T2'), { ...MATURITY_BY_TIER.T2, key: 'exploring' }, 'es');
  assert.match(html, /Tecnologías del proyecto/);
  assert.match(html, /Análisis de tier/);
  const out = stripAnsi(renderTerminal(reportAt('T2'), { ...MATURITY_BY_TIER.T2, key: 'exploring' }, 'es'));
  assert.match(out, /Análisis de tier/);
});
