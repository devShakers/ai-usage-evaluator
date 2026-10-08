'use strict';

// Plain text out of the talent's CV (PDF, DOC, DOCX), so the AI can pre-fill from
// what the CV says. Zero-dependency on purpose (install.sh copies the CLI without
// npm install): on macOS PDFs go through the system PDFKit (JXA) and Word files
// through textutil; elsewhere PDFs through poppler's pdftotext when installed.
// With none, the caller asks the talent to attach the CV to the chat instead.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { expandHome } = require('./env-paths');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_CHARS = 20000;

const JXA_PDF_TEXT = 'function run(argv){ObjC.import("PDFKit");'
  + 'const d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));'
  + 'return d.isNil()?"":d.string.js}';

function run(cmd, args, exec) {
  return String(exec(cmd, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) || '');
}

function extractors(platform, file) {
  const list = [];
  if (/\.docx?$/i.test(file)) {
    if (platform === 'darwin') list.push({ name: 'textutil', cmd: 'textutil', args: (f) => ['-convert', 'txt', '-stdout', f] });
    return list;
  }
  if (platform === 'darwin') list.push({ name: 'pdfkit', cmd: 'osascript', args: (f) => ['-l', 'JavaScript', '-e', JXA_PDF_TEXT, f] });
  list.push({ name: 'pdftotext', cmd: 'pdftotext', args: (f) => ['-layout', '-q', f, '-'] });
  return list;
}

const fold = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Whether the CV text names the talent: every name token of 3+ letters present.
// Lets the AI drop a stranger's CV without showing its contents.
function mentionsName(text, talentName) {
  const tokens = fold(talentName).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  const body = fold(text);
  return tokens.every((t) => body.includes(t));
}

const uniq = (list) => [...new Set(list)];

// Contact links a CV header usually carries, so the AI can fill them directly.
function extractLinks(text) {
  const t = String(text || '');
  return {
    linkedin: uniq((t.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+/gi) || []).map((u) => `https://www.${u.replace(/^https?:\/\//i, '').replace(/^(?:[a-z]{2,3}\.)?linkedin/i, 'linkedin')}`)),
    github: uniq((t.match(/(?:https?:\/\/)?github\.com\/[A-Za-z0-9-]+/gi) || []).map((u) => `https://${u.replace(/^https?:\/\//i, '')}`)),
    emails: uniq(t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []),
    phones: uniq((t.match(/\+\d{1,3}[\s.-]?\d[\d\s.-]{6,14}\d/g) || []).map((p) => p.replace(/[\s.-]+/g, ' ').trim())),
  };
}

function readCvText(input, { platform = process.platform, exec = execFileSync, env = process.env, talentName = null } = {}) {
  const file = expandHome(input, env);
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.(pdf|docx?)$/i.test(file)) return { ok: false, reason: 'not-a-cv-path' };
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  if (!stat.isFile()) return { ok: false, reason: 'not-found' };
  if (stat.size > MAX_BYTES) return { ok: false, reason: 'too-large' };

  for (const extractor of extractors(platform, file)) {
    let text;
    try {
      text = run(extractor.cmd, extractor.args(file), exec).trim();
    } catch {
      continue;
    }
    if (!text) continue;
    return {
      ok: true,
      extractor: extractor.name,
      mentionsTalent: mentionsName(text, talentName),
      links: extractLinks(text),
      truncated: text.length > MAX_CHARS,
      text: text.slice(0, MAX_CHARS),
    };
  }
  return { ok: false, reason: 'no-text-extracted' };
}

module.exports = { readCvText, extractLinks, mentionsName, MAX_CHARS };
