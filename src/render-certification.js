'use strict';

const { getCatalog } = require('./i18n');
const { buildRemediationPrompt } = require('./certify-remediation-prompt');
const { sanitizeRenderText } = require('./sanitize-network-text');
const { palette } = require('./ansi');
const { BRAND_ANSI } = require('./brand-ansi');
const { DEFAULT_REPORT_GATE } = require('./report-gating');

// Local shorthand: this file has ~15 paint sites and spelling the full name at
// each one buried the markup. Non-strings degrade to '' (see the primitive).
const display = (s) => sanitizeRenderText(s);

const C = palette({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  primary: BRAND_ANSI.primary,
  accent: BRAND_ANSI.accent,
  success: BRAND_ANSI.success,
  warning: BRAND_ANSI.warning,
  danger: BRAND_ANSI.danger,
});

function anyTruncated(items) {
  return (items || []).some((i) => i && i.sampling && i.sampling.truncated);
}

// ADR-024 rubric dimension order (terminal).
const DIMENSION_KEYS = ['idiomatic', 'correctness', 'depth', 'structure', 'testing'];

// Score band -> semantic (shared with the HTML/graph CSS class via `graph-certs.js`, which still imports this).
function scoreBand(score) {
  if (typeof score !== 'number') return 'mid';
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

// ADR-016: named skill level (by decision power, not points) shown INSTEAD of the numeric grade.
function skillLevelForScore(score) {
  const band = scoreBand(score);
  if (typeof score !== 'number') return { key: null, band };
  return { key: band === 'high' ? 'expert' : band === 'low' ? 'middle' : 'senior', band };
}

// Localized level label from the certify.report.skillLevels catalog.
function skillLevelLabel(key, r) {
  const names = (r && r.skillLevels) || {};
  return key ? (names[key] || key) : (names.na || '—');
}

const RULE = '────────────────────────────────────────';

// Terminal-condense (CPO feedback): the LLM rationale can be several sentences.
const RATIONALE_MAX = 220;
function conciseRationale(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length <= RATIONALE_MAX) return s;
  const window = s.slice(0, RATIONALE_MAX);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (lastStop >= 80) return window.slice(0, lastStop + 1);
  return `${window.replace(/[\s.,;:]+$/, '')}…`;
}

