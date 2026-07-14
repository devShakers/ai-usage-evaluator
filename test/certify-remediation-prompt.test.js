'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRemediationPrompt } = require('../src/certify-remediation-prompt');

/*
 * skill-code-certification, issue 011: the client-side remediation prompt,
 * assembled deterministically from the LLM's returned improvements (one per
 * Skill). No LLM call, no code in it.
 */

const ITEM = {
  skillName: 'React', technology: 'React',
  result: { score: 60, rationale: 'ok', improvements: ['Add tests', 'Type the props'] },
};

test('buildRemediationPrompt: null when there are no improvements or no result', () => {
  assert.equal(buildRemediationPrompt({ skillName: 'React', result: { improvements: [] } }, 'en'), null);
  assert.equal(buildRemediationPrompt({ skillName: 'React', result: null }, 'en'), null);
  assert.equal(buildRemediationPrompt({ skillName: 'React' }, 'en'), null);
});

test('buildRemediationPrompt: includes intro, numbered improvements and closing (en)', () => {
  const p = buildRemediationPrompt(ITEM, 'en');
  assert.match(p, /Help me improve my React \(React\) code/);
  assert.match(p, /A code review flagged these improvements:/);
  assert.match(p, /1\. Add tests/);
  assert.match(p, /2\. Type the props/);
  assert.match(p, /follow the conventions I already use/);
});

test('buildRemediationPrompt: Spanish variant differs', () => {
  const es = buildRemediationPrompt(ITEM, 'es');
  assert.match(es, /Ayúdame a mejorar mi código de React/);
  assert.match(es, /1\. Add tests/); // improvement text is the LLM's, not translated
  assert.notEqual(es, buildRemediationPrompt(ITEM, 'en'));
});

test('buildRemediationPrompt: contains no code (only prose improvements)', () => {
  const p = buildRemediationPrompt(ITEM, 'en');
  assert.equal(p.includes('```'), false);
});
