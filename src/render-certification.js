'use strict';

const { getCatalog } = require('./i18n');
const { buildRemediationPrompt } = require('./certify-remediation-prompt');
const { renderDocument } = require('./report-theme');

/*
 * Renders the certify-phase report (skill-code-certification, issues 005 +
 * 011). Terminal (with visual hierarchy + color, so the result stands out and
 * is NOT confusable with the disclaimer/instructions) + a SELF-CONTAINED,
 * ZERO-NETWORK HTML page.
 *
 * Reporting redesign (skill-code-certification): the HTML now shares the
 * Shakers theme (src/report-theme.js) with the footprint report instead of the
 * old generic system-ui / light-dark stylesheet — same white background
 * (priority #1), same teal/lime/zinc tokens, same Inter type scale. The
 * per-Skill sections are also exported (`certificationSectionsHtml`) so the
 * cumulative report (src/report-store.js) can stitch them into ONE document
 * alongside the footprint. i18n via the `certify.report` catalog (es/en).
 *
 * Surfaces: the "indicative / not reproducible" disclaimer (kept visually
 * quiet), a cost note (issue 012), a "partial sample" warning when truncated,
 * and per Skill a colored score, rationale, improvements, sample summary, and
 * a copyable REMEDIATION PROMPT (issue 011 — terminal block + HTML copy button
 * driven by report-theme's shared, zero-network clipboard script).
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

// ADR-024 rubric dimension order (terminal + HTML render).
const DIMENSION_KEYS = ['idiomatic', 'correctness', 'depth', 'structure', 'testing'];

// ADR-025 authorship receipt (HTML). Renders the file → git author → ✓/✗ trail
// plus repo/commit range, confirmed authors, and the honest "attribution, not
// cryptographic proof" note. `rc` is `catalog.certify.report.receipt`. Returns
// '' when there is no receipt data (older state / no authorship).
function renderReceiptHtml(item, rc) {
  if (!rc) return '';
  const files = Array.isArray(item.fileAttribution) ? item.fileAttribution : [];
  const authorEmails = Array.isArray(item.authorEmails) ? item.authorEmails : [];
  const repo = item.repository || (item.authorship && item.authorship.repository) || null;
  const commitRange = item.commitRange || (item.authorship && item.authorship.commitRange) || null;
  if (files.length === 0 && authorEmails.length === 0 && !repo && !commitRange) return '';

  const meta = [];
  if (repo) meta.push(`<li>${escapeHtml(rc.repoLabel)}: ${escapeHtml(repo)}</li>`);
  if (commitRange) meta.push(`<li>${escapeHtml(rc.commitRangeLabel)}: ${escapeHtml(commitRange)}</li>`);

  const fileRows = files
    .map((f) => {
      const mark = f.attributed ? rc.attributedYes : rc.attributedNo;
      const authors = Array.isArray(f.authors) && f.authors.length ? f.authors.join(', ') : '—';
      return `<tr><td>${mark}</td><td>${escapeHtml(f.path)}</td><td>${escapeHtml(authors)}</td></tr>`;
    })
    .join('');
  const fileTable = fileRows
    ? `<table class="attribution"><thead><tr><th></th><th>${escapeHtml(rc.filesLabel)}</th><th>${escapeHtml(rc.authorLabel)}</th></tr></thead><tbody>${fileRows}</tbody></table>`
    : '';

  const confirmed = authorEmails.filter((a) => a && a.matched).map((a) => a.email);
  const confirmedHtml = confirmed.length
    ? `<p class="attribution-confirmed">${escapeHtml(rc.confirmedLabel)}: ${escapeHtml(confirmed.join(', '))}</p>`
    : '';

  return (
    `<div class="attribution-receipt"><p class="label">${escapeHtml(rc.label)}</p>`
    + (meta.length ? `<ul class="attribution-meta">${meta.join('')}</ul>` : '')
    + fileTable
    + confirmedHtml
    + `<p class="attribution-note">${escapeHtml(rc.note)}</p></div>`
  );
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

// Terminal-condense (CPO feedback): the LLM rationale can be several
// sentences. In the TERMINAL we trim it to its essence — up to the sentence
// boundary before ~220 chars, else a hard cut with an ellipsis. The HTML
// report keeps the full rationale untouched. Never touches improvements or the
// remediation prompt (those stay verbatim, they are the actionable payload).
const RATIONALE_MAX = 220;
function conciseRationale(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length <= RATIONALE_MAX) return s;
  const window = s.slice(0, RATIONALE_MAX);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (lastStop >= 80) return window.slice(0, lastStop + 1);
  return `${window.replace(/[\s.,;:]+$/, '')}…`;
}

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
  // ADR-025 authorship receipt (run-level): repo + commit range + honest note,
  // shown once. Attribution is based on git authorship, NOT cryptographic proof.
  const authorship = (certification && certification.authorship) || null;
  const rc = r.receipt;
  if (rc && authorship && (authorship.repository || authorship.commitRange)) {
    const bits = [];
    if (authorship.repository) bits.push(`${rc.repoLabel}: ${authorship.repository}`);
    if (authorship.commitRange) bits.push(`${rc.commitRangeLabel}: ${authorship.commitRange}`);
    lines.push(`${C.dim}${rc.label} — ${bits.join(' · ')}${C.reset}`);
  }
  if (rc) lines.push(`${C.dim}${rc.note}${C.reset}`);
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
    // ADR-024: show the anchored rubric dimensions so the score is explainable.
    if (item.result.dimensions && r.dimensionsLabel && r.dimensionLabels) {
      lines.push(`${C.cyan}│${C.reset}  ${C.bold}${r.dimensionsLabel}:${C.reset}`);
      for (const key of DIMENSION_KEYS) {
        const v = item.result.dimensions[key];
        const shown = typeof v === 'number' ? `${v}/4` : r.dimensionNA;
        lines.push(`${C.cyan}│${C.reset}    ${C.dim}${r.dimensionLabels[key] || key}:${C.reset} ${shown}`);
      }
    }
    if (item.result.rationale) {
      lines.push(`${C.cyan}│${C.reset}  ${C.bold}${r.rationaleLabel}:${C.reset} ${conciseRationale(item.result.rationale)}`);
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
    // ADR-025 per-Skill authorship receipt (compact in terminal): attributed
    // file count + the author emails confirmed against the identity.
    if (rc && Array.isArray(item.fileAttribution) && item.fileAttribution.length > 0) {
      const attributed = item.fileAttribution.filter((f) => f.attributed).length;
      lines.push(
        `${C.cyan}│${C.reset}  ${C.bold}${rc.label}:${C.reset} ${rc.summary(attributed, item.fileAttribution.length)}`,
      );
      const matched = (item.authorEmails || []).filter((a) => a && a.matched).map((a) => a.email);
      if (matched.length > 0) {
        lines.push(`${C.cyan}│${C.reset}    ${C.dim}${rc.confirmedLabel}: ${matched.join(', ')}${C.reset}`);
      }
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

/* ---------- HTML (Shakers theme via report-theme, white background) ---------- */