function renderCertificationTerminal(certification, lang, opts = {}) {
  const r = getCatalog(lang).certify.report;
  const items = Array.isArray(certification && certification.items) ? certification.items : [];
  const lines = [];
  // issue 123 / ADR-044: the SAME identity gate the footprint report reads.
  const gate = opts.gate || DEFAULT_REPORT_GATE;

  // Header stands out; disclaimer + cost note are deliberately quiet (dim) so
  // the per-Skill results below are visually dominant (issue 011 feedback).
  lines.push(`${C.bold}${C.primary}${r.heading}${C.reset}`);
  // talents-ai-score, ADR-051: this whole render is now a FALLBACK — reached only when the mandatory interview did not complete.
  if (opts.noInterview && r.noInterviewNote) lines.push(`${C.bold}${C.warning}${r.noInterviewNote}${C.reset}`);
  lines.push('');
  lines.push(`${C.dim}${r.disclaimer}${C.reset}`);
  lines.push(`${C.dim}${r.costNote}${C.reset}`);
  // ADR-025 authorship receipt (run-level): repo + commit range + honest note,
  // shown once. Attribution is based on git authorship, NOT cryptographic proof.
  const authorship = (certification && certification.authorship) || null;
  const rc = r.receipt;
  if (rc && authorship && (authorship.repository || authorship.commitRange)) {
    const bits = [];
    if (authorship.repository) bits.push(`${rc.repoLabel}: ${display(authorship.repository)}`);
    if (authorship.commitRange) bits.push(`${rc.commitRangeLabel}: ${authorship.commitRange}`);
    lines.push(`${C.dim}${rc.label} — ${bits.join(' · ')}${C.reset}`);
  }
  if (rc) lines.push(`${C.dim}${rc.note}${C.reset}`);
  if (anyTruncated(items)) lines.push(`\n  ${C.warning}${r.partialSampleWarning}${C.reset}`);
  lines.push('');

  if (items.length === 0) {
    lines.push(`  ${r.noItems}`);
    return lines.join('\n');
  }

  for (const item of items) {
    const title = `${display(item.skillName)}${item.technology ? ` (${display(item.technology)})` : ''}`;
    lines.push(`${C.bold}${C.primary}╭─ ${title}${C.reset}`);

    if (item.sampling && item.sampling.sampleable === false) {
      lines.push(`${C.primary}│${C.reset}  ${r.notSampleableNote(display(item.technology))}`);
      lines.push(`${C.primary}╰─${C.reset}`);
      lines.push('');
      continue;
    }
    if (!item.result) {
      lines.push(`${C.primary}│${C.reset}  ${r.notCertified}`);
      lines.push(`${C.primary}╰─${C.reset}`);
      lines.push('');
      continue;
    }

    // ADR-016: the HEADLINE is the named level (Middle/Senior/Expert) instead of the numeric 0-100 grade.
    const { key: levelKey } = skillLevelForScore(item.result.score);
    lines.push(`${C.primary}│${C.reset}  ${C.bold}${C.accent}${r.levelLine(skillLevelLabel(levelKey, r))}${C.reset}`);
    // ADR-024: show the anchored rubric dimensions so the level is explainable.
    if (item.result.dimensions && r.dimensionsLabel && r.dimensionLabels) {
      lines.push(`${C.primary}│${C.reset}  ${C.bold}${r.dimensionsLabel}:${C.reset}`);
      for (const key of DIMENSION_KEYS) {
        const v = item.result.dimensions[key];
        const shown = typeof v === 'number' ? `${v}/4` : r.dimensionNA;
        lines.push(`${C.primary}│${C.reset}    ${C.dim}${r.dimensionLabels[key] || key}:${C.reset} ${shown}`);
      }
    }
    if (item.result.rationale) {
      lines.push(`${C.primary}│${C.reset}  ${C.bold}${r.rationaleLabel}:${C.reset} ${conciseRationale(display(item.result.rationale))}`);
    }
    if (Array.isArray(item.result.improvements) && item.result.improvements.length > 0) {
      lines.push(`${C.primary}│${C.reset}  ${C.bold}${r.improvementsLabel}:${C.reset}`);
      for (const imp of item.result.improvements) lines.push(`${C.primary}│${C.reset}    • ${display(imp)}`);
    }
    if (item.sampling) {
      const summary = r.sampleSummary(item.sampling.includedCount, item.sampling.candidateCount, item.sampling.estTokens);
      const tag = item.sampling.truncated ? ` ${r.partialTag}` : '';
      lines.push(`${C.primary}│${C.reset}  ${C.dim}${summary}${tag}${C.reset}`);
    }
    // ADR-025 per-Skill authorship receipt (compact in terminal): attributed
    // file count + the author emails confirmed against the identity.
    if (rc && Array.isArray(item.fileAttribution) && item.fileAttribution.length > 0) {
      const attributed = item.fileAttribution.filter((f) => f.attributed).length;
      lines.push(
        `${C.primary}│${C.reset}  ${C.bold}${rc.label}:${C.reset} ${rc.summary(attributed, item.fileAttribution.length)}`,
      );
      const matched = (item.authorEmails || []).filter((a) => a && a.matched).map((a) => display(a.email));
      if (matched.length > 0) {
        lines.push(`${C.primary}│${C.reset}    ${C.dim}${rc.confirmedLabel}: ${matched.join(', ')}${C.reset}`);
      }
    }

    // Remediation prompt (issue 011): a clearly delimited copyable block.
    const remediation = gate.showCertifyRemediation ? buildRemediationPrompt(item, lang) : null;
    if (remediation) {
      lines.push(`${C.primary}│${C.reset}`);
      lines.push(`${C.primary}│${C.reset}  ${C.bold}${r.remediationHeading}${C.reset}`);
      lines.push(`${C.primary}│${C.reset}  ${C.dim}${r.remediationHint}${C.reset}`);
      lines.push(`${C.primary}│${C.reset}  ${C.dim}${RULE}${C.reset}`);
      for (const l of remediation.split('\n')) lines.push(`${C.primary}│${C.reset}  ${display(l)}`);
      lines.push(`${C.primary}│${C.reset}  ${C.dim}${RULE}${C.reset}`);
    }

    lines.push(`${C.primary}╰─${C.reset}`);
    lines.push('');
  }

  return lines.join('\n').replace(/\n+$/, '');
}

module.exports = {
  renderCertificationTerminal,
  anyTruncated,
  scoreBand,
  skillLevelForScore,
};
