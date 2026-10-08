'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { renderSheet } = require('../src/render-sheet');
const { renderTerminal } = require('../src/render-terminal');
const { buildFootprintDrawer } = require('../src/graph-scan');
const { getCatalog } = require('../src/i18n');
const { needle } = require('../test-fixtures/copy-needle');
const { BRAND_ANSI } = require('../src/brand-ansi');

const PRIMARY_RE = new RegExp(BRAND_ANSI.primary.replace(/[[\]\\^$.*+?()|{}]/g, '\\$&'));

// Issue 106 — where the agent CATEGORY comes from, tested against the object the REAL SCAN produces.

// A throwaway project with real agent files, scanned for real.
function scannedProject({ withEvaluation = true, categories = ['developer'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-eval-scan-'));
  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  const names = ['ddd-enforcer', 'hub-mr-reviewer', 'test-writer'];
  names.forEach((name, i) => {
    fs.writeFileSync(path.join(dir, '.claude', 'agents', `${name}.md`), [
      '---', `name: ${name}`, `description: Lo que hace ${name}`,
      `model: ${i % 2 ? 'sonnet' : 'opus'}`, 'tools: Read, Grep', '---', 'cuerpo',
    ].join('\n'));
  });
  const report = scan({ root: dir, scope: 'project' });
  const maturity = classify(report);
  if (withEvaluation) {
    // The ephemeral classification call's REAL response shape (src/agent-evaluation.js:
    // `classification: { catalogId, category, role, level, method }`).
    report.agentEvaluation = {
      promptVersion: 'agent-eval-v1',
      evaluations: names.map((name, i) => ({
        name,
        description: `Lo que hace ${name}`,
        improvements: [],
        classification: {
          catalogId: i + 1,
          category: categories[i % categories.length],
          role: 'Backend',
          level: 'L2',
          method: 'deterministic',
        },
      })),
    };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    root: dir,
    footprint: { generatedAt: '2026-08-03T11:26:15Z', report, maturity },
    certifications: {},
    agentCertifications: {},
  };
}

function badges(html) {
  return [...html.matchAll(/<span class="an">([^<]*)<\/span>[\s\S]{0,500}?<span class="chip (cat[^"]*)">([^<]*)<\/span>/g)]
    .map((m) => ({ name: m[1], cls: m[2], text: m[3] }));
}

test('106: the REAL scan produces no `category` on an agent — the field the bug was about', () => {
  const project = scannedProject({ withEvaluation: false });
  const agents = project.footprint.report.agents;
  assert.equal(agents.length, 3, 'the scan must find the three agent files');
  assert.deepEqual(Object.keys(agents[0]).sort(), ['aiProduct', 'model', 'name', 'parent', 'tools']);
  assert.equal('category' in agents[0], false, 'the scan does not classify; something downstream does');
});

test('106: with a real classification, the category REACHES the shareable report', () => {
  // The whole point: fed by the scan's own object plus the evaluation's own shape,
  // with no hand-placed `category` anywhere.
  const html = renderSheet(scannedProject({ categories: ['developer', 'product', 'designer'] }), 'es');
  const rows = badges(html);
  assert.equal(rows.length, 3);
  const labels = getCatalog('es').classification.categories;
  assert.deepEqual(rows.map((r) => r.text), [labels.developer, labels.product, labels.designer]);
  for (const r of rows) assert.match(r.cls, /cat-(developer|product|designer)/);
});

test('106: ONE provenance — the terminal and the sheet agree, from the same shaping layer', () => {
  // Two provenances for the same datum is how this issue happened in the first place.
  const project = scannedProject({ categories: ['developer'] });
  const label = needle(getCatalog('es').classification.categories.developer, 'classification.categories.developer');
  const sheet = renderSheet(project, 'es');
  const terminal = renderTerminal(project.footprint.report, project.footprint.maturity, 'es')
    .replace(/\x1b\[[0-9;]*m/g, '');
  assert.ok(sheet.includes(label), 'the shareable report must show the category');
  assert.ok(terminal.includes(label), 'and the terminal must show the same one');
  // And both come from the same drawer/tree, not from two derivations.
  const fp = buildFootprintDrawer(project.footprint.report, project.footprint.maturity, getCatalog('es'));
  assert.deepEqual(fp.agents.map((a) => a.category), ['developer', 'developer', 'developer']);
});

test('106: "we never asked" and "we asked and got nothing" are DIFFERENT words', () => {
  // The reported run had all three model calls return `null`.
  const c = getCatalog('es').sheet;
  const notEvaluated = badges(renderSheet(scannedProject({ withEvaluation: false }), 'es'));
  assert.equal(notEvaluated.length, 3);
  for (const r of notEvaluated) {
    assert.equal(r.text, needle(c.agentNotEvaluated, 'sheet.agentNotEvaluated'));
    assert.notEqual(r.text, c.agentNoCategory, 'the two empty states must not share their words');
    assert.equal(r.cls, 'cat cat-none', 'both stay neutral: the five colours are for named categories');
  }
});

test('106: an evaluated agent with no matching category keeps the OTHER empty state', () => {
  // The legitimately-unclassified case (a repo-specific agent that matches no catalog role).
  const project = scannedProject();
  for (const e of project.footprint.report.agentEvaluation.evaluations) e.classification = null;
  const rows = badges(renderSheet(project, 'es'));
  const c = getCatalog('es').sheet;
  for (const r of rows) assert.equal(r.text, needle(c.agentNoCategory, 'sheet.agentNoCategory'));
});

test('106: when nothing was evaluated, the report SAYS SO once, visibly', () => {
  for (const lang of ['es', 'en']) {
    const c = getCatalog(lang).sheet;
    const missing = renderSheet(scannedProject({ withEvaluation: false }), lang);
    assert.ok(missing.includes(needle(c.agentsEvalMissing, 'sheet.agentsEvalMissing')),
      `[${lang}] the notice must be shown when no agent was evaluated`);
    // And NOT shown when the evaluation did run: a permanent warning is noise.
    const fine = renderSheet(scannedProject({ categories: ['developer'] }), lang);
    assert.equal(fine.includes(c.agentsEvalMissing), false, `[${lang}] the notice must not fire on a good run`);
  }
});

test('106: the drawer reports the three states, and never invents a category', () => {
  const t = getCatalog('es');
  const classified = buildFootprintDrawer(scannedProject().footprint.report, { score: 1 }, t);
  assert.deepEqual(classified.agents.map((a) => a.evaluated), [true, true, true]);
  const unevaluated = buildFootprintDrawer(scannedProject({ withEvaluation: false }).footprint.report, { score: 1 }, t);
  assert.deepEqual(unevaluated.agents.map((a) => a.evaluated), [false, false, false]);
  assert.deepEqual(unevaluated.agents.map((a) => a.category), [null, null, null]);
});

// ================= issue 120: the FLOOR on the report card ================= The shareable report's side of this lives in `render-sheet-category-badges.test.js`.
for (const lang of ['es', 'en']) {
  const cc = getCatalog(lang).classification;

  test(`120 [${lang}]: the floor category is LABELLED on the card, never the raw key`, () => {
    const project = scannedProject({ categories: ['other'] });
    const out = renderTerminal(project.footprint.report, project.footprint.maturity, lang)
      .replace(/\x1b\[[0-9;]*m/g, '');
    const label = needle(cc.categories.other, `${lang} categories.other`);
    assert.ok(out.includes(label), `the floor label is missing from the card`);
    // The exact regression: a bare `other` next to "Desarrollo" read as a speciality.
    assert.equal(/(^|[\s·])other([\s·]|$)/m.test(out), false, 'the raw key reached the card again');
  });

  test(`120 [${lang}]: the floor is DIMMED where a speciality is accented`, () => {
    // The colour gate is off in a pipe, so force the TTY branch — otherwise this
    // asserts nothing at all (the whole point of issue 097's lesson).
    const original = process.stdout.isTTY;
    try {
      process.stdout.isTTY = true;
      const floor = renderTerminal(
        scannedProject({ categories: ['other'] }).footprint.report,
        scannedProject({ categories: ['other'] }).footprint.maturity, lang,
      );
      const speciality = renderTerminal(
        scannedProject({ categories: ['finance'] }).footprint.report,
        scannedProject({ categories: ['finance'] }).footprint.maturity, lang,
      );
      const floorLine = floor.split('\n').find((l) => l.includes(needle(cc.categories.other, 'other')));
      const specLine = speciality.split('\n').find((l) => l.includes(needle(cc.categories.finance, 'finance')));
      assert.ok(floorLine && specLine);
      // A speciality is accented; the floor is not. Both assertions, because
      // "neither is accented" would also pass if the accent were removed entirely.
      assert.match(specLine, PRIMARY_RE, 'a speciality must keep its accent');
      assert.equal(PRIMARY_RE.test(floorLine), false, 'the floor must not be accented like a speciality');
      assert.match(floorLine, /\x1b\[2m/, 'the floor must be dimmed, the same signal `sin categoría` gets');
    } finally {
      process.stdout.isTTY = original;
    }
  });

  test(`120 [${lang}]: the floor does not print its role, because the role repeats the label`, () => {
    // The catalog's floor row is `role: 'Other / internal'` — the same words as its category — so printing both produced the statement twice, in two languages.
    const floorReport = scannedProject({ categories: ['other'] }).footprint.report;
    for (const e of floorReport.agentEvaluation.evaluations) {
      e.classification.role = 'Other / internal';
    }
    const out = renderTerminal(floorReport, scannedProject().footprint.maturity, lang)
      .replace(/\x1b\[[0-9;]*m/g, '');
    const label = needle(cc.categories.other, `${lang} categories.other`);
    const line = out.split('\n').find((l) => l.includes(label));
    assert.ok(line, 'no classification line for the floor agent');
    const occurrences = line.split('Other / internal').length - 1;
    assert.equal(occurrences, label.includes('Other / internal') ? 1 : 0,
      `the floor printed its redundant role (${lang}: ${JSON.stringify(line.trim())})`);

    const specReport = scannedProject({ categories: ['finance'] }).footprint.report;
    for (const e of specReport.agentEvaluation.evaluations) {
      e.classification.role = 'Financial Modeler';
    }
    const specOut = renderTerminal(specReport, scannedProject().footprint.maturity, lang)
      .replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(specOut.includes('Financial Modeler'), 'a speciality must still show its role');
  });
}
