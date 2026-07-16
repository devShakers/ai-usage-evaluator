'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderCertificationTerminal, renderCertificationHtml } = require('../src/render-certification');

/*
 * skill-code-certification, issue 005: certify report renderers (terminal +
 * self-contained HTML). Must always show the indicative/not-reproducible
 * disclaimer, a partial-sample warning when truncated, and per-Skill score/
 * rationale/improvements — or a clear not-certified / not-sampleable state.
 */

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

test('terminal: shows heading, disclaimer, score, rationale, improvements, sample summary', () => {
  const out = renderCertificationTerminal(certification(), 'en');
  assert.match(out, /Skill certification result/);
  assert.match(out, /indicative and NOT reproducible/);
  assert.match(out, /Score: 82\/100/);
  assert.match(out, /Solid component patterns/);
  assert.match(out, /Add tests/);
  assert.match(out, /Sample: 3\/5 files/);
});

// Terminal-condense (CPO feedback): a long LLM rationale is trimmed to its
// essence in the TERMINAL, but the HTML report keeps it in full, and the
// improvements + remediation prompt stay verbatim (they are the payload).
test('terminal: a long rationale is trimmed in the terminal but kept whole in HTML; improvements stay verbatim', () => {
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
  const html = renderCertificationHtml(cert, 'en');

  assert.match(term, /The component architecture is solid/); // essence kept
  assert.equal(term.includes('dropped from the terminal view only'), false); // tail trimmed
  assert.match(term, /Extract the data layer into a hook/); // improvement + remediation prompt verbatim

  assert.ok(html.includes('dropped from the terminal view only')); // HTML keeps the full rationale
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

test('HTML: self-contained, zero-network (no external URLs), escapes content, inline copy script only', () => {
  const html = renderCertificationHtml({
    items: [{
      skillId: 1, skillName: 'React <x>', technology: 'React',
      sampling: { sampleable: true, includedCount: 1, candidateCount: 1, estTokens: 10, truncated: false, capReason: null },
      result: { score: 90, rationale: 'Uses <script>alert(1)</script> safely', improvements: ['a & b'] },
    }],
  }, 'en');
  assert.match(html, /^<!DOCTYPE html>/);
  assert.equal(/https?:\/\//.test(html), false, 'no external URLs');
  assert.equal(/\bsrc=/.test(html), false, 'no external script/img src');
  assert.equal(/<link/.test(html), false, 'no external stylesheet link');
  // Injected content is escaped, never a live tag.
  assert.equal(html.includes('<script>alert(1)</script>'), false, 'dangerous content must be escaped');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /React &lt;x&gt;/);
  assert.match(html, /a &amp; b/);
  assert.match(html, /Score: 90\/100/);
  // Issue 011: a remediation prompt exists (improvements present) -> copy
  // button + the shared, zero-network copy script. Reporting redesign: the
  // copy-target id is keyed by Skill id (rem-<skillId>), not a run-relative
  // index, so the same id stays stable across runs / in the cumulative report.
  assert.match(html, /data-copy-target="rem-1"/);
  assert.match(html, /<button[^>]*class="copy-btn"/);
  assert.equal((html.match(/<script>/g) || []).length, 1, 'exactly one inline copy script');
});

test('011: HTML has NO remediation copy BUTTON when there are no improvements (nothing to remediate)', () => {
  const html = renderCertificationHtml({
    items: [{
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true, includedCount: 1, candidateCount: 1, estTokens: 10, truncated: false, capReason: null },
      result: { score: 50, rationale: 'ok', improvements: [] },
    }],
  }, 'en');
  // Reporting redesign: the report shares one zero-network clipboard handler
  // (report-theme's COPY_SCRIPT) that no-ops when there's nothing to copy, so a
  // <script> is always present. The invariant that matters is that there is no
  // remediation UI to copy, and no external network surface.
  assert.equal(/class="copy-btn"/.test(html), false, 'no copy button when no remediation prompt');
  assert.equal(/<pre id="rem-/.test(html), false, 'no remediation prompt block when there is nothing to copy');
  assert.equal(/https?:\/\//.test(html), false, 'zero-network: no external URLs');
});

test('011: terminal + HTML render the remediation prompt from improvements', () => {
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
  const html = renderCertificationHtml(cert, 'en');
  assert.match(html, /Prompt to apply the improvements/);
  assert.match(html, /<pre id="rem-1">/); // keyed by Skill id (reporting redesign)
});

test('012: terminal + HTML show the cost note', () => {
  const cert = { items: [] };
  assert.match(renderCertificationTerminal(cert, 'en'), /Cost note:/);
  assert.match(renderCertificationHtml(cert, 'en'), /Cost note:/);
  assert.match(renderCertificationTerminal(cert, 'es'), /Nota de coste:/);
});

test('HTML: partial warning + Spanish rendering', () => {
  const html = renderCertificationHtml({
    items: [{
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true, includedCount: 1, candidateCount: 5, estTokens: 10, truncated: true, capReason: 'run-budget' },
      result: { score: 40, rationale: 'ok', improvements: [] },
    }],
  }, 'es');
  assert.match(html, /Muestra parcial/);
  assert.match(html, /orientativa y NO reproducible/);
});

test('both renderers: empty items -> no-results notice, no throw', () => {
  assert.match(renderCertificationTerminal({ items: [] }, 'en'), /No certification results/);
  assert.match(renderCertificationHtml({ items: [] }, 'en'), /No certification results/);
});
