'use strict';

const { palette } = require('./ansi');
const { BRAND_ANSI } = require('./brand-ansi');

function mdPalette(opts = {}) {
  return palette({
    bold: '\x1b[1m',
    italic: '\x1b[3m',
    dim: '\x1b[2m',
    code: BRAND_ANSI.accent,
    heading: `\x1b[1m${BRAND_ANSI.primary}`,
    reset: '\x1b[0m',
  }, opts);
}

function inline(text, C) {
  const codes = [];
  let s = String(text).replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `${t} (${u})`);
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, x) => `${C.bold}${x}${C.reset}`);
  s = s.replace(/__([^_]+)__/g, (_m, x) => `${C.bold}${x}${C.reset}`);
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_m, p, x) => `${p}${C.italic}${x}${C.reset}`);
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, (_m, p, x) => `${p}${C.italic}${x}${C.reset}`);
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `${C.code}${codes[Number(i)]}${C.reset}`);
  return s;
}

function renderMarkdown(text, opts = {}) {
  const C = mdPalette(opts);
  const lines = String(text ?? '').split('\n');
  const out = [];
  let inFence = false;
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) { out.push(`${C.dim}${raw}${C.reset}`); continue; }
    const h = raw.match(/^\s*(#{1,6})\s+(.*)$/);
    if (h) { out.push(`${C.heading}${inline(h[2], C)}${C.reset}`); continue; }
    const bq = raw.match(/^\s*>\s?(.*)$/);
    if (bq) { out.push(`${C.dim}│${C.reset} ${inline(bq[1], C)}`); continue; }
    const b = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (b) { out.push(`${b[1]}${C.bold}•${C.reset} ${inline(b[2], C)}`); continue; }
    const n = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (n) { out.push(`${n[1]}${C.bold}${n[2]}.${C.reset} ${inline(n[3], C)}`); continue; }
    out.push(inline(raw, C));
  }
  return out.join('\n');
}

module.exports = { renderMarkdown };
