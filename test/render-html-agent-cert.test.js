'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveCertEvidence, agentCertificationItemHtml } = require('../src/render-html');
const { getCatalog } = require('../src/i18n');

// Mirror the renderer's HTML escaping so assertions match escaped output
// (some EN area names contain `&`, e.g. "Purpose & fit" → "Purpose &amp; fit").
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

/*
 * skill-code-certification (`certify agents`) — coherence regression.
 *
 * BUG: the HTML card showed "Level: P5 · Expert" together with "VERIFIED
 * EVIDENCE → (no verified evidence)". The level is derived server-side from the
 * five area TAGS (aggregateAgentLevel: P5 requires ALL FIVE `verified`), but the
 * card used to read the model's SEPARATE free-text verifiedEvidence[] list,
 * which the model can leave empty. A P5 with an empty verifiedEvidence list is
 * therefore impossible-by-construction yet was being rendered.
 *
 * FIX: derive the "why" (verified / not-confirmed) from the SAME area tags the
 * level comes from, so the two can never diverge. These tests pin that
 * invariant: any P5 card ALWAYS lists five confirmed areas and NEVER shows the
 * "(no verified evidence)" fallback — in both languages.
 */

const AREAS = [
  'purpose_fit',
  'design_ownership',
  'boundaries_guardrails',
  'failure_handling',
  'operation_evolution',
];

function allVerifiedAreas() {
  return AREAS.map((area) => ({ area, tag: 'verified', evidence: `confirmed ${area}` }));
}

function mixedAreas() {
  return [
    { area: 'purpose_fit', tag: 'verified', evidence: 'goal matches the definition' },
    { area: 'design_ownership', tag: 'partial', evidence: 'some decisions owned' },
    { area: 'boundaries_guardrails', tag: 'claimed', evidence: 'asserted only' },
    { area: 'failure_handling', tag: 'not_evidenced', evidence: '' },
    { area: 'operation_evolution', tag: 'n_a', evidence: 'does not apply' },
  ];
}

test('deriveCertEvidence splits by tag: verified vs not-confirmed, n_a excluded', () => {
  const ca = getCatalog('en').certifyAgents;
  const { verified, unverified } = deriveCertEvidence(mixedAreas(), ca);
  assert.equal(verified.length, 1, 'only the verified area is confirmed');
  assert.equal(verified[0].name, ca.areaNames.purpose_fit);
  // partial + claimed + not_evidenced → unverified; n_a excluded from BOTH.
  assert.equal(unverified.length, 3);
  const unverifiedAreas = unverified.map((u) => u.name);
  assert.ok(!unverifiedAreas.includes(ca.areaNames.operation_evolution), 'n_a not in either list');
});

test('deriveCertEvidence: all-verified yields five confirmed, zero unverified', () => {
  const ca = getCatalog('en').certifyAgents;
  const { verified, unverified } = deriveCertEvidence(allVerifiedAreas(), ca);
  assert.equal(verified.length, 5);
  assert.equal(unverified.length, 0);
});

for (const lang of ['es', 'en']) {
  test(`P5 card is coherent: five confirmed areas, never "(no verified evidence)" [${lang}]`, () => {
    const t = getCatalog(lang);
    const ca = t.certifyAgents;
    const card = {
      certification: {
        level: 'P5',
        category: null,
        role: null,
        areas: allVerifiedAreas(),
        // The model left BOTH free-text lists empty — the old bug trigger.
        verifiedEvidence: [],
        unverifiedEvidence: [],
        rationale: 'Verified command across all five areas.',
      },
    };
    const html = agentCertificationItemHtml('demo-agent', card.certification, t);
    assert.match(html, /cert-P5/, 'level chip present');
    // The "(no verified evidence)" fallback MUST NOT appear on a P5 card.
    assert.ok(!html.includes(ca.noVerified), `must not render noVerified fallback on P5 (${lang})`);
    // All five area names are listed as confirmed evidence.
    for (const key of AREAS) {
      assert.ok(html.includes(esc(ca.areaNames[key])), `area ${key} rendered (${lang})`);
    }
    // Rationale rendered.
    assert.match(html, /Verified command across all five areas\./);
  });

  test(`mixed card: verified + unverified blocks both coherent [${lang}]`, () => {
    const t = getCatalog(lang);
    const ca = t.certifyAgents;
    const card = {
      certification: {
        level: 'P2',
        category: null,
        role: null,
        areas: mixedAreas(),
        verifiedEvidence: [],
        unverifiedEvidence: [],
        rationale: '',
      },
    };
    const html = agentCertificationItemHtml('demo-agent', card.certification, t);
    assert.ok(html.includes(ca.verifiedHeading), 'verified heading present');
    assert.ok(html.includes(ca.unverifiedHeading), 'unverified heading present');
    // The single verified area shows; n_a area appears only in the full areas
    // block, not in the confirmed list.
    assert.ok(html.includes(esc(ca.areaNames.purpose_fit)));
  });
}

test('legacy record (level, no areas) shows the level chip alone, no misleading fallback', () => {
  const t = getCatalog('en');
  const ca = t.certifyAgents;
  const card = {
    certification: {
      level: 'P5',
      category: null,
      role: null,
      areas: [], // pre full-verdict persistence
      verifiedEvidence: [],
      unverifiedEvidence: [],
      rationale: null,
    },
  };
  const html = agentCertificationItemHtml('demo-agent', card.certification, t);
  assert.match(html, /cert-P5/, 'level chip still shown');
  assert.ok(!html.includes(ca.noVerified), 'no "(no verified evidence)" line on a legacy record');
  assert.ok(!html.includes(ca.whyHeading), 'the why block is omitted when there are no areas');
});
