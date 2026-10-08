'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderCertificationTerminal, skillLevelForScore } = require('../src/render-certification');

// skill-code-certification, issue 005: certify report renderers (terminal + self-contained HTML).

// --- ADR-016 skill level mapping (Middle/Senior/Expert by decision power) ----
test('skillLevelForScore: maps score bands to the three named levels', () => {
  assert.equal(skillLevelForScore(90).key, 'expert'); // >=70 high
  assert.equal(skillLevelForScore(70).key, 'expert'); // boundary
  assert.equal(skillLevelForScore(69).key, 'senior'); // 40-69 mid
  assert.equal(skillLevelForScore(40).key, 'senior'); // boundary
  assert.equal(skillLevelForScore(39).key, 'middle'); // <40 low
  assert.equal(skillLevelForScore(0).key, 'middle');
});

test('skillLevelForScore: level rank is monotonic with the score, and band colour is preserved', () => {
  assert.equal(skillLevelForScore(90).band, 'high');
  assert.equal(skillLevelForScore(55).band, 'mid');
  assert.equal(skillLevelForScore(10).band, 'low');
  // A non-numeric score (model degraded) yields no level key, never a crash.
  assert.equal(skillLevelForScore(null).key, null);
  assert.equal(skillLevelForScore(undefined).key, null);
});

function certification(overrides = {}) {
  return {
    items: [
      {
        skillId: 1, skillName: 'React', technology: 'React',
        sampling: { sampleable: true, includedCount: 3, candidateCount: 5, estTokens: 1200, truncated: false, capReason: null },
        result: { score: 82, rationale: 'Solid component patterns.', improvements: ['Add tests', 'Type props'] },
      },
      ...(overrides.extraItems || []),
    ],
    model: null,
  };
}

test('terminal: shows heading, disclaimer, named level, rationale, improvements, sample summary', () => {
  const out = renderCertificationTerminal(certification(), 'en');
  assert.match(out, /Skill certification result/);
  // ADR-024: the disclaimer now describes the deterministic rubric aggregation.
  assert.match(out, /anchored rubric/);
  assert.match(out, /deterministic/);
  // ADR-016: numeric grade replaced by the named level (82 -> high band -> Expert).
  assert.match(out, /Level: Expert/);
  assert.doesNotMatch(out, /Score: \d+\/100/); // numeric grade removed
  assert.match(out, /Solid component patterns/);
  assert.match(out, /Add tests/);
  assert.match(out, /Sample: 3\/5 files/);
});

test('terminal (ADR-016): named level headline, but the ADR-024 rubric dimensions stay visible', () => {
  const cert = {
    items: [{
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true, includedCount: 2, candidateCount: 2, estTokens: 800, truncated: false, capReason: null },
      result: {
        score: 64, // mid band -> Senior
        dimensions: { idiomatic: 3, correctness: 2, depth: 3, structure: 2, testing: null },
        rationale: 'ok',
        improvements: ['a', 'b'],
      },
    }],
    model: null,
  };
  // Strip ANSI so label/value assertions aren't split by color codes.
  const out = renderCertificationTerminal(cert, 'en').replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(out, /Level: Senior/); // headline: 64 -> mid -> Senior (no numeric grade)
  assert.doesNotMatch(out, /Score: \d+\/100/); // top-line numeric grade removed
  // The detailed rubric breakdown is retained (only the headline changed).
  assert.match(out, /Dimensions/);
  assert.match(out, /Idiomatic usage: 3\/4/);
  assert.match(out, /Testing: N\/A/); // null dimension shown as N/A, not 0
});

test('terminal: a long rationale is trimmed, and improvements stay verbatim', () => {
  const LONG =
    'The component architecture is solid and follows idiomatic React patterns throughout the sampled files. '
    + 'Hooks are composed cleanly and side effects are well isolated in dedicated modules. '
    + 'That said, there is a long tail of secondary observations that make this rationale verbose enough to blow past the terminal budget and should be dropped from the terminal view only.';
  const cert = {
    items: [{
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true, includedCount: 3, candidateCount: 5, estTokens: 1200, truncated: false, capReason: null },
      result: { score: 82, rationale: LONG, improvements: ['Extract the data layer into a hook'] },
    }],
    model: null,
  };
  const term = renderCertificationTerminal(cert, 'en');

  assert.match(term, /The component architecture is solid/); // essence kept
  assert.equal(term.includes('dropped from the terminal view only'), false); // tail trimmed
  assert.match(term, /Extract the data layer into a hook/); // improvement + remediation prompt verbatim
});