// Certification-specific component CSS. Tokens + base primitives (.card,
// .chip, header, footer, pre, focus…) come from report-theme; only the
// Skill-card and remediation styling live here. Score bands use the DS status
// palette (--band-*), defined in the theme tokens.
const CERTIFICATION_CSS = `
  .cert-intro{font-size:13px;line-height:1.55;color:var(--faint);
    border-left:3px solid var(--border);padding:2px 0 2px 12px;margin:0 0 8px}
  .cert-warning{background:color-mix(in srgb,var(--ds-warning) 16%, var(--surface));
    color:var(--ds-zinc-900);border:1px solid color-mix(in srgb,var(--ds-warning) 45%, var(--surface));
    padding:10px 14px;border-radius:var(--r-md);font-weight:600;font-size:13.5px;margin:12px 0}
  .skill{padding:20px 22px;margin:16px 0;display:flex;flex-direction:column;gap:10px}
  .skill.not-sampleable,.skill.not-certified{opacity:.9}
  .skill-head{display:flex;align-items:center;justify-content:space-between;
    gap:14px;flex-wrap:wrap}
  .skill-head h2{font-size:18px;font-weight:700;letter-spacing:-.01em;margin:0;color:var(--fg)}
  .skill-head .tech{font-weight:500;color:var(--secondary-fg);background:var(--secondary);
    font-size:11px;letter-spacing:.02em;padding:3px 10px;border-radius:var(--r-full);
    margin-left:8px;white-space:nowrap}
  .score-badge{flex:none;font-weight:700;font-size:14px;padding:5px 14px;
    border-radius:var(--r-full);white-space:nowrap;font-variant-numeric:tabular-nums}
  .band-high{background:var(--band-high-bg);color:var(--band-high-fg)}
  .band-mid{background:var(--band-mid-bg);color:var(--band-mid-fg)}
  .band-low{background:var(--band-low-bg);color:var(--band-low-fg)}
  .skill .rationale{margin:0;font-size:14px;line-height:1.6;color:var(--fg)}
  .skill .label{font-weight:700;color:var(--fg)}
  .skill ul{margin:2px 0 4px 1.15rem;padding:0;display:flex;flex-direction:column;
    gap:6px;font-size:14px;line-height:1.55;color:var(--muted)}
  .skill .sample,.skill .note,.skill .hint{font-size:12.5px;color:var(--faint);margin:0}
  .remediation{margin-top:6px;border-top:1px dashed var(--border);padding-top:14px;
    display:flex;flex-direction:column;gap:8px}
  .remediation-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .copy-btn{flex:none;font-family:var(--font-sans);font-size:12px;font-weight:600;
    letter-spacing:.02em;color:var(--secondary-fg);background:var(--secondary);
    border:1px solid transparent;padding:5px 12px;border-radius:var(--r-full);cursor:pointer}
  .copy-btn:hover{background:var(--track)}
  .copy-btn.copied{color:var(--accent-lime-fg);
    background:color-mix(in srgb,var(--accent-lime) 28%, transparent)}
  .remediation pre{white-space:pre-wrap;word-break:break-word;font-size:12.5px;
    line-height:1.55;color:var(--fg);border-color:var(--emphasis);max-height:none}
`;

