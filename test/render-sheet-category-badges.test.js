'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { renderSheet } = require('../src/render-sheet');
const { getCatalog } = require('../src/i18n');

// Category badges: one colour per catalog category (user request), plus the sixth state.

// The SPECIALITIES — the categories that earn one of the colour tokens.
const CATEGORIES = ['developer', 'product', 'designer', 'marketing', 'data', 'finance', 'sales'];
const FLOOR_CATEGORY = 'other';
const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'src', 'templates', 'report-sheet.html'), 'utf8');

function project(agents, evaluations) {
  return {
    root: '/tmp/demo',
    footprint: {
      generatedAt: '2026-08-03T00:00:00.000Z',
      report: {
        agents,
        agentCounts: { agents: agents.length },
        agentEvaluation: evaluations.length ? { evaluations, promptVersion: 'v1' } : null,
        tools: [], technologies: [],
      },
      maturity: { tierKey: 'T2', tierName: 'x', score: 50, setupLevel: { key: 'S1', rank: 1, code: 'S1' } },
    },
    certifications: {}, agentCertifications: {},
  };
}

const agentFor = (name) => ({ name, tools: [], model: 'opus', parent: null, aiProduct: 'claude-code' });
const evalFor = (name, category, i) => ({
  name, description: 'desc', improvements: [],
  // `level` here is the CATALOG level (L1|L2|L3), not the credential level
  // (P1..P5) — two different fields that used to be mixed in fixtures (097).
  classification: { catalogId: i + 1, category, role: 'R', level: 'L2', method: 'exact' },
});

// The badges in document order: [classes, text].
function badges(html) {
  return [...html.matchAll(/<span class="chip (cat[^"]*)">([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);
}

/* ---------------- WCAG contrast, computed and not eyeballed ---------------- */

