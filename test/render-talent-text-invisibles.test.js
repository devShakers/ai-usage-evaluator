'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');
const { buildAgentCardTree } = require('../src/render-html');
const { renderTerminal } = require('../src/render-terminal');
const { renderSheet } = require('../src/render-sheet');
const { renderCertificationTerminal } = require('../src/render-certification');
const { buildCertsPayload } = require('../src/graph-certs');
const { buildFootprintDrawer } = require('../src/graph-scan');
const { getRoadmapEntry } = require('../src/roadmap-content');

// talents-ai-score, issue 055 — EVERY LITERAL TEXT FIELD THAT REACHES A HUMAN IS NEUTRALISED, ON EVERY SURFACE THAT PAINTS IT.

const RLO = '\u202E'; // reorders what a human reads
const ZWSP = '\u200B'; // splits a word with no visible trace

let fieldSeq = 0;
const FIELDS = {};
/** Unique, greppable poison per field: `FLDnnnQ<ZWSP>x<RLO>`. */
function poison(field) {
  fieldSeq += 1;
  const stem = `FLD${String(fieldSeq).padStart(3, '0')}Q`;
  FIELDS[field] = { stem, raw: `${stem}${ZWSP}x${RLO}`, marked: `${stem}[U+200B]x[U+202E]` };
  return FIELDS[field].raw;
}

// * The fixtures: one poisoned value per inventoried field `poison()` REGISTERS as it generates, so every fixture is built exactly once, eagerly, and shared.

const AGENT_NAME = poison('agents[].name');
const SYNTH_AGENT_NAME = 'synth-agent';

function buildReport() {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-31T00:00:00.000Z',
    anonId: 'a1b2c3d4e5f6', // NOT poisoned — see the declared-exception test below
    platform: 'darwin',
    environment: {
      platform: 'darwin', arch: 'arm64', nodeVersion: 'v18.20.8',
      editorsInstalled: [poison('environment.editorsInstalled[]')],
    },
    summary: { totalDetected: 2, categories: ['Agentic CLI', 'IDE'] },
    tools: [
      {
        id: 'claude-code', name: poison('tools[].name'), vendor: 'Anthropic',
        category: 'Agentic CLI', detected: true, signalTypes: ['bin'], signalCount: 1,
        depth: { instructions: 1, mcpServers: 1, skills: 1 },
        footprint: { bytes: 1024, files: 3 },
        recency: { lastModified: '2026-07-30T00:00:00.000Z', daysSinceModified: 1, bucket: 'this_week' },
        version: poison('tools[].version'),
      },
      {
        id: 'cursor', name: 'Cursor', vendor: poison('tools[].vendor'),
        category: 'IDE', detected: true, signalTypes: ['homePath'], signalCount: 1,
        depth: {}, footprint: null,
        recency: { lastModified: null, daysSinceModified: null, bucket: null },
        version: null,
      },
    ],
    agents: [
      { name: AGENT_NAME, tools: [poison('agents[].tools[]')], model: 'sonnet', parent: null },
      { name: SYNTH_AGENT_NAME, tools: [], model: 'sonnet', parent: null },
    ],
    agentDescriptions: [],
    agentCounts: { agents: 2, skills: 1, commands: 1, mcpServers: 1, hooks: 0 },
    technologies: [poison('technologies[]')],
    mcp: {
      servers: [{ name: poison('mcp.servers[].name'), category: 'data' }],
      countsByCategory: { data: 1, comms: 0, dev: 0, browser: 0, other: 0 }, total: 1,
    },
    agentSynthesis: { agents: [{
      name: SYNTH_AGENT_NAME,
      symbolicName: poison('agentSynthesis.symbolicName'),
      whatItDoes: poison('agentSynthesis.whatItDoes'),
    }] },
    agentEvaluation: { evaluations: [{
      // Must be the AGENT's name: `buildAgentCardTree` joins evaluations to cards
      // by normalized name, so an unmatched evaluation is silently never painted.
      name: AGENT_NAME,
      description: poison('agentEvaluation.description'),
      rationale: poison('agentEvaluation.rationale'),
      improvements: [poison('agentEvaluation.improvements[]')],
      // Catalog level (L1|L2|L3), not the credential level P1..P5 (issue 097).
      classification: { catalogId: 'x', category: 'developer', role: poison('agentEvaluation.classification.role'), level: 'L1', method: 'llm' },
    }] },
    // The four fields mergeRoadmapPersonalization replaces with MODEL output.
    roadmapPersonalization: (() => {
      const curated = getRoadmapEntry('T2', 'es') || {};
      const pad = (n, first) => [first, ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => `filler ${i}`)];
      return {
        whatUnlocks: poison('roadmap.whatUnlocks'),
        steps: pad((curated.steps || []).length, { text: poison('roadmap.steps[].text'), estimate: poison('roadmap.steps[].estimate') })
          .map((x) => (typeof x === 'string' ? { text: x, estimate: '1h' } : x)),
        tips: pad((curated.tips || []).length, poison('roadmap.tips[]')),
        mistakes: pad((curated.commonMistakes || []).length, poison('roadmap.mistakes[]')),
      };
    })(),
    tierKey: 'T2',
  };
}

