'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderLegalNotice } = require('../src/legal-notice');
const { getCatalog } = require('../src/i18n');
const { needle } = require('../test-fixtures/copy-needle');

const SGR = /\x1b\[[0-9;]*m/;

function withStream({ isTTY, noColor }, fn) {
  const stream = { isTTY, write: () => true };
  const realNoColor = process.env.NO_COLOR;
  if (noColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = noColor;
  try {
    return fn(stream);
  } finally {
    if (realNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = realNoColor;
  }
}

const en = getCatalog('en');
const TEXT = en.certify.disclaimer;

test('renderLegalNotice: non-TTY -> returns the text COMPLETELY UNCHANGED (no heading, no rule, no ANSI)', () => {
  withStream({ isTTY: false }, (stream) => {
    const out = renderLegalNotice(TEXT, en, { stream });
    assert.equal(out, TEXT);
  });
});

test('renderLegalNotice: NO_COLOR beats a real TTY -> same, completely unchanged', () => {
  withStream({ isTTY: true, noColor: '1' }, (stream) => {
    const out = renderLegalNotice(TEXT, en, { stream });
    assert.equal(out, TEXT);
  });
});

test('renderLegalNotice: a real TTY frames the text with a heading + rule, and never touches the wording', () => {
  withStream({ isTTY: true }, (stream) => {
    const out = renderLegalNotice(TEXT, en, { stream });
    assert.match(out, SGR, 'a real TTY must colour the notice');
    assert.ok(out.includes(needle(en.legalNotice.label, 'en.legalNotice.label')), 'the heading label must be present');
    // The wording survives byte-identical, as a CONTIGUOUS substring — proves
    // nothing was split, reflowed, or rewritten mid-paragraph.
    assert.ok(out.includes(TEXT), 'the exact legal text must survive as a contiguous substring');
    // Stripping the ANSI must yield the heading + text + rules and NOTHING else
    // added to the text itself (rule-count sanity: exactly two rule lines).
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
    const ruleLines = stripped.split('\n').filter((l) => /^─+$/.test(l));
    assert.equal(ruleLines.length, 2, 'exactly one rule above and one below');
  });
});

test('renderLegalNotice: es and en each get their own localized heading label', () => {
  const es = getCatalog('es');
  withStream({ isTTY: true }, (stream) => {
    const outEs = renderLegalNotice(es.certify.disclaimer, es, { stream });
    const outEn = renderLegalNotice(en.certify.disclaimer, en, { stream });
    assert.ok(outEs.includes(needle(es.legalNotice.label, 'es.legalNotice.label')));
    assert.ok(outEn.includes(needle(en.legalNotice.label, 'en.legalNotice.label')));
    assert.notEqual(es.legalNotice.label, en.legalNotice.label, 'the two languages must not share the same heading text');
  });
});

test('renderLegalNotice: a missing/malformed catalog degrades to no heading, but still frames the text', () => {
  withStream({ isTTY: true }, (stream) => {
    const out = renderLegalNotice(TEXT, null, { stream });
    assert.match(out, SGR);
    assert.ok(out.includes(TEXT));
  });
});

test('renderLegalNotice: the same text produces the SAME wording styled or not — only the escapes differ', () => {
  withStream({ isTTY: true }, (stream) => {
    const colored = renderLegalNotice(TEXT, en, { stream });
    const plain = renderLegalNotice(TEXT, en, { stream: { isTTY: false, write: () => true } });
    assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, '').includes(plain), true);
  });
});

test('renderLegalNotice: colour path ends in a newline, so the closing rule can never become the editable answer line', () => {
  withStream({ isTTY: true }, (stream) => {
    const out = renderLegalNotice(TEXT, en, { stream });
    assert.equal(out.endsWith('\n'), true, 'must end in \\n so a prompt split on the LAST \\n lands AFTER the closing rule');

    // Mirrors EXACTLY how certify-agents.js / certify-skill-interview.js wrap this into an ask() prompt, and how src/stdin-ask.js / src/repl-stdin.js split it.
    const prompt = `  ${out} `;
    const lastNewline = prompt.lastIndexOf('\n');
    const staticPart = prompt.slice(0, lastNewline + 1);
    const editablePart = prompt.slice(lastNewline + 1);

    const strippedStatic = staticPart.replace(/\x1b\[[0-9;]*m/g, '');
    assert.match(strippedStatic, /─+\s*\n$/, 'the closing rule is part of the STATIC output (printed once, above), not the answer line');
    assert.equal(editablePart.includes('─'), false, 'the answer/cursor line must never contain the rule character');
  });
});

test('renderLegalNotice: the plain/degraded path is unaffected by the fix above — still exactly `text`, no trailing newline added', () => {
  withStream({ isTTY: false }, (stream) => {
    const out = renderLegalNotice(TEXT, en, { stream });
    assert.equal(out, TEXT);
    assert.equal(out.endsWith('\n'), false, 'the plain path has no rule to separate the cursor from — nothing to add here');
  });
});


test('renderLegalNotice: applies to the disclosure texts without altering any of them (es + en)', () => {
  const CATALOG_PATHS = [
    ['consent', 'persistIntro'],
    ['certify', 'disclaimer'],
  ];
  withStream({ isTTY: true }, (stream) => {
    for (const lang of ['es', 'en']) {
      const catalog = getCatalog(lang);
      for (const [section, key] of CATALOG_PATHS) {
        const text = catalog[section][key];
        const out = renderLegalNotice(text, catalog, { stream });
        assert.ok(out.includes(text), `[${lang}] ${section}.${key} lost its exact wording under styling`);
      }
    }
  });
});