// Per-Skill sections + the disclaimer/cost-note/partial-warning preamble. No
// <h1> — reused by BOTH renderCertificationHtml (standalone, adds the <h1>)
// and the cumulative report (which puts them under its own section heading).
function certificationSectionsHtml(certification, lang) {
  const catalog = getCatalog(lang);
  const r = catalog.certify.report;
  const items = Array.isArray(certification && certification.items) ? certification.items : [];

  const sections = items.map((item, index) => {
    const head =
      `<div class="skill-head"><h2>${escapeHtml(item.skillName)}`
      + `${item.technology ? `<span class="tech">${escapeHtml(item.technology)}</span>` : ''}</h2>`;

    if (item.sampling && item.sampling.sampleable === false) {
      return `<section class="card skill not-sampleable">${head}</div><p class="note">${escapeHtml(r.notSampleableNote(item.technology))}</p></section>`;
    }
    if (!item.result) {
      return `<section class="card skill not-certified">${head}</div><p class="note">${escapeHtml(r.notCertified)}</p></section>`;
    }

    const band = scoreBand(item.result.score);
    const scoreBadge = `<span class="score-badge band-${band}">${escapeHtml(r.scoreLine(item.result.score))}</span></div>`;

    const improvements =
      Array.isArray(item.result.improvements) && item.result.improvements.length
        ? `<p class="label">${escapeHtml(r.improvementsLabel)}</p><ul>${item.result.improvements.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
        : '';
    // ADR-024: render the anchored rubric dimensions so the score is explainable.
    const dimensions =
      item.result.dimensions && r.dimensionsLabel && r.dimensionLabels
        ? `<p class="label">${escapeHtml(r.dimensionsLabel)}</p><ul class="dimensions">${DIMENSION_KEYS.map(
            (key) => {
              const v = item.result.dimensions[key];
              const shown = typeof v === 'number' ? `${v}/4` : r.dimensionNA;
              return `<li>${escapeHtml(r.dimensionLabels[key] || key)}: ${escapeHtml(shown)}</li>`;
            },
          ).join('')}</ul>`
        : '';
    const sampleTag = item.sampling && item.sampling.truncated ? ` ${escapeHtml(r.partialTag)}` : '';
    const sample = item.sampling
      ? `<p class="sample">${escapeHtml(r.sampleSummary(item.sampling.includedCount, item.sampling.candidateCount, item.sampling.estTokens))}${sampleTag}</p>`
      : '';
    // ADR-025 authorship receipt (fuller in HTML): the full file → git author →
    // ✓/✗ trail + confirmed authors + the honest "attribution, not proof" note.
    const receipt = renderReceiptHtml(item, r.receipt);

    let remediationHtml = '';
    const remediation = buildRemediationPrompt(item, lang);
    if (remediation) {
      // A stable-ish id per Skill so multiple certifications in the cumulative
      // report never collide on the copy target. Falls back to the index.
      const idBase = item.skillId != null ? String(item.skillId) : String(index);
      const id = `rem-${idBase.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      remediationHtml =
        `<div class="remediation"><div class="remediation-head">`
        + `<span class="label">${escapeHtml(r.remediationHeading)}</span>`
        + `<button type="button" class="copy-btn" data-copy-target="${id}" data-copied-label="${escapeHtml(r.remediationCopiedLabel)}">${escapeHtml(r.remediationCopyLabel)}</button>`
        + `</div><p class="hint">${escapeHtml(r.remediationHint)}</p>`
        + `<pre id="${id}">${escapeHtml(remediation)}</pre></div>`;
    }

    return `<section class="card skill">${head}${scoreBadge}`
      + (item.result.rationale ? `<p class="rationale"><span class="label">${escapeHtml(r.rationaleLabel)}:</span> ${escapeHtml(item.result.rationale)}</p>` : '')
      + dimensions
      + improvements
      + sample
      + receipt
      + remediationHtml
      + `</section>`;
  }).join('\n');

  const partial = anyTruncated(items) ? `<p class="cert-warning">${escapeHtml(r.partialSampleWarning)}</p>` : '';
  const body = items.length === 0 ? `<p class="note">${escapeHtml(r.noItems)}</p>` : sections;

  return `<p class="cert-intro">${escapeHtml(r.disclaimer)}</p>
<p class="cert-intro">${escapeHtml(r.costNote)}</p>
${partial}
${body}`;
}

function renderCertificationHtml(certification, lang) {
  const catalog = getCatalog(lang);
  const r = catalog.certify.report;
  const body = `<header><span class="badge"><span class="spark"></span>AI CERTIFY</span>
  <h1>${escapeHtml(r.heading)}</h1></header>
${certificationSectionsHtml(certification, lang)}`;

  return renderDocument({
    lang: catalog.html.lang,
    title: r.htmlTitle,
    componentCss: CERTIFICATION_CSS,
    body,
  });
}

module.exports = {
  renderCertificationTerminal,
  renderCertificationHtml,
  certificationSectionsHtml,
  CERTIFICATION_CSS,
  anyTruncated,
  scoreBand,
};