const MATURITY = {
  level: 1, key: 'exploring', name: 'Explorando', emoji: 'x',
  score: 30, tier: 2, tierKey: 'T2', tierName: 'Banco con notas', next: 'x',
};

function certItem() {
  return {
    skillId: 7, skillName: poison('cert.skillName'), technology: poison('cert.technology'),
    sampling: { sampleable: true, includedCount: 1, candidateCount: 1, estTokens: 10, truncated: false },
    result: { score: 88, rationale: poison('cert.result.rationale'), improvements: [poison('cert.result.improvements[]')], dimensions: null },
    fileAttribution: [{ path: poison('cert.fileAttribution[].path'), authors: [poison('cert.fileAttribution[].authors[]')], attributed: true }],
    authorEmails: [{ email: poison('cert.authorEmails[].email'), matched: true }],
    repository: poison('cert.repository'),
    commitRange: 'abc1234..def5678', // NOT poisoned — declared exception, see below
  };
}

const CERT_ITEM = certItem();
const CERTIFICATION = {
  items: [CERT_ITEM],
  authorship: { repository: poison('cert.authorship.repository'), commitRange: 'abc1234..def5678' },
};

const PROJECT_DIR = poison('project.root(basename)');
const REPORT = buildReport();

function project() {
  return {
    root: `/tmp/${PROJECT_DIR}`,
    footprint: { report: REPORT, maturity: MATURITY },
    certifications: { 'id:7': { generatedAt: '2026-07-31T00:00:00Z', item: CERT_ITEM } },
    agentCertifications: {},
    backendAcceptance: {},
  };
}

const RAW_DUMP_RE = /<details>[\s\S]*?<\/details>/g;

function surfaces() {
  const t = getCatalog('es');
  return {
    renderTerminal: renderTerminal(REPORT, MATURITY, 'es'),
    'renderTerminal --roadmap': renderTerminal(REPORT, MATURITY, 'es', { showRoadmap: true }),
    renderSheet: renderSheet(project(), 'es'),
    certTerminal: renderCertificationTerminal(CERTIFICATION, 'es'),
    graphCertsPayload: JSON.stringify(buildCertsPayload(project(), 'es')),
  };
}

// The detector, proved non-vacuous below: every character in the marked-invisible family, in RAW form.
const RAW_INVISIBLE_RE = new RegExp(
  '[\\u00AD\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180E\\u200B-\\u200F' +
    '\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069' +
    '\\u3164\\uFEFF\\uFFA0]|[\\u{E0000}-\\u{E007F}]',
  'gu',
);

test('the detector is not vacuous: it does catch the raw characters', () => {
  // Without this, every "no raw invisible" assertion below could be passing
  // because the regex is broken rather than because the renderers are correct.
  assert.equal(RAW_INVISIBLE_RE.test(`x${RLO}y`), true);
  RAW_INVISIBLE_RE.lastIndex = 0;
  assert.equal(RAW_INVISIBLE_RE.test('clean text'), false);
  RAW_INVISIBLE_RE.lastIndex = 0;
});