test('terminal: partial-sample warning appears only when some sampling.truncated', () => {
  const notTruncated = renderCertificationTerminal(certification(), 'en');
  assert.equal(/Partial sample:/.test(notTruncated), false);

  const truncated = renderCertificationTerminal({
    items: [{
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true, includedCount: 1, candidateCount: 9, estTokens: 500, truncated: true, capReason: 'per-skill-cap' },
      result: { score: 50, rationale: 'x', improvements: [] },
    }],
  }, 'en');
  assert.match(truncated, /Partial sample:/);
  assert.match(truncated, /\(partial sample\)/);
});

test('terminal: not-sampleable and not-certified states', () => {
  const out = renderCertificationTerminal({
    items: [
      { skillId: 1, skillName: 'Mainframe', technology: 'COBOL', sampling: { sampleable: false, includedCount: 0, candidateCount: 0, estTokens: 0, truncated: false, capReason: null }, result: null },
      { skillId: 2, skillName: 'React', technology: 'React', sampling: { sampleable: true, includedCount: 2, candidateCount: 2, estTokens: 100, truncated: false, capReason: null }, result: null },
    ],
  }, 'en');
  assert.match(out, /No sampling is defined for the technology "COBOL"/);
  assert.match(out, /could not be certified in this run/);
});

test('011: the terminal renders the remediation prompt from improvements', () => {
  const cert = {
    items: [{
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true, includedCount: 2, candidateCount: 3, estTokens: 500, truncated: false, capReason: null },
      result: { score: 60, rationale: 'decent', improvements: ['Add tests', 'Type props'] },
    }],
  };
  const term = renderCertificationTerminal(cert, 'en');
  assert.match(term, /Prompt to apply the improvements/);
  assert.match(term, /A code review flagged these improvements/);
  assert.match(term, /1\. Add tests/);
});

test('012: the terminal shows the cost note, in both languages', () => {
  const cert = { items: [] };
  assert.match(renderCertificationTerminal(cert, 'en'), /Cost note:/);
  assert.match(renderCertificationTerminal(cert, 'es'), /Nota de coste:/);
});

test('empty items -> no-results notice, no throw', () => {
  assert.match(renderCertificationTerminal({ items: [] }, 'en'), /No certification results/);
});

test('terminal: strips raw ANSI escape / C0 control characters from rationale and improvements', () => {
  const evilEsc = '\x1b[31mFAKE CERTIFIED\x1b[0m';
  const cert = {
    items: [{
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true, includedCount: 1, candidateCount: 1, estTokens: 10, truncated: false, capReason: null },
      result: { score: 60, rationale: `Looks fine. ${evilEsc}`, improvements: [`Add tests ${evilEsc}`] },
    }],
  };
  const term = renderCertificationTerminal(cert, 'en');
  // The renderer's OWN ansi codes (bold/reset/color) legitimately use \x1b —
  // check for the INJECTED sequence specifically, not \x1b in general.
  assert.equal(term.includes(evilEsc), false, 'the raw injected escape sequence must never reach the terminal verbatim');
  assert.equal(term.includes('\x1b[31mFAKE'), false, 'the injected ESC byte must be stripped even if the rest of the payload survives as inert text');
  assert.match(term, /FAKE CERTIFIED/); // the harmless TEXT survives, only the control bytes are stripped
  assert.match(term, /Add tests/);

  // The remediation prompt block is built from the SAME improvements text —
  // must be scrubbed there too, not just in the "Improvements:" list above.
  const remediationBlock = term.slice(term.indexOf('Prompt to apply'));
  assert.equal(remediationBlock.includes(evilEsc), false);
});
