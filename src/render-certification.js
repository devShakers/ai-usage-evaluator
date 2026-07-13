'use strict';

const { getCatalog } = require('./i18n');

/*
 * Renders the certify-phase report (skill-code-certification, issue 005).
 * Terminal + a SELF-CONTAINED, ZERO-NETWORK HTML page — deliberately a NEW
 * module, it does NOT touch the ai-footprint render templates (render-html.js
 * / render-terminal.js). i18n via the `certify.report` catalog (es/en).
 *
 * Always surfaces:
 *   - the "indicative / not reproducible" disclaimer (free LLM judgment, no
 *     rubric — ADR-002 / brief),
 *   - a "partial sample" warning whenever any Skill's sampling.truncated,
 *   - per Skill: score, rationale, improvements, and a sample summary
 *     (files included / candidates / ~tokens), or a clear "not certified" /
 *     "not sampleable" state.
 *
 * Input `certification` = { items: [{ skillName, technology, sampling,
 * result: {score, rationale, improvements[]} | null }], model? }.
 */

function anyTruncated(items) {
  return (items || []).some((i) => i && i.sampling && i.sampling.truncated);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- terminal ---------- */

function renderCertificationTerminal(certification, lang) {
  const r = getCatalog(lang).certify.report;
  const items = Array.isArray(certification && certification.items) ? certification.items : [];
  const lines = [];

  lines.push(r.heading);
  lines.push('');
  lines.push(r.disclaimer);
  if (anyTruncated(items)) lines.push(`\n  ${r.partialSampleWarning}`);
  lines.push('');

  if (items.length === 0) {
    lines.push(`  ${r.noItems}`);
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push(`── ${item.skillName}${item.technology ? ` (${item.technology})` : ''}`);
    if (item.sampling && item.sampling.sampleable === false) {
      lines.push(`   ${r.notSampleableNote(item.technology)}`);
      lines.push('');
      continue;
    }
    if (!item.result) {
      lines.push(`   ${r.notCertified}`);
      lines.push('');
      continue;
    }
    lines.push(`   ${r.scoreLine(item.result.score)}`);
    if (item.result.rationale) lines.push(`   ${r.rationaleLabel}: ${item.result.rationale}`);
    if (Array.isArray(item.result.improvements) && item.result.improvements.length > 0) {
      lines.push(`   ${r.improvementsLabel}:`);
      for (const imp of item.result.improvements) lines.push(`     - ${imp}`);
    }
    if (item.sampling) {
      const summary = r.sampleSummary(item.sampling.includedCount, item.sampling.candidateCount, item.sampling.estTokens);
      const tag = item.sampling.truncated ? ` ${r.partialTag}` : '';
      lines.push(`   ${summary}${tag}`);
    }
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '');
}

/* ---------- HTML (self-contained, zero network) ---------- */

function renderCertificationHtml(certification, lang) {
  const catalog = getCatalog(lang);
  const r = catalog.certify.report;
  const items = Array.isArray(certification && certification.items) ? certification.items : [];

  const sections = items.map((item) => {
    const head = `<h2>${escapeHtml(item.skillName)}${item.technology ? ` <span class="tech">${escapeHtml(item.technology)}</span>` : ''}</h2>`;
    if (item.sampling && item.sampling.sampleable === false) {
      return `<section class="skill not-sampleable">${head}<p class="note">${escapeHtml(r.notSampleableNote(item.technology))}</p></section>`;
    }
    if (!item.result) {
      return `<section class="skill not-certified">${head}<p class="note">${escapeHtml(r.notCertified)}</p></section>`;
    }
    const improvements = Array.isArray(item.result.improvements) && item.result.improvements.length
      ? `<p class="label">${escapeHtml(r.improvementsLabel)}</p><ul>${item.result.improvements.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
      : '';
    const sampleTag = item.sampling && item.sampling.truncated ? ` ${escapeHtml(r.partialTag)}` : '';
    const sample = item.sampling
      ? `<p class="sample">${escapeHtml(r.sampleSummary(item.sampling.includedCount, item.sampling.candidateCount, item.sampling.estTokens))}${sampleTag}</p>`
      : '';
    return `<section class="skill">${head}`
      + `<p class="score">${escapeHtml(r.scoreLine(item.result.score))}</p>`
      + (item.result.rationale ? `<p class="rationale"><span class="label">${escapeHtml(r.rationaleLabel)}:</span> ${escapeHtml(item.result.rationale)}</p>` : '')
      + improvements
      + sample
      + `</section>`;
  }).join('\n');

  const partial = anyTruncated(items) ? `<p class="warning">${escapeHtml(r.partialSampleWarning)}</p>` : '';
  const body = items.length === 0 ? `<p class="note">${escapeHtml(r.noItems)}</p>` : sections;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(catalog.html.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(r.htmlTitle)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; }
  .disclaimer { font-size: .9rem; opacity: .8; border-left: 3px solid #888; padding-left: .75rem; }
  .warning { background: #fff3cd; color: #664d03; padding: .5rem .75rem; border-radius: 6px; }
  .skill { border: 1px solid #8883; border-radius: 8px; padding: .75rem 1rem; margin: 1rem 0; }
  .skill h2 { font-size: 1.1rem; margin: 0 0 .5rem; }
  .tech { font-weight: normal; opacity: .7; font-size: .85rem; }
  .score { font-weight: 600; }
  .label { font-weight: 600; }
  .sample, .note { font-size: .85rem; opacity: .75; }
  ul { margin: .25rem 0 .5rem 1.25rem; }
</style>
</head>
<body>
<h1>${escapeHtml(r.heading)}</h1>
<p class="disclaimer">${escapeHtml(r.disclaimer)}</p>
${partial}
${body}
</body>
</html>`;
}

module.exports = { renderCertificationTerminal, renderCertificationHtml, anyTruncated };
