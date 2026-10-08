'use strict';

// Making text that came off the wire SAFE TO DISPLAY.

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;

const INVISIBLE_CHARS_RE =
  /[\u00AD\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]|[\u{E0000}-\u{E007F}]/gu;

function stripControlChars(s) {
  if (typeof s !== 'string') return '';
  return s.replace(CONTROL_CHARS_RE, '');
}

// Replaces every bidi/invisible character with a visible `[U+XXXX]` token.
function markInvisibleChars(s) {
  if (typeof s !== 'string') return '';
  return s.replace(INVISIBLE_CHARS_RE, (ch) => {
    const hex = ch.codePointAt(0).toString(16).toUpperCase();
    return `[U+${hex.length < 4 ? hex.padStart(4, '0') : hex}]`;
  });
}

// What every renderer should call on text that came off the wire before painting it.
function sanitizeRenderText(s) {
  return markInvisibleChars(stripControlChars(s));
}

// `jsonEscapeInvisibleChars` WAS HERE, and what is missing is the SURFACE, not the helper.

module.exports = {
  stripControlChars,
  markInvisibleChars,
  sanitizeRenderText,
};
