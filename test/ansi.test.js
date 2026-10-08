'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { palette, colorEnabled, noColorRequested, styleQuestion, styleSuccess, styleLabel, styleLabelPrefix } = require('../src/ansi');
const { renderCertificationTerminal } = require('../src/render-certification');

// The single colour gate (talents-ai-score).

const SGR = /\x1b\[[0-9;]*m/;

const TTY = { isTTY: true };
const PIPE = { isTTY: false };

test('styleLabel: bold when colour on, plain when off (TTY/NO_COLOR gate)', () => {
  assert.equal(styleLabel('Company:', { stream: TTY, env: {} }), '\x1b[1mCompany:\x1b[0m');
  assert.equal(styleLabel('Company:', { stream: PIPE, env: {} }), 'Company:'); // piped -> plain
  assert.equal(styleLabel('Company:', { stream: TTY, env: { NO_COLOR: '1' } }), 'Company:'); // NO_COLOR wins
});

test('styleLabelPrefix: bolds only the "Label:" prefix, value stays plain', () => {
  assert.equal(styleLabelPrefix('Company: Acme', { stream: TTY, env: {} }), '\x1b[1mCompany:\x1b[0m Acme');
  assert.equal(styleLabelPrefix('Company: Acme', { stream: PIPE, env: {} }), 'Company: Acme');
  // No "Label: " -> returned unchanged (a value-only line never gets bolded).
  assert.equal(styleLabelPrefix('REMOTE · ES · match 92', { stream: TTY, env: {} }), 'REMOTE · ES · match 92');
  // Only the FIRST ": " splits: a colon inside the value stays in the value.
  assert.equal(styleLabelPrefix('Skills: React, Node: v18', { stream: TTY, env: {} }), '\x1b[1mSkills:\x1b[0m React, Node: v18');
});

function withStdout({ isTTY, noColor }, fn) {
  const realTTY = process.stdout.isTTY;
  const realNoColor = process.env.NO_COLOR;
  process.stdout.isTTY = isTTY;
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
  try {
    return fn();
  } finally {
    process.stdout.isTTY = realTTY;
    if (realNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = realNoColor;
  }
}

/* ---------------------------- the predicate ---------------------------- */

test('noColorRequested: presence is the signal, the value is irrelevant', () => {
  assert.equal(noColorRequested({}), false);
  assert.equal(noColorRequested({ NO_COLOR: '' }), false, 'empty means absent — it is how a wrapper neutralises an inherited value');
  assert.equal(noColorRequested({ NO_COLOR: '1' }), true);
  assert.equal(noColorRequested({ NO_COLOR: '0' }), true, 'NO_COLOR=0 still means no colour (no-color.org)');
  assert.equal(noColorRequested({ NO_COLOR: 'false' }), true);
  assert.equal(noColorRequested(null), false);
});

test('colorEnabled: a TTY turns it on, a pipe turns it off, NO_COLOR beats both', () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  assert.equal(colorEnabled({ stream: tty, env: {} }), true);
  assert.equal(colorEnabled({ stream: pipe, env: {} }), false);
  assert.equal(colorEnabled({ stream: tty, env: { NO_COLOR: '1' } }), false, 'NO_COLOR must win on a real terminal too');
  assert.equal(colorEnabled({ stream: pipe, env: { NO_COLOR: '1' } }), false);
  // Nothing to write to is not a terminal.
  assert.equal(colorEnabled({ stream: undefined, env: {} }), false);
});

test('palette: keys yield the escape when on and the EMPTY STRING when off, so call sites need no branch', () => {
  const on = palette({ bold: '\x1b[1m', reset: '\x1b[0m' }, { stream: { isTTY: true }, env: {} });
  const off = palette({ bold: '\x1b[1m', reset: '\x1b[0m' }, { stream: { isTTY: false }, env: {} });
  assert.equal(`${on.bold}x${on.reset}`, '\x1b[1mx\x1b[0m');
  assert.equal(`${off.bold}x${off.reset}`, 'x');
  // Behaves like the plain object it replaced.
  assert.deepEqual(Object.keys(off), ['bold', 'reset']);
});

test('palette: the decision is taken at ACCESS time, not at require time', () => {
  const env = {};
  const stream = { isTTY: true };
  const p = palette({ bold: '\x1b[1m' }, { stream, env });
  assert.equal(p.bold, '\x1b[1m');
  env.NO_COLOR = '1';
  assert.equal(p.bold, '', 'the same object must reflect the new answer — no module cache reset needed');
  delete env.NO_COLOR;
  stream.isTTY = false;
  assert.equal(p.bold, '');
});

/* --------------- styleQuestion: the ONE "user question" style --------------- */

test('styleQuestion: bold + brand primary on colour, byte-identical text otherwise', () => {
  const on = styleQuestion('What do you want to do?', { stream: { isTTY: true }, env: {} });
  assert.match(on, SGR, 'must actually carry an SGR code when colour is enabled');
  assert.match(on, /\x1b\[1m/, 'bold');
  assert.match(on, /What do you want to do\?/, 'never rewords the text');

  const off = styleQuestion('What do you want to do?', { stream: { isTTY: false }, env: {} });
  assert.equal(off, 'What do you want to do?', 'no TTY -> plain text, not half-styled');
});

test('styleQuestion: NO_COLOR strips it even on a real terminal', () => {
  const suppressed = styleQuestion('Continue?', { stream: { isTTY: true }, env: { NO_COLOR: '1' } });
  assert.equal(suppressed, 'Continue?');
});

/* ------- styleSuccess: the ONE confirmation-line green (256-colour 114) ------- */

test('styleSuccess: soft-green (114) on colour, byte-identical text otherwise', () => {
  const on = styleSuccess('✓ Added to your profile: Zustand (unverified).', { stream: { isTTY: true }, env: {} });
  assert.match(on, /\x1b\[38;5;114m/, 'must carry the 114 success green, not a new colour');
  assert.match(on, /✓ Added to your profile: Zustand \(unverified\)\./, 'never rewords the text');

  const off = styleSuccess('✓ Added to your profile: Zustand (unverified).', { stream: { isTTY: false }, env: {} });
  assert.equal(off, '✓ Added to your profile: Zustand (unverified).', 'no TTY -> plain text');
});

test('styleSuccess: NO_COLOR strips the green even on a real terminal', () => {
  const suppressed = styleSuccess('✓ done', { stream: { isTTY: true }, env: { NO_COLOR: '1' } });
  assert.equal(suppressed, '✓ done');
});

/* ------------------- the renderers actually go through it ------------------- */

// Same shape render-certification.test.js uses; only the fields the terminal
// render reads are needed here.
const CERTIFICATION = {
  items: [{
    skillId: 1,
    skillName: 'React',
    technology: 'React',
    sampling: { sampleable: true, includedCount: 3, candidateCount: 5, estTokens: 1200, truncated: false, capReason: null },
    result: { score: 82, rationale: 'Solid component patterns.', improvements: ['Add tests'] },
  }],
  model: null,
};

test('piped output carries NO colour: the bug this closes (`certify skills > result.log`)', () => {
  withStdout({ isTTY: false }, () => {
    const skills = renderCertificationTerminal(CERTIFICATION, 'en');
    assert.equal(SGR.test(skills), false, 'a redirected result must be readable text, not escape sequences');
    // The text itself is untouched — this strips decoration, not content.
    assert.match(skills, /React/);
  });
});

test('a real terminal still gets colour, and NO_COLOR takes it away again', () => {
  const colored = withStdout({ isTTY: true }, () => renderCertificationTerminal(CERTIFICATION, 'en'));
  assert.equal(SGR.test(colored), true, 'without this assertion the test above passes on a renderer that never coloured anything');

  const suppressed = withStdout({ isTTY: true, noColor: '1' }, () => renderCertificationTerminal(CERTIFICATION, 'en'));
  assert.equal(SGR.test(suppressed), false);
  // Same text either way: only the escapes differ.
  assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ''), suppressed);
});
