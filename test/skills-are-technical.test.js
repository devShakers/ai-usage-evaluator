'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');
const { renderSheet } = require('../src/render-sheet');
const { renderCertificationTerminal } = require('../src/render-certification');
const { needle } = require('../test-fixtures/copy-needle');

// Issue 085 — the safety net for copy that decides what a result MEANS.

// The qualification, per language: the positive form plus the word that closes
// the gap. Kept as data so a copy change has to update the expectation on purpose.
const QUALIFIED = {
  es: /Skills?\s+t[ée]cnicas?/i,
  en: /technical\s+Skills?/i,
};

for (const lang of ['es', 'en']) {
  const t = getCatalog(lang);

  test(`085 [${lang}]: the SHARED code-egress disclaimer (kept) qualifies it`, () => {
    // Only the disclaimer family + report survive in `certify` now; the disclaimer
    // is still the code-egress consent gate reused by add-skill/agent/project.
    assert.match(t.certify.disclaimer, QUALIFIED[lang]);
  });

  test(`085 [${lang}]: the RESULT says what was certified`, () => {
    assert.match(t.certify.report.heading, QUALIFIED[lang]);
    assert.match(t.certify.report.htmlTitle, QUALIFIED[lang]);
  });

  // NOTE: the startup/`certify` command copy is no longer asserted here — `certify`
  // is now a DIMENSION interview, not a skills-from-code certification, so its copy
  // deliberately does NOT read as "technical Skills". The wording guard below still
  // covers the report Skills tab and the tier FILES, which stay technical-Skills copy.

  test(`085 [${lang}]: the tier ladder keeps talking about skill FILES, not certifications`, () => {
    // The trap: `agentCounts.skills` counts `.claude/skills/*` FILES.
    const files = lang === 'es' ? /ficheros de skill/ : /skill files/;
    assert.match(t.setupLevels.S2.desc, files, 'the S2 description must say files');
    assert.match(t.ladder.tierDesc.T4, files, 'the T4 rung must say files');
    // And it must NOT claim to be a certification.
    assert.equal(/certifi/i.test(t.ladder.tierDesc.T4), false, 'T4 is about assets, not certification');
  });
}

/* ---------------- the rendered surfaces, not just the catalog ---------------- */

const CERT = {
  items: [{
    skillId: 1, skillName: 'React', technology: 'React',
    sampling: { sampleable: true, includedCount: 2, candidateCount: 2, estTokens: 800, truncated: false, capReason: null },
    result: { score: 72, rationale: 'r', improvements: ['a'] },
  }],
  model: null,
};

function project() {
  return {
    root: '/tmp/demo',
    footprint: {
      generatedAt: '2026-08-03T00:00:00.000Z',
      report: { agentEvaluation: null, agentCounts: { agents: 2 }, agents: [], tools: [], technologies: [] },
      maturity: { tierKey: 'T2', tierName: 'x', score: 50, setupLevel: { key: 's1', rank: 1, code: 'S1' } },
    },
    certifications: {},
  };
}

for (const lang of ['es', 'en']) {
  test(`085 [${lang}]: the certification RESULT the Talent reads is qualified in the real output`, () => {
    const out = renderCertificationTerminal(CERT, lang).replace(/\x1b\[[0-9;]*m/g, '');
    assert.match(out, QUALIFIED[lang]);
  });

  test(`085 [${lang}]: the shareable report labels the Skills tab as technical`, () => {
    const html = renderSheet(project(), lang);
    assert.match(html, new RegExp(`data-tab="skills">${needle(getCatalog(lang).sheet.skills, 'getCatalog(lang).sheet.skills')}`));
    assert.match(getCatalog(lang).sheet.skills, QUALIFIED[lang]);
    assert.doesNotMatch(html, /data-tab="agents"/);
    // The empty state points at the right subcommand, not a bare `certify`.
    assert.match(getCatalog(lang).sheet.noSkills, /certify skills/);
  });
}

test('085: no visible copy offers a bare, unqualified "certify skills" description', () => {
  // The sweep, as a property rather than a list: every catalog string that talks about CERTIFYING skills must carry the qualification.
  for (const lang of ['es', 'en']) {
    const t = getCatalog(lang);
    const suspects = [
      t.certify.report.heading, t.certify.report.htmlTitle, t.sheet.skills,
      t.sheet.noSkills,
    ];
    for (const line of suspects) {
      assert.match(line, QUALIFIED[lang], `[${lang}] a decision surface lost the qualification: ${line}`);
    }
  }
});