const channels = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255);
const luminance = (h) => {
  const [r, g, b] = channels(h).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// Reads a `--token:#hex` declaration out of a specific theme block of the template.
function token(name, theme) {
  const block = theme === 'dark'
    ? TEMPLATE.slice(TEMPLATE.indexOf('[data-theme="dark"]'), TEMPLATE.indexOf('*{box-sizing'))
    : TEMPLATE.slice(TEMPLATE.indexOf(':root{'), TEMPLATE.indexOf('[data-theme="dark"]'));
  const m = block.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  return m ? m[1] : null;
}

test('badges: every category pair meets WCAG AA (4.5:1) in BOTH themes, measured', () => {
  // This is a report the Talent shares with other people, so "looks fine on my screen" is not the bar.
  const failures = [];
  for (const theme of ['light', 'dark']) {
    for (const cat of CATEGORIES) {
      const fg = token(`cat-${cat}-fg`, theme);
      const bg = token(`cat-${cat}-bg`, theme);
      assert.ok(fg && bg, `${theme}/${cat}: tokens missing from the template`);
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) failures.push(`${theme}/${cat} ${fg} on ${bg} = ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(failures, [], `contrast below AA: ${failures.join(', ')}`);
});

test('badges: the specialities are all DISTINCT colours, and none reuses a score-band colour', () => {
  // A category badge that reuses the score band's red or amber would read as a
  // grade in a document that also shows grades in the other column.
  for (const theme of ['light', 'dark']) {
    const fgs = CATEGORIES.map((cat) => token(`cat-${cat}-fg`, theme));
    assert.equal(new Set(fgs).size, CATEGORIES.length, `${theme}: two categories share a colour`);
    const bands = ['band-high-fg', 'band-mid-fg', 'band-low-fg'].map((b) => token(b, theme)).filter(Boolean);
    for (const fg of fgs) {
      assert.equal(bands.includes(fg), false, `${theme}: a category reuses a score-band colour (${fg})`);
    }
  }
});

/* ---------------- the rendered badges ---------------- */

for (const lang of ['es', 'en']) {
  const c = getCatalog(lang);

  test(`badges [${lang}]: each of the ${CATEGORIES.length} specialities gets its own class AND its label`, () => {
    const agents = CATEGORIES.map((cat) => agentFor(`a-${cat}`));
    const evaluations = CATEGORIES.map((cat, i) => evalFor(`a-${cat}`, cat, i));
    const found = badges(renderSheet(project(agents, evaluations), lang));
    assert.equal(found.length, CATEGORIES.length);
    CATEGORIES.forEach((cat, i) => {
      const [cls, text] = found[i];
      assert.equal(cls, `cat cat-${cat}`, `${cat}: wrong class`);
      // The colour ACCOMPANIES the label; it never replaces it.
      assert.equal(text, c.classification.categories[cat], `${cat}: the label must be the localized name`);
      assert.ok(text.length > 0, `${cat}: a badge with no text would make colour load-bearing`);
    });
  });

  test(`badges [${lang}]: NO category — the majority state — is neutral, labelled and dashed`, () => {
    const found = badges(renderSheet(project([agentFor('bare')], []), lang));
    // Issue 106: this fixture carries no `agentEvaluation`, so the honest empty state is "not assessed", not "no category".
    assert.deepEqual(found, [['cat cat-none', c.sheet.agentNotEvaluated]]);
    // Neutral: it must not borrow any of the five category classes.
    for (const cat of CATEGORIES) {
      assert.equal(found[0][0].includes(`cat-${cat}`), false, `the empty state must not look like ${cat}`);
    }
    // Distinguishable WITHOUT colour: the dashed border is the greyscale signal.
    assert.match(TEMPLATE, /\.cat-none\{[^}]*dashed/, 'the neutral badge needs a non-colour distinction');
  });

  test(`badges [${lang}]: an unknown category paints RAW and neutral, never blank and never a category colour`, () => {
    // Issue 095 is still refining the matcher: an unexpected key is a live case.
    const found = badges(renderSheet(project(
      [agentFor('x')],
      [{ name: 'x', description: 'd', improvements: [], classification: { catalogId: 9, category: 'quantum-alchemy', role: null, level: null, method: 'exact' } }],
    ), lang));
    assert.equal(found.length, 1);
    assert.equal(found[0][0], 'cat cat-none', 'an unnameable category must not get a speciality colour');
    assert.equal(found[0][1], 'quantum-alchemy', 'and it must show what actually arrived');
    assert.notEqual(found[0][1], c.sheet.agentNoCategory, '"unknown" and "absent" are different facts');
    assert.notEqual(found[0][1], c.sheet.agentNotEvaluated, 'nor is it "not assessed": this agent WAS evaluated');
  });

  test(`badges [${lang}]: no ANSI, and the badge geometry comes from the existing chip`, () => {
    const html = renderSheet(project([agentFor('a')], []), lang);
    assert.equal(/\x1b\[[0-9;]*m/.test(html), false);
    // Built ON `.chip`, so the shape lives in one place.
    assert.match(html, /class="chip cat /);
  });
}

test('badges: every rendered class has a matching rule in the template', () => {
  const agents = CATEGORIES.map((cat) => agentFor(`a-${cat}`)).concat([agentFor('bare')]);
  const evaluations = CATEGORIES.map((cat, i) => evalFor(`a-${cat}`, cat, i));
  const html = renderSheet(project(agents, evaluations), 'es');
  const found = badges(html);
  // Guard against the vacuous pass: with no badges emitted the loop below has nothing to check and the test would go green against a reverted renderer.
  assert.equal(found.length, CATEGORIES.length + 1, 'the five categories plus the neutral state must all render');
  const classes = new Set(found.flatMap(([cls]) => cls.split(' ')));
  for (const cls of classes) {
    assert.match(TEMPLATE, new RegExp(`\\.${cls}[{,]`), `.${cls} is emitted but has no CSS rule`);
  }
});

const { needle } = require('../test-fixtures/copy-needle');

for (const lang of ['es', 'en']) {
  const c = getCatalog(lang);

  test(`floor [${lang}]: it is LABELLED, and never the raw key the talent used to see`, () => {
    const found = badges(renderSheet(project(
      [agentFor('cfo')],
      [evalFor('cfo', FLOOR_CATEGORY, 0)],
    ), lang));
    assert.equal(found.length, 1);
    const label = needle(c.classification.categories[FLOOR_CATEGORY], `${lang} categories.other`);
    assert.equal(found[0][1], label);
    // The exact regression: the raw key must not be what is painted.
    assert.notEqual(found[0][1], FLOOR_CATEGORY, 'the raw key reached the talent again');
  });

  test(`floor [${lang}]: it keeps the NEUTRAL dashed badge and gets no speciality colour`, () => {
    const found = badges(renderSheet(project(
      [agentFor('cfo')],
      [evalFor('cfo', FLOOR_CATEGORY, 0)],
    ), lang));
    assert.equal(found[0][0], 'cat cat-none', 'the floor must not be styled as a speciality');
    for (const cat of CATEGORIES) {
      assert.equal(found[0][0].includes(`cat-${cat}`), false, `the floor must not look like ${cat}`);
    }
    // Distinguishable without colour at all.
    assert.match(TEMPLATE, /\.cat-none\{[^}]*dashed/);
  });

  test(`floor [${lang}]: a speciality and the floor differ VISUALLY, not just in wording`, () => {
    // The pair, side by side in one document — the assertion that would fail if
    // someone "simplified" the render back to one code path.
    const found = badges(renderSheet(project(
      [agentFor('a-finance'), agentFor('a-floor')],
      [evalFor('a-finance', 'finance', 0), evalFor('a-floor', FLOOR_CATEGORY, 1)],
    ), lang));
    assert.equal(found.length, 2);
    assert.equal(found[0][0], 'cat cat-finance');
    assert.equal(found[1][0], 'cat cat-none');
    assert.notEqual(found[0][0], found[1][0]);
    // And both are named, so neither relies on its colour.
    assert.ok(found[0][1].length > 0 && found[1][1].length > 0);
  });
}

test('floor: the template has NO colour rule for it, so no eighth hue can leak in', () => {
  assert.equal(/\.cat-other\s*\{/.test(TEMPLATE), false, 'the floor must not have its own colour rule');
  assert.equal(/--cat-other-[a-z]+\s*:/.test(TEMPLATE), false, 'the floor must not have its own colour tokens');
  // CONTROL: the same shapes DO match for a real speciality, so the two
  // assertions above are discriminating rather than vacuously true.
  assert.equal(/\.cat-finance\s*\{/.test(TEMPLATE), true);
  assert.equal(/--cat-finance-[a-z]+\s*:/.test(TEMPLATE), true);
});

test('floor: no cable jargon reaches the talent through the badge', () => {
  // Issue 116 caught one of these: a `method`/`reason` value leaking to a surface.
  const html = renderSheet(project(
    [agentFor('cfo')],
    [{
      name: 'cfo', description: 'd', improvements: [],
      classification: { catalogId: 'other-1', category: FLOOR_CATEGORY, role: 'Other / internal', level: null, method: 'floor' },
    }],
  ), 'es');
  for (const jargon of ['other-1', '"floor"', 'unclassified', 'deterministic']) {
    assert.equal(html.includes(jargon), false, `leaked: ${jargon}`);
  }
});
