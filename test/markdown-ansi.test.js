'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdown } = require('../src/markdown-ansi');

const NO_COLOR = { stream: { isTTY: false }, env: {} };
const WITH_COLOR = { stream: { isTTY: true }, env: {} };

test('markdown: strips bold/italic/code markers even when color is off (never leaves literal **)', () => {
  const out = renderMarkdown('This is **bold**, _italic_ and `code`.', NO_COLOR);
  assert.equal(out, 'This is bold, italic and code.');
  assert.doesNotMatch(out, /\*\*/);
  assert.doesNotMatch(out, /`/);
});

test('markdown: bullets and numbered lists become glyphs', () => {
  const out = renderMarkdown('- one\n- two\n1. first\n2. second', NO_COLOR);
  const lines = out.split('\n');
  assert.equal(lines[0], '• one');
  assert.equal(lines[1], '• two');
  assert.equal(lines[2], '1. first');
  assert.equal(lines[3], '2. second');
});

test('markdown: headings keep their text, drop the hashes', () => {
  const out = renderMarkdown('# Title\ntext', NO_COLOR);
  assert.equal(out.split('\n')[0], 'Title');
  assert.doesNotMatch(out, /#/);
});

test('markdown: fenced code block drops the fence line and keeps the body', () => {
  const out = renderMarkdown('```js\nconst x = 1;\n```', NO_COLOR);
  assert.equal(out, 'const x = 1;');
  assert.doesNotMatch(out, /```/);
});

test('markdown: links render as "text (url)"', () => {
  const out = renderMarkdown('see [the docs](https://x.dev)', NO_COLOR);
  assert.equal(out, 'see the docs (https://x.dev)');
});

test('markdown: with color on, bold is wrapped in ANSI and no literal markers survive', () => {
  const out = renderMarkdown('**hi**', WITH_COLOR);
  assert.match(out, /\x1b\[1m/);
  assert.match(out, /\x1b\[0m/);
  assert.doesNotMatch(out, /\*\*/);
});
