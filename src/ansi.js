'use strict';

const { isInteractive } = require('./terminal-progress');
const { BRAND_ANSI } = require('./brand-ansi');

// THE ONE GATE for terminal colour (talents-ai-score).

// `NO_COLOR` per the de-facto standard: present and non-empty disables colour, whatever the value.
function noColorRequested(env = process.env) {
  const value = env ? env.NO_COLOR : undefined;
  return typeof value === 'string' && value.length > 0;
}

// The gate. `stream` defaults to stdout because every palette in this repo
// decorates text that ends up there.
function colorEnabled({ stream = process.stdout, env = process.env } = {}) {
  if (noColorRequested(env)) return false;
  return isInteractive(stream);
}

// Wraps a map of escape codes so each key yields its code when colour is on and `''` when it is off.
function palette(codes, opts = {}) {
  const out = {};
  for (const key of Object.keys(codes)) {
    const code = codes[key];
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => (colorEnabled(opts) ? code : ''),
    });
  }
  return out;
}

function styleQuestion(text, opts = {}) {
  const ANSI = palette({ bold: '\x1b[1m', primary: BRAND_ANSI.primary, reset: '\x1b[0m' }, opts);
  return `${ANSI.bold}${ANSI.primary}${text}${ANSI.reset}`;
}

const SUCCESS_GREEN = '\x1b[38;5;114m';

function styleSuccess(text, opts = {}) {
  const ANSI = palette({ success: SUCCESS_GREEN, reset: '\x1b[0m' }, opts);
  return `${ANSI.success}${text}${ANSI.reset}`;
}

// Bold a field LABEL (no colour). Gate-aware via `palette`: empty codes when
// colour is off (non-TTY / NO_COLOR), so piped/redirected output stays clean.
function styleLabel(text, opts = {}) {
  const ANSI = palette({ bold: '\x1b[1m', reset: '\x1b[0m' }, opts);
  return `${ANSI.bold}${text}${ANSI.reset}`;
}

// Bold only the "Label:" prefix of a "Label: value" line, leaving the value
// plain. No `: ` -> returned unchanged (value-only lines never get bolded).
function styleLabelPrefix(line, opts = {}) {
  const s = typeof line === 'string' ? line : '';
  const idx = s.indexOf(': ');
  if (idx === -1) return s;
  return `${styleLabel(s.slice(0, idx + 1), opts)}${s.slice(idx + 1)}`;
}

module.exports = { palette, colorEnabled, noColorRequested, styleQuestion, styleSuccess, styleLabel, styleLabelPrefix, SUCCESS_GREEN };