test('no swept surface leaks a RAW invisible character, anywhere', () => {
  for (const [name, out] of Object.entries(surfaces())) {
    RAW_INVISIBLE_RE.lastIndex = 0;
    const found = (String(out).match(RAW_INVISIBLE_RE) || []).map(
      (ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase(),
    );
    assert.deepEqual(found, [], `${name} leaked raw invisibles: ${found.join(', ')}`);
  }
});

test('the inventory: every poisoned field is painted MARKED on at least one surface, and RAW on none', () => {
  // The load-bearing test of this file, and the reason it is table-driven.
  const rendered = surfaces();
  const unpainted = [];
  for (const [field, { raw, marked }] of Object.entries(FIELDS)) {
    if (UNPAINTED_SINCE_090.has(field)) continue;
    const rawOn = [];
    const markedOn = [];
    for (const [name, out] of Object.entries(rendered)) {
      if (String(out).includes(raw)) rawOn.push(name);
      if (String(out).includes(marked)) markedOn.push(name);
    }
    assert.deepEqual(rawOn, [], `${field} is painted RAW on: ${rawOn.join(', ')}`);
    if (markedOn.length === 0) unpainted.push(field);
  }
  assert.deepEqual(
    unpainted, [],
    'these inventoried fields are no longer painted anywhere, so the sweep silently stopped covering them: '
      + unpainted.join(', '),
  );
});

// The nine fields the 090 sweep found painted by NOTHING once the unreachable HTML documents left this file's `surfaces()`.
const UNPAINTED_SINCE_090 = new Set([
  'cert.fileAttribution[].path',
  'cert.fileAttribution[].authors[]',
  'cert.repository',
  'environment.editorsInstalled[]',
  'tools[].vendor',
  'mcp.servers[].name',
  'agentEvaluation.rationale',
  'roadmap.tips[]',
  'roadmap.mistakes[]',
]);

test('the 090 exclusion list is exact: every entry is still unpainted, and nothing else is', () => {
  // The guard on the guard.
  const rendered = surfaces();
  const paintedSomewhere = (marked) => Object.values(rendered).some((out) => String(out).includes(marked));
  for (const field of UNPAINTED_SINCE_090) {
    assert.ok(FIELDS[field], `${field} is not in the inventory any more — drop it from the exclusion list too`);
    assert.equal(paintedSomewhere(FIELDS[field].marked), false,
      `${field} IS painted again: remove it from UNPAINTED_SINCE_090 so its coverage counts`);
  }
});

test('an agent name carrying an invisible still nests under its parent (the join key survives)', () => {
  // `buildAgentCardTree` sanitizes `name` AND `parent`, and it has to be both.
  const parentName = `orchestrator${ZWSP}-main`;
  const rep = {
    ...REPORT,
    agents: [
      { name: parentName, tools: [], model: 'sonnet', parent: null },
      { name: 'worker', tools: [], model: 'sonnet', parent: parentName },
    ],
    agentSynthesis: null,
    agentEvaluation: null,
  };
  const { childrenByParent, roots } = buildAgentCardTree(rep, getCatalog('es'));

  assert.equal(roots.length, 1, 'the orchestrator is the only root');
  assert.equal(roots[0].name, 'orchestrator[U+200B]-main', 'the painted name is marked');
  const children = childrenByParent.get(roots[0].name) || [];
  assert.deepEqual(children.map((c) => c.name), ['worker'], 'the child is still attached to its parent');

  // The end-to-end half of this test used to paint the tree through `renderHtml`; it went with issue 090 (that document is unreachable from production since 7fae2c8).
});

// * The raw-data disclosure: its TEST WAS DELETED, because its SURFACE is gone * `jsonEscapeInvisibleChars` and its test lived here.

test('declared exceptions: anonId and commitRange cannot carry an invisible by construction', () => {
  assert.match(REPORT.anonId, /^[0-9a-f]{12}$/, 'anonId is a hex digest slice');
  assert.match(CERT_ITEM.commitRange, /^[0-9a-f]+\.\.[0-9a-f]+$/, 'commitRange is hex short-shas');
});

test('buildFootprintDrawer marks tools and technologies (one pass, sheet + graph drawer)', () => {
  // This payload is built from the PERSISTED report-store copy, which is a file on
  // the Talent's own disk, and it feeds two renderers that only `esc()`.
  const fp = buildFootprintDrawer(REPORT, MATURITY);
  assert.deepEqual(fp.tools, [FIELDS['tools[].name'].marked, 'Cursor']);
  assert.deepEqual(fp.technologies, [FIELDS['technologies[]'].marked]);
});

test('the skill-cert payload marks the technology, the skill name and the model prose', () => {
  const payload = buildCertsPayload(project(), 'es');
  const skill = payload.skills[0];
  assert.ok(skill.name.includes(FIELDS['cert.skillName'].marked), 'skillName marked');
  assert.ok(skill.name.includes(FIELDS['cert.technology'].marked), 'technology marked');
  assert.ok(skill.rationale.includes(FIELDS['cert.result.rationale'].marked), 'rationale marked');
  assert.ok(skill.improvements[0].includes(FIELDS['cert.result.improvements[]'].marked), 'improvements marked');
});

// ISSUE 093 CUT THIS TEST IN HALF, and the half it cut is the point.
test('the ADR-025 authorship receipt marks the repo and the git identities (terminal)', () => {
  const term = renderCertificationTerminal(CERTIFICATION, 'es');
  RAW_INVISIBLE_RE.lastIndex = 0;
  assert.equal(RAW_INVISIBLE_RE.test(term), false);
  RAW_INVISIBLE_RE.lastIndex = 0;
  assert.ok(term.includes(FIELDS['cert.authorship.repository'].marked), 'run-level repository marked (terminal)');
  assert.ok(term.includes(FIELDS['cert.authorEmails[].email'].marked), 'confirmed identity marked (terminal)');
});

test("the shareable sheet marks the Talent's own directory name", () => {
  // It lands in the <title> and the header of an artifact the Talent SHARES, so it
  // is the first thing a reader sees and the field most worth spoofing.
  const html = renderSheet(project(), 'en');
  assert.ok(html.includes(FIELDS['project.root(basename)'].marked));
  assert.equal(html.includes(PROJECT_DIR), false, 'the raw directory name never reaches the sheet');
});
