'use strict';

const { getCatalog } = require('./i18n');
const { trustCopy } = require('./signup-copy');

const SET_VARIANTS = new Set(['availability', 'rate', 'lang', 'socials']);

function trustCatalog(lang) {
  return getCatalog(lang === 'es' ? 'es' : 'en').trust;
}

function mcpNarration(tool, lang, { failed = false } = {}) {
  const t = trustCopy(lang);
  const line = t.mcp[tool];
  if (!line) return null;
  return [`${t.heading} ${line}`, failed ? t.failed : null].filter(Boolean).join('\n');
}

function cliNarration(command, args, lang) {
  const t = trustCatalog(lang);
  const key = SET_VARIANTS.has(command) && args.includes('--set') ? `${command}:set` : command;
  const entry = t.cli[key] || t.cli[command] || {};
  return { before: entry.before || null, after: entry.after || null };
}

function changedNothing(outcome) {
  if (!outcome || typeof outcome !== 'object') return false;
  if (outcome.cancelled === true || outcome.ok === false) return true;
  return !('ok' in outcome) && typeof outcome.reason === 'string';
}

module.exports = { mcpNarration, cliNarration, changedNothing };
