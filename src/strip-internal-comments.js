'use strict';

// Our comments do not travel in the talent's shareable report (issue 098).

// `<!-- … -->`, including multi-line.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// `/* … */`, the CSS and JS block form. Same verification as above.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

// A whole line that is nothing but a `//` comment.
const LINE_COMMENT_RE = /^[ \t]*\/\/[^\n]*$/gm;

// Three or more consecutive newlines (what a removed comment block leaves
// behind) collapse to two. Never touches indentation or single blank lines.
const BLANK_RUN_RE = /\n{3,}/g;

function stripTemplateComments(html) {
  if (typeof html !== 'string' || !html) return '';
  return html
    .replace(HTML_COMMENT_RE, '')
    .replace(BLOCK_COMMENT_RE, '')
    .replace(LINE_COMMENT_RE, '')
    .replace(BLANK_RUN_RE, '\n\n');
}

// The patterns that make a comment an INTERNAL reference — exported so the test and this module agree on one definition instead of two.
const INTERNAL_REFERENCE_PATTERNS = Object.freeze([
  { label: 'issue reference', re: /\bissues?\s*#?\d{2,4}\b/i },
  { label: 'commit hash', re: /(?<![#\w])(?=[0-9a-f]{7,40}(?![\w]))(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\w])/ },
  { label: 'src/ file path', re: /\bsrc\/[a-z0-9-]+\.(?:js|html|css)\b/i },
  { label: 'ADR reference', re: /\bADR-\d{2,3}\b/ },
]);

function findInternalReferences(text) {
  const hay = typeof text === 'string' ? text : '';
  const found = [];
  for (const { label, re } of INTERNAL_REFERENCE_PATTERNS) {
    const m = hay.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
    if (m && m.length) found.push({ label, matches: [...new Set(m)] });
  }
  return found;
}

module.exports = { stripTemplateComments, findInternalReferences, INTERNAL_REFERENCE_PATTERNS };
