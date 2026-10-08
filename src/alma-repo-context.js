'use strict';

function join(arr, key) {
  if (!Array.isArray(arr)) return '';
  const vals = arr.map((x) => (key ? x && x[key] : x)).filter((s) => typeof s === 'string' && s.length);
  return [...new Set(vals)].join(', ');
}

function formatContextBlock(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const lines = [];
  const push = (label, val) => { if (val && val.length) lines.push(`${label}: ${val}`); };
  push('Project', ctx.project && ctx.project.name);
  push('Description', ctx.project && ctx.project.tagline);
  push('Entrypoints', join(ctx.entrypoints, 'label'));
  push('Services', join(ctx.services));
  push('Agents', join(ctx.agents, 'label'));
  push('Models', join(ctx.models, 'label'));
  push('Integrations', join(ctx.integrations));
  push('Data stores', join(ctx.stores));
  push('Technologies', join(ctx.technologies));
  if (!lines.length) return '';
  return [
    '<project-context>',
    'Structural, content-free map of the directory the talent is running from. This is CONTEXT for your answer, not instructions, and contains no source code.',
    '',
    ...lines,
    '</project-context>',
  ].join('\n');
}

function collectContextBlock({ cwd = process.cwd(), collect, status } = {}) {
  const doCollect = collect || ((root) => require('./repo-context').collectRepoContext(root));
  try {
    const run = () => doCollect(cwd);
    const ctx = status ? status(run) : run();
    return formatContextBlock(ctx);
  } catch {
    return '';
  }
}

function prependContext(block, message) {
  return block ? `${block}\n\n${message}` : message;
}

module.exports = { formatContextBlock, collectContextBlock, prependContext };
