'use strict';

const { getCatalog } = require('./i18n');
const { buildRemediationPrompt } = require('./certify-remediation-prompt');

/*
 * Renders the certify-phase report (skill-code-certification, issues 005 +
 * 011). Terminal (with visual hierarchy + color, so the result stands out and
 * is NOT confusable with the disclaimer/instructions) + a SELF-CONTAINED,
 * ZERO-NETWORK HTML page. NEW module — does NOT touch the ai-footprint render
 * templates. i18n via the `certify.report` catalog (es/en).
 *
 * Surfaces: the "indicative / not reproducible" disclaimer (kept visually
 * quiet/dim), a cost note (issue 012), a "partial sample" warning when
 * truncated, and per Skill a bold colored score, rationale, improvements,
 * sample summary, and a copyable REMEDIATION PROMPT (issue 011) — terminal
 * block + HTML copy button.
 *
 * Input `certification` = { items: [{ skillName, technology, sampling,
 * result: {score, rationale, improvements[]} | null }], model? }.
 */

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function anyTruncated(items) {
  return (items || []).some((i) => i && i.sampling && i.sampling.truncated);
}

// Score band -> semantic (shared by terminal color + HTML class).
function scoreBand(score) {
  if (typeof score !== 'number') return 'mid';
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}
function bandColor(band) {
  return band === 'high' ? C.green : band === 'low' ? C.red : C.yellow;
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

const RULE = '────────────────────────────────────────';

function renderCertificationTerminal(certification, lang) {
  const r = getCatalog(lang).certify.report;
  const items = Array.isArray(certification && certification.items) ? certification.items : [];
  const lines = [];

  // Header stands out; disclaimer + cost note are deliberately quiet (dim) so
  // the per-Skill results below are visually dominant (issue 011 feedback).
  lines.push(`${C.bold}${C.cyan}${r.heading}${C.reset}`);
  lines.push('');
  lines.push(`${C.dim}${r.disclaimer}${C.reset}`);
  lines.push(`${C.dim}${r.costNote}${C.reset}`);
  if (anyTruncated(items)) lines.push(`\n  ${C.yellow}${r.partialSampleWarning}${C.reset}`);
  lines.push('');

  if (items.length === 0) {
    lines.push(`  ${r.noItems}`);
    return lines.join('\n');
  }

  for (const item of items) {
    const title = `${item.skillName}${item.technology ? ` (${item.technology})` : ''}`;
    lines.push(`${C.bold}${C.cyan}╭─ ${title}${C.reset}`);

    if (item.sampling && item.sampling.sampleable === false) {
      lines.push(`${C.cyan}│${C.reset}  ${r.notSampleableNote(item.technology)}`);
      lines.push(`${C.cyan}╰─${C.reset}`);
      lines.push('');
      continue;
    }
    if (!item.result) {
      lines.push(`${C.cyan}│${C.reset}  ${r.notCertified}`);
      lines.push(`${C.cyan}╰─${C.reset}`);
      lines.push('');
      continue;
    }

    const band = scoreBand(item.result.score);
    lines.push(`${C.cyan}│${C.reset}  ${C.bold}${bandColor(band)}${r.scoreLine(item.result.score)}${C.reset}`);
    if (item.result.rationale) {
      lines.push(`${C.cyan}│${C.reset}  ${C.bold}${r.rationaleLabel}:${C.reset} ${item.result.rationale}`);
    }
    if (Array.isArray(item.result.improvements) && item.result.improvements.length > 0) {
      lines.push(`${C.cyan}│${C.reset}  ${C.bold}${r.improvementsLabel}:${C.reset}`);
      for (const imp of item.result.improvements) lines.push(`${C.cyan}│${C.reset}    • ${imp}`);
    }
    if (item.sampling) {
      const summary = r.sampleSummary(item.sampling.includedCount, item.sampling.candidateCount, item.sampling.estTokens);
      const tag = item.sampling.truncated ? ` ${r.partialTag}` : '';
      lines.push(`${C.cyan}│${C.reset}  ${C.dim}${summary}${tag}${C.reset}`);
    }

    // Remediation prompt (issue 011): a clearly delimited copyable block.
    const remediation = buildRemediationPrompt(item, lang);
    if (remediation) {
      lines.push(`${C.cyan}│${C.reset}`);
      lines.push(`${C.cyan}│${C.reset}  ${C.bold}${r.remediationHeading}${C.reset}`);
      lines.push(`${C.cyan}│${C.reset}  ${C.dim}${r.remediationHint}${C.reset}`);
      lines.push(`${C.cyan}│${C.reset}  ${C.dim}${RULE}${C.reset}`);
      for (const l of remediation.split('\n')) lines.push(`${C.cyan}│${C.reset}  ${l}`);
      lines.push(`${C.cyan}│${C.reset}  ${C.dim}${RULE}${C.reset}`);
    }

    lines.push(`${C.cyan}╰─${C.reset}`);
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '');
}

/* ---------- HTML (self-contained, zero network, inline copy script) ---------- */

function renderCertificationHtml(certification, lang) {
  const catalog = getCatalog(lang);
  const r = catalog.certify.report;
  const items = Array.isArray(certification && certification.items) ? certification.items : [];

  let anyRemediation = false;

  const sections = items.map((item, index) => {
    const head =
      `<div class="skill-head"><h2>${escapeHtml(item.skillName)}`
      + `${item.technology ? ` <span class="tech">${escapeHtml(item.technology)}</span>` : ''}</h2>`;

    if (item.sampling && item.sampling.sampleable === false) {
      return `<section class="skill not-sampleable">${head}</div><p class="note">${escapeHtml(r.notSampleableNote(item.technology))}</p></section>`;
    }
    if (!item.result) {
      return `<section class="skill not-certified">${head}</div><p class="note">${escapeHtml(r.notCertified)}</p></section>`;
    }

    const band = scoreBand(item.result.score);
    const scoreBadge = `<span class="score-badge band-${band}">${escapeHtml(r.scoreLine(item.result.score))}</span></div>`;

    const improvements =
      Array.isArray(item.result.improvements) && item.result.improvements.length
        ? `<p class="label">${escapeHtml(r.improvementsLabel)}</p><ul>${item.result.improvements.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
        : '';
    const sampleTag = item.sampling && item.sampling.truncated ? ` ${escapeHtml(r.partialTag)}` : '';
    const sample = item.sampling
      ? `<p class="sample">${escapeHtml(r.sampleSummary(item.sampling.includedCount, item.sampling.candidateCount, item.sampling.estTokens))}${sampleTag}</p>`
      : '';

    let remediationHtml = '';
    const remediation = buildRemediationPrompt(item, lang);
    if (remediation) {
      anyRemediation = true;
      const id = `rem-${index}`;
      remediationHtml =
        `<div class="remediation"><div class="remediation-head">`
        + `<span class="label">${escapeHtml(r.remediationHeading)}</span>`
        + `<button type="button" class="copy-btn" data-copy-target="${id}" data-copied-label="${escapeHtml(r.remediationCopiedLabel)}">${escapeHtml(r.remediationCopyLabel)}</button>`
        + `</div><p class="hint">${escapeHtml(r.remediationHint)}</p>`
        + `<pre id="${id}">${escapeHtml(remediation)}</pre></div>`;
    }

    return `<section class="skill">${head}${scoreBadge}`
      + (item.result.rationale ? `<p class="rationale"><span class="label">${escapeHtml(r.rationaleLabel)}:</span> ${escapeHtml(item.result.rationale)}</p>` : '')
      + improvements
      + sample
      + remediationHtml
      + `</section>`;
  }).join('\n');

  const partial = anyTruncated(items) ? `<p class="warning">${escapeHtml(r.partialSampleWarning)}</p>` : '';
  const body = items.length === 0 ? `<p class="note">${escapeHtml(r.noItems)}</p>` : sections;

  // Inline, zero-network copy script (only when there's a prompt to copy).
  // Reads text from the target's own textContent — no prompt re-embedded as a
  // JS string, so no escaping concerns. Mirrors render-html.js's pattern.
  const copyScript = anyRemediation
    ? `\n<script>
document.querySelectorAll('[data-copy-target]').forEach(function(btn){
  btn.addEventListener('click', function(){
    var t = document.getElementById(btn.getAttribute('data-copy-target'));
    if (!t) return;
    var text = t.textContent;
    var done = function(){
      var orig = btn.getAttribute('data-original-label') || btn.textContent;
      btn.setAttribute('data-original-label', orig);
      btn.textContent = btn.getAttribute('data-copied-label') || orig;
      btn.classList.add('copied');
      setTimeout(function(){ btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
    };
    var fallback = function(){
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly','');
      ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function(){ fallback(); done(); });
    } else { fallback(); done(); }
  });
});
</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="${escapeHtml(catalog.html.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(r.htmlTitle)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 780px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; }
  .disclaimer, .costnote { font-size: .85rem; opacity: .7; border-left: 3px solid #888; padding-left: .75rem; }
  .warning { background: #fff3cd; color: #664d03; padding: .5rem .75rem; border-radius: 6px; font-weight: 600; }
  .skill { border: 1px solid #8884; border-radius: 10px; padding: 1rem 1.25rem; margin: 1.25rem 0; box-shadow: 0 1px 2px #0001; }
  .skill-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .5rem; }
  .skill-head h2 { font-size: 1.15rem; margin: 0; }
  .tech { font-weight: normal; opacity: .7; font-size: .85rem; }
  .score-badge { font-weight: 700; font-size: 1rem; padding: .2rem .6rem; border-radius: 999px; white-space: nowrap; color: #fff; }
  .band-high { background: #157347; }
  .band-mid { background: #997404; }
  .band-low { background: #b02a37; }
  .rationale { margin: .5rem 0; }
  .label { font-weight: 700; }
  .sample, .note, .hint { font-size: .85rem; opacity: .75; }
  ul { margin: .25rem 0 .75rem 1.25rem; }
  .remediation { margin-top: .9rem; border-top: 1px dashed #8884; padding-top: .75rem; }
  .remediation-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .copy-btn { font: inherit; font-size: 12px; padding: .25rem .6rem; border: 1px solid #8886; border-radius: 6px; background: transparent; cursor: pointer; }
  .copy-btn.copied { color: #157347; border-color: #157347; }
  pre { background: #8881; padding: .75rem; border-radius: 8px; overflow: auto; white-space: pre-wrap; font-size: .85rem; }
</style>
</head>
<body>
<h1>${escapeHtml(r.heading)}</h1>
<p class="disclaimer">${escapeHtml(r.disclaimer)}</p>
<p class="costnote">${escapeHtml(r.costNote)}</p>
${partial}
${body}${copyScript}
</body>
</html>`;
}

module.exports = { renderCertificationTerminal, renderCertificationHtml, anyTruncated, scoreBand };
